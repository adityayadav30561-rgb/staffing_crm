import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { isManager, taskSchema } from '@crm/shared';
import { candidates, notifications, requirements, tasks, users } from '../db/schema';
import { me } from '../app';
import { forbidden, notFound } from '../lib/errors';
import { createdChanges, diff, writeAudit } from '../lib/audit';
import { notify } from '../lib/notify';

export async function taskRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      scope?: 'mine' | 'all';
      status?: 'open' | 'done';
      assigneeId?: string;
      when?: 'overdue' | 'today' | 'upcoming';
    };
  }>('/api/tasks', async (req) => {
    const u = me(req);
    const q = req.query;
    const conds: SQL[] = [];
    if (q.scope === 'all' && isManager(u.role)) {
      if (q.assigneeId) conds.push(eq(tasks.assigneeId, Number(q.assigneeId)));
    } else {
      conds.push(eq(tasks.assigneeId, u.id));
    }
    if (q.status === 'done') conds.push(isNotNull(tasks.doneAt));
    else conds.push(isNull(tasks.doneAt));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    if (q.when === 'overdue') conds.push(lt(tasks.dueAt, new Date()));
    if (q.when === 'today') conds.push(and(gte(tasks.dueAt, start), lt(tasks.dueAt, end))!);
    if (q.when === 'upcoming') conds.push(gte(tasks.dueAt, end));
    const rows = await app.db
      .select({
        t: tasks,
        assigneeName: users.name,
        candidateName: candidates.name,
        requirementTitle: requirements.title,
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(candidates, eq(candidates.id, tasks.candidateId))
      .leftJoin(requirements, eq(requirements.id, tasks.requirementId))
      .where(and(...conds))
      .orderBy(q.status === 'done' ? desc(tasks.doneAt) : asc(tasks.dueAt))
      .limit(300);
    return rows.map((r) => ({
      ...r.t,
      assigneeName: r.assigneeName,
      candidateName: r.candidateName,
      requirementTitle: r.requirementTitle,
    }));
  });

  app.get('/api/tasks/counts', async (req) => {
    const u = me(req);
    const [r] = await app.db
      .select({
        open: sql<number>`count(*) filter (where ${tasks.doneAt} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.doneAt} is null and ${tasks.dueAt} < now())::int`,
        dueToday: sql<number>`count(*) filter (where ${tasks.doneAt} is null and ${tasks.dueAt} < date_trunc('day', now()) + interval '1 day')::int`,
      })
      .from(tasks)
      .where(eq(tasks.assigneeId, u.id));
    const [n] = await app.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
    return { ...r, unreadNotifications: n.unread };
  });

  app.post('/api/tasks', async (req) => {
    const u = me(req);
    const body = taskSchema.parse(req.body);
    const assigneeId = body.assigneeId ?? u.id;
    const [row] = await app.db
      .insert(tasks)
      .values({ ...body, dueAt: new Date(body.dueAt), assigneeId, createdBy: u.id, rule: 'manual' })
      .returning();
    await writeAudit(app.db, u.id, 'task', row.id, 'create', createdChanges(row));
    if (assigneeId !== u.id) {
      await notify(app.db, [assigneeId], {
        title: `New task from ${u.name}`,
        body: row.title,
        link: '/tasks',
      });
    }
    return row;
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = req.body as {
      done?: boolean;
      title?: string;
      dueAt?: string;
      notes?: string | null;
      assigneeId?: number;
    };
    const [before] = await app.db.select().from(tasks).where(eq(tasks.id, id));
    if (!before) throw notFound('Task');
    if (before.assigneeId !== u.id && before.createdBy !== u.id && !isManager(u.role))
      throw forbidden();
    const values: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (body.done === true)
      Object.assign(values, { doneAt: new Date(), doneBy: u.id, autoClosed: false });
    if (body.done === false) Object.assign(values, { doneAt: null, doneBy: null });
    if (body.title) values.title = String(body.title).slice(0, 300);
    if (body.dueAt) values.dueAt = new Date(body.dueAt);
    if (body.notes !== undefined) values.notes = body.notes;
    if (body.assigneeId) values.assigneeId = Number(body.assigneeId);
    const [row] = await app.db.update(tasks).set(values).where(eq(tasks.id, id)).returning();
    await writeAudit(app.db, u.id, 'task', id, 'update', diff(before, values));
    if (body.done !== undefined) app.automation.kick(); // a finished check-in schedules the next one
    return row;
  });

  app.get('/api/notifications', async (req) => {
    const u = me(req);
    return app.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id))
      .orderBy(desc(notifications.id))
      .limit(50);
  });

  app.post('/api/notifications/read', async (req) => {
    const u = me(req);
    const { id } = (req.body ?? {}) as { id?: number };
    await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, u.id),
          isNull(notifications.readAt),
          id ? eq(notifications.id, Number(id)) : undefined,
        ),
      );
    return { ok: true };
  });
}
