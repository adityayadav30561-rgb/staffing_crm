import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  assigneesSchema,
  canAssign,
  isManager,
  postingSchema,
  REQUIREMENT_STATUS_LABELS,
  requirementSchema,
  requirementStatusSchema,
  requirementUpdateSchema,
  STAGES,
  type RequirementStatus,
} from '@crm/shared';
import {
  activities,
  applications,
  clientContacts,
  clients,
  jobPostings,
  requirementAssignees,
  requirements,
  tasks,
  users,
} from '../db/schema';
import { me, requireRole } from '../app';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { createdChanges, logActivity, writeAudit } from '../lib/audit';
import { updateVersioned } from '../lib/lock';
import { assertCanWork, requirementAccess } from '../lib/access';
import { notify } from '../lib/notify';
import { cancelOpenApplications } from '../lib/pipeline';
import { ALLOWED_DOC_TYPES, newKey, sniffDocType } from '../lib/storage';
import { clientView } from './clients';

type ReqRow = typeof requirements.$inferSelect;

const filledSql = sql<number>`(select count(*)::int from ${applications} a where a.requirement_id = ${requirements.id} and a.status = 'joined')`;
const lastActivitySql = sql<Date | null>`(select max(created_at) from ${activities} x where x.requirement_id = ${requirements.id})`;

export async function requirementRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; clientId?: string; mine?: string; q?: string } }>(
    '/api/requirements',
    async (req) => {
      const u = me(req);
      const q = req.query;
      const conds: SQL[] = [];
      if (q.status && q.status !== 'all') {
        conds.push(inArray(requirements.status, q.status.split(',') as RequirementStatus[]));
      } else if (!q.status) {
        conds.push(inArray(requirements.status, ['draft', 'open', 'on_hold']));
      }
      if (q.clientId) conds.push(eq(requirements.clientId, Number(q.clientId)));
      if (q.q) conds.push(or(ilike(requirements.title, `%${q.q}%`), ilike(requirements.code, `%${q.q}%`), ilike(clients.name, `%${q.q}%`))!);
      if (q.mine === 'true') {
        conds.push(
          or(
            eq(requirements.ownerId, u.id),
            sql`exists (select 1 from ${requirementAssignees} ra where ra.requirement_id = ${requirements.id} and ra.user_id = ${u.id})`,
          )!,
        );
      }
      const rows = await app.db
        .select({
          r: requirements,
          clientName: clients.name,
          ownerName: users.name,
          filled: filledSql,
          lastActivityAt: lastActivitySql,
        })
        .from(requirements)
        .innerJoin(clients, eq(clients.id, requirements.clientId))
        .innerJoin(users, eq(users.id, requirements.ownerId))
        .where(and(...conds))
        .orderBy(
          sql`case ${requirements.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
          desc(requirements.createdAt),
        );
      const ids = rows.map((r) => r.r.id);
      const [assignees, stageCounts] = await Promise.all([assigneesFor(app, ids), stageCountsFor(app, ids)]);
      return rows.map((row) => ({
        ...row.r,
        clientName: row.clientName,
        ownerName: row.ownerName,
        filled: row.filled,
        lastActivityAt: row.lastActivityAt,
        assignees: assignees.get(row.r.id) ?? [],
        stageCounts: stageCounts.get(row.r.id) ?? emptyStageCounts(),
      }));
    },
  );

  app.get<{ Params: { id: string } }>('/api/requirements/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const acc = await requirementAccess(app.db, id, u);
    const r = acc.requirement;
    const [[client], contact, [owner], postings, timeline, assignees, stageCounts, [{ filled }]] = await Promise.all([
      app.db.select().from(clients).where(eq(clients.id, r.clientId)),
      r.contactId ? app.db.select().from(clientContacts).where(eq(clientContacts.id, r.contactId)) : Promise.resolve([]),
      app.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, r.ownerId)),
      app.db
        .select({ p: jobPostings, postedByName: users.name })
        .from(jobPostings)
        .leftJoin(users, eq(users.id, jobPostings.postedBy))
        .where(eq(jobPostings.requirementId, id))
        .orderBy(desc(jobPostings.postedOn)),
      app.db
        .select({ id: activities.id, summary: activities.summary, verb: activities.verb, createdAt: activities.createdAt, actorName: users.name })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.actorId))
        .where(eq(activities.requirementId, id))
        .orderBy(desc(activities.id))
        .limit(60),
      assigneesFor(app, [id]),
      stageCountsFor(app, [id]),
      app.db.select({ filled: filledSql }).from(requirements).where(eq(requirements.id, id)),
    ]);
    return {
      ...r,
      client: clientView(client, u.role),
      contact: contact[0] ?? null,
      owner,
      assignees: assignees.get(id) ?? [],
      postings: postings.map((p) => ({ ...p.p, postedByName: p.postedByName })),
      stageCounts: stageCounts.get(id) ?? emptyStageCounts(),
      filled,
      timeline,
      canWork: acc.canWork,
      canAssign: canAssign(u.role, acc.isOwner),
      jdFileUrl: r.jdFileKey ? await app.storage.signedUrl(r.jdFileKey, r.jdFileName ?? 'jd') : null,
    };
  });

  app.post('/api/requirements', async (req) => {
    const u = me(req);
    const body = requirementSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(eq(clients.id, body.clientId));
      if (!client) throw badRequest('Pick a client');
      if (body.contactId) await assertContactOfClient(tx, body.contactId, body.clientId);
      const [{ id }] = (await tx.execute(sql`select nextval('requirements_id_seq')::int as id`)) as unknown as { id: number }[];
      const [row] = await tx
        .insert(requirements)
        .values({
          ...body,
          id,
          code: `REQ-${String(id).padStart(4, '0')}`,
          ownerId: u.id,
          status: 'draft',
          createdBy: u.id,
          updatedBy: u.id,
        })
        .returning();
      await writeAudit(tx, u.id, 'requirement', row.id, 'create', createdChanges(row));
      await logActivity(tx, {
        actorId: u.id,
        verb: 'requirement.created',
        summary: `Created ${row.code} ${row.title} (${row.openings} position${row.openings > 1 ? 's' : ''}) for ${client.name}`,
        requirementId: row.id,
        clientId: row.clientId,
      });
      return row;
    });
  });

  app.patch<{ Params: { id: string } }>('/api/requirements/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, status: _ignored, ...body } = requirementUpdateSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const acc = await assertCanWork(tx, id, u);
      if (body.clientId && body.clientId !== acc.requirement.clientId) {
        const [{ n }] = await tx.select({ n: count() }).from(applications).where(eq(applications.requirementId, id));
        if (n > 0) throw badRequest('The client cannot change once candidates are mapped');
      }
      if (body.contactId) await assertContactOfClient(tx, body.contactId, body.clientId ?? acc.requirement.clientId);
      const row = await updateVersioned<ReqRow>(tx, requirements, 'requirement', id, version, body, u.id);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'requirement.updated',
        summary: `Updated details of ${row.title}`,
        requirementId: id,
        clientId: row.clientId,
      });
      return row;
    });
  });

  app.post<{ Params: { id: string } }>('/api/requirements/:id/status', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = requirementStatusSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const acc = await assertCanWork(tx, id, u);
      const before = acc.requirement;
      if (before.status === body.status) throw badRequest('Nothing to change');
      const values: Partial<ReqRow> = { status: body.status };
      if (body.status === 'open' && !before.openedAt) values.openedAt = new Date();
      if (['filled', 'closed', 'cancelled'].includes(body.status)) values.closedAt = new Date();
      else values.closedAt = null;
      const row = await updateVersioned<ReqRow>(tx, requirements, 'requirement', id, body.version, values, u.id);
      let closedApps = 0;
      if (body.status === 'cancelled') closedApps = await cancelOpenApplications(tx, u, id);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'requirement.status',
        summary: `${row.title}: ${REQUIREMENT_STATUS_LABELS[before.status]} → ${REQUIREMENT_STATUS_LABELS[body.status]}${closedApps ? ` (${closedApps} open candidate${closedApps > 1 ? 's' : ''} closed)` : ''}${body.note ? ` — ${body.note}` : ''}`,
        payload: { from: before.status, to: body.status, note: body.note },
        requirementId: id,
        clientId: row.clientId,
      });
      app.automation.kick();
      return row;
    });
  });

  app.put<{ Params: { id: string } }>('/api/requirements/:id/assignees', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = assigneesSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const acc = await requirementAccess(tx, id, u);
      if (!canAssign(u.role, acc.isOwner)) throw forbidden('Only the owner or a manager can assign recruiters');
      const r = acc.requirement;
      const current = await tx.select().from(requirementAssignees).where(eq(requirementAssignees.requirementId, id));
      const currentIds = new Set(current.map((c) => c.userId));
      const wanted = new Set(body.userIds.filter((x) => x !== r.ownerId));
      const valid = wanted.size
        ? await tx.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, [...wanted]), eq(users.active, true)))
        : [];
      if (valid.length !== wanted.size) throw badRequest('Unknown or inactive user');
      const added = [...wanted].filter((x) => !currentIds.has(x));
      const removed = [...currentIds].filter((x) => !wanted.has(x));
      if (removed.length) {
        await tx
          .delete(requirementAssignees)
          .where(and(eq(requirementAssignees.requirementId, id), inArray(requirementAssignees.userId, removed)));
      }
      if (added.length) {
        await tx.insert(requirementAssignees).values(added.map((userId) => ({ requirementId: id, userId, assignedBy: u.id })));
        const due = new Date();
        due.setHours(18, 0, 0, 0);
        await tx
          .insert(tasks)
          .values(
            added.map((userId) => ({
              title: `Start sourcing: ${r.title}`,
              rule: 'assignment' as const,
              autoKey: `assignment:${id}:${userId}:${Date.now()}`,
              assigneeId: userId,
              dueAt: due,
              requirementId: id,
              createdBy: u.id,
            })),
          )
          .onConflictDoNothing();
        await notify(tx, added, { title: `You were assigned to ${r.title}`, body: `${r.code} · by ${u.name}`, link: `/requirements/${id}` }, u.id);
      }
      if (added.length || removed.length) {
        const names = new Map(valid.map((v) => [v.id, v.name]));
        const removedNames = removed.length
          ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, removed))).map((x) => x.name)
          : [];
        await writeAudit(tx, u.id, 'requirement', id, 'update', { assignees: [[...currentIds], [...wanted]] });
        await logActivity(tx, {
          actorId: u.id,
          verb: 'requirement.assigned',
          summary: [
            added.length ? `Assigned ${added.map((x) => names.get(x)).join(', ')}` : '',
            removedNames.length ? `Unassigned ${removedNames.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; ') + ` · ${r.title}`,
          requirementId: id,
          clientId: r.clientId,
        });
      }
      return (await assigneesFor(app, [id], tx)).get(id) ?? [];
    });
  });

  app.delete<{ Params: { id: string } }>('/api/requirements/:id', async (req) => {
    const u = requireRole(req, 'manager');
    const id = Number(req.params.id);
    await app.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(applications).where(eq(applications.requirementId, id));
      if (n > 0) throw badRequest('Candidates are mapped to this requirement. Close or cancel it instead.');
      const [row] = await tx.delete(requirements).where(eq(requirements.id, id)).returning();
      if (!row) throw notFound('Requirement');
      await writeAudit(tx, u.id, 'requirement', id, 'delete', createdChanges(row));
    });
    return { ok: true };
  });

  // Job postings (doc step 2): a log of where the opening is advertised.
  app.post<{ Params: { id: string } }>('/api/requirements/:id/postings', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = postingSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const acc = await assertCanWork(tx, id, u);
      const [row] = await tx.insert(jobPostings).values({ ...body, requirementId: id, postedBy: u.id }).returning();
      await writeAudit(tx, u.id, 'job_posting', row.id, 'create', createdChanges(row));
      await logActivity(tx, {
        actorId: u.id,
        verb: 'requirement.posted',
        summary: `Posted ${acc.requirement.title} on ${row.platform}`,
        requirementId: id,
        clientId: acc.requirement.clientId,
      });
      return row;
    });
  });

  app.delete<{ Params: { id: string; postingId: string } }>('/api/requirements/:id/postings/:postingId', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    await app.db.transaction(async (tx) => {
      await assertCanWork(tx, id, u);
      const [row] = await tx
        .delete(jobPostings)
        .where(and(eq(jobPostings.id, Number(req.params.postingId)), eq(jobPostings.requirementId, id)))
        .returning();
      if (!row) throw notFound('Posting');
      await writeAudit(tx, u.id, 'job_posting', row.id, 'delete', createdChanges(row));
    });
    return { ok: true };
  });

  // JD document
  app.post<{ Params: { id: string } }>('/api/requirements/:id/jd', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    await assertCanWork(app.db, id, u);
    const file = await req.file();
    if (!file) throw badRequest('Attach a file');
    const buf = await file.toBuffer();
    const type = sniffDocType(buf, file.mimetype);
    if (!type) throw badRequest('Upload a PDF, Word or text file');
    const key = newKey('jd', ALLOWED_DOC_TYPES[type]);
    await app.storage.put(key, buf, type);
    return app.db.transaction(async (tx) => {
      const [before] = await tx.select().from(requirements).where(eq(requirements.id, id));
      await tx
        .update(requirements)
        .set({ jdFileKey: key, jdFileName: file.filename, updatedAt: new Date(), updatedBy: u.id })
        .where(eq(requirements.id, id));
      await writeAudit(tx, u.id, 'requirement', id, 'update', { jdFileName: [before.jdFileName, file.filename] });
      return { ok: true };
    });
  });

  /** Managers and owners may reassign the owner. */
  app.post<{ Params: { id: string } }>('/api/requirements/:id/owner', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { ownerId, version } = req.body as { ownerId: number; version: number };
    return app.db.transaction(async (tx) => {
      const acc = await requirementAccess(tx, id, u);
      if (!isManager(u.role) && !acc.isOwner) throw forbidden();
      const [owner] = await tx.select().from(users).where(and(eq(users.id, Number(ownerId)), eq(users.active, true)));
      if (!owner) throw badRequest('Unknown user');
      const row = await updateVersioned<ReqRow>(tx, requirements, 'requirement', id, Number(version), { ownerId: owner.id }, u.id);
      await tx
        .delete(requirementAssignees)
        .where(and(eq(requirementAssignees.requirementId, id), eq(requirementAssignees.userId, owner.id)));
      await notify(tx, [owner.id], { title: `You now own ${row.title}`, link: `/requirements/${id}` }, u.id);
      await logActivity(tx, { actorId: u.id, verb: 'requirement.owner', summary: `${owner.name} is now owner of ${row.title}`, requirementId: id, clientId: row.clientId });
      return row;
    });
  });
}

async function assertContactOfClient(tx: Parameters<typeof assertCanWork>[0], contactId: number, clientId: number) {
  const [c] = await tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)));
  if (!c) throw badRequest('That contact does not belong to this client');
}

function emptyStageCounts() {
  return Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<(typeof STAGES)[number], number>;
}

async function assigneesFor(app: FastifyInstance, ids: number[], tx: Parameters<typeof assertCanWork>[0] = app.db) {
  const map = new Map<number, { id: number; name: string }[]>();
  if (!ids.length) return map;
  const rows = await tx
    .select({ requirementId: requirementAssignees.requirementId, id: users.id, name: users.name })
    .from(requirementAssignees)
    .innerJoin(users, eq(users.id, requirementAssignees.userId))
    .where(inArray(requirementAssignees.requirementId, ids))
    .orderBy(asc(users.name));
  for (const r of rows) {
    if (!map.has(r.requirementId)) map.set(r.requirementId, []);
    map.get(r.requirementId)!.push({ id: r.id, name: r.name });
  }
  return map;
}

/** Open (not closed) applications per stage, per requirement. */
async function stageCountsFor(app: FastifyInstance, ids: number[]) {
  const map = new Map<number, ReturnType<typeof emptyStageCounts>>();
  if (!ids.length) return map;
  const rows = await app.db
    .select({ requirementId: applications.requirementId, stage: applications.stage, n: sql<number>`count(*)::int` })
    .from(applications)
    .where(and(inArray(applications.requirementId, ids), sql`${applications.closedAt} is null`))
    .groupBy(applications.requirementId, applications.stage);
  for (const r of rows) {
    if (!map.has(r.requirementId)) map.set(r.requirementId, emptyStageCounts());
    map.get(r.requirementId)![r.stage] = r.n;
  }
  return map;
}
