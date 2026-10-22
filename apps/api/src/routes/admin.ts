import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { lookupSchema, settingsSchema } from '@crm/shared';
import { activities, auditLogs, lookups, users } from '../db/schema';
import { requireRole } from '../app';
import { conflict, isUniqueViolation, notFound } from '../lib/errors';
import { createdChanges, diff, writeAudit } from '../lib/audit';
import { getSettings, saveSettings } from '../lib/settings';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/lookups', async () => {
    return app.db
      .select()
      .from(lookups)
      .orderBy(asc(lookups.kind), asc(lookups.sort), asc(lookups.label));
  });

  app.post('/api/lookups', async (req) => {
    const u = requireRole(req, 'admin');
    const body = lookupSchema.parse(req.body);
    try {
      const [row] = await app.db.insert(lookups).values(body).returning();
      await writeAudit(app.db, u.id, 'lookup', row.id, 'create', createdChanges(row));
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('That option already exists');
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/lookups/:id', async (req) => {
    const u = requireRole(req, 'admin');
    const id = Number(req.params.id);
    const body = lookupSchema.partial().parse(req.body);
    const [before] = await app.db.select().from(lookups).where(eq(lookups.id, id));
    if (!before) throw notFound('Option');
    const [row] = await app.db.update(lookups).set(body).where(eq(lookups.id, id)).returning();
    await writeAudit(app.db, u.id, 'lookup', id, 'update', diff(before, body));
    return row;
  });

  app.get('/api/settings', async () => getSettings(app.db));

  app.put('/api/settings', async (req) => {
    const u = requireRole(req, 'admin');
    const body = settingsSchema.parse(req.body);
    const before = await getSettings(app.db);
    await saveSettings(app.db, body);
    await writeAudit(app.db, u.id, 'settings', 0, 'update', diff(before as any, body as any));
    app.automation.kick();
    return body;
  });

  app.post('/api/automation/run', async (req) => {
    requireRole(req, 'manager');
    return app.automation.runNow();
  });

  /** Business activity feed (managers). */
  app.get<{
    Querystring: { userId?: string; verb?: string; from?: string; to?: string; before?: string };
  }>('/api/activities', async (req) => {
    requireRole(req, 'manager');
    const q = req.query;
    const conds: SQL[] = [];
    if (q.userId) conds.push(eq(activities.actorId, Number(q.userId)));
    if (q.verb) conds.push(eq(activities.verb, q.verb));
    if (q.from) conds.push(gte(activities.createdAt, new Date(q.from)));
    if (q.to) conds.push(lte(activities.createdAt, new Date(q.to)));
    if (q.before) conds.push(lte(activities.id, Number(q.before)));
    return app.db
      .select({
        id: activities.id,
        verb: activities.verb,
        summary: activities.summary,
        createdAt: activities.createdAt,
        actorName: users.name,
        candidateId: activities.candidateId,
        requirementId: activities.requirementId,
        applicationId: activities.applicationId,
        clientId: activities.clientId,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(activities.id))
      .limit(100);
  });

  /** Field-level audit history (managers). */
  app.get<{
    Querystring: { entity?: string; entityId?: string; userId?: string; before?: string };
  }>('/api/audit', async (req) => {
    requireRole(req, 'manager');
    const q = req.query;
    const conds: SQL[] = [];
    if (q.entity) conds.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) conds.push(eq(auditLogs.entityId, Number(q.entityId)));
    if (q.userId) conds.push(eq(auditLogs.actorId, Number(q.userId)));
    if (q.before) conds.push(lte(auditLogs.id, Number(q.before)));
    return app.db
      .select({
        id: auditLogs.id,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        action: auditLogs.action,
        changes: auditLogs.changes,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(100);
  });
}
