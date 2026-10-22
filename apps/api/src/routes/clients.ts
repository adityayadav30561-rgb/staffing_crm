import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm';
import { canSeeFees, clientSchema, clientUpdateSchema, contactSchema, type Role } from '@crm/shared';
import { activities, clientContacts, clients, requirements, users } from '../db/schema';
import { me, requireRole } from '../app';
import { badRequest, notFound } from '../lib/errors';
import { createdChanges, diff, logActivity, writeAudit } from '../lib/audit';
import { updateVersioned } from '../lib/lock';

type ClientRow = typeof clients.$inferSelect;

/** Recruiters don't see commercial terms. */
export function clientView(c: ClientRow, role: Role) {
  if (canSeeFees(role)) return c;
  const { feeType: _t, feeValue: _v, ...rest } = c;
  return rest;
}

export async function clientRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; active?: string } }>('/api/clients', async (req) => {
    const u = me(req);
    const { q, active } = req.query;
    const openReqs = sql<number>`(select count(*)::int from ${requirements} r where r.client_id = ${clients.id} and r.status in ('open','on_hold'))`;
    const openPositions = sql<number>`(select coalesce(sum(r.openings - (select count(*) from applications a where a.requirement_id = r.id and a.status = 'joined')),0)::int from ${requirements} r where r.client_id = ${clients.id} and r.status = 'open')`;
    const rows = await app.db
      .select({ client: clients, openRequirements: openReqs, openPositions })
      .from(clients)
      .where(
        and(
          q ? ilike(clients.name, `%${q}%`) : undefined,
          active === 'false' ? eq(clients.active, false) : active === 'all' ? undefined : eq(clients.active, true),
        ),
      )
      .orderBy(asc(clients.name));
    return rows.map((r) => ({ ...clientView(r.client, u.role), openRequirements: r.openRequirements, openPositions: r.openPositions }));
  });

  app.get<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const [c] = await app.db.select().from(clients).where(eq(clients.id, id));
    if (!c) throw notFound('Client');
    const contacts = await app.db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.name));
    const reqs = await app.db
      .select({
        id: requirements.id,
        code: requirements.code,
        title: requirements.title,
        status: requirements.status,
        openings: requirements.openings,
        createdAt: requirements.createdAt,
        ownerName: users.name,
        filled: sql<number>`(select count(*)::int from applications a where a.requirement_id = ${requirements.id} and a.status = 'joined')`,
        active: sql<number>`(select count(*)::int from applications a where a.requirement_id = ${requirements.id} and a.closed_at is null)`,
      })
      .from(requirements)
      .leftJoin(users, eq(users.id, requirements.ownerId))
      .where(eq(requirements.clientId, id))
      .orderBy(desc(requirements.createdAt));
    const timeline = await app.db
      .select({ id: activities.id, summary: activities.summary, verb: activities.verb, createdAt: activities.createdAt, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(eq(activities.clientId, id))
      .orderBy(desc(activities.id))
      .limit(50);
    return { ...clientView(c, u.role), contacts, requirements: reqs, timeline };
  });

  app.post('/api/clients', async (req) => {
    const u = me(req);
    const body = clientSchema.parse(req.body);
    // Recruiters may create clients but not set commercial terms.
    if (!canSeeFees(u.role)) {
      delete (body as Partial<typeof body>).feeType;
      delete (body as Partial<typeof body>).feeValue;
    }
    return app.db.transaction(async (tx) => {
      const [row] = await tx.insert(clients).values({ ...body, createdBy: u.id, updatedBy: u.id }).returning();
      await writeAudit(tx, u.id, 'client', row.id, 'create', createdChanges(row));
      await logActivity(tx, { actorId: u.id, verb: 'client.created', summary: `Added client ${row.name}`, clientId: row.id });
      return clientView(row, u.role);
    });
  });

  app.patch<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, ...body } = clientUpdateSchema.parse(req.body);
    if (!canSeeFees(u.role)) {
      delete body.feeType;
      delete body.feeValue;
    }
    return app.db.transaction(async (tx) => {
      const row = await updateVersioned<ClientRow>(tx, clients, 'client', id, version, body, u.id);
      return clientView(row, u.role);
    });
  });

  app.delete<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    const u = requireRole(req, 'manager');
    const id = Number(req.params.id);
    const [{ n }] = await app.db.select({ n: count() }).from(requirements).where(eq(requirements.clientId, id));
    if (n > 0) throw badRequest('This client has requirements. Mark it inactive instead.');
    await app.db.transaction(async (tx) => {
      const [row] = await tx.delete(clients).where(eq(clients.id, id)).returning();
      if (!row) throw notFound('Client');
      await writeAudit(tx, u.id, 'client', id, 'delete', createdChanges(row));
    });
    return { ok: true };
  });

  // Contacts
  app.post<{ Params: { id: string } }>('/api/clients/:id/contacts', async (req) => {
    const u = me(req);
    const clientId = Number(req.params.id);
    const body = contactSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
      if (!c) throw notFound('Client');
      if (body.isPrimary) await tx.update(clientContacts).set({ isPrimary: false }).where(eq(clientContacts.clientId, clientId));
      const [row] = await tx.insert(clientContacts).values({ ...body, clientId }).returning();
      await writeAudit(tx, u.id, 'client_contact', row.id, 'create', createdChanges(row));
      return row;
    });
  });

  app.patch<{ Params: { id: string; contactId: string } }>('/api/clients/:id/contacts/:contactId', async (req) => {
    const u = me(req);
    const clientId = Number(req.params.id);
    const contactId = Number(req.params.contactId);
    const body = contactSchema.partial().parse(req.body);
    return app.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)));
      if (!before) throw notFound('Contact');
      if (body.isPrimary) await tx.update(clientContacts).set({ isPrimary: false }).where(eq(clientContacts.clientId, clientId));
      const [row] = await tx
        .update(clientContacts)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(clientContacts.id, contactId))
        .returning();
      await writeAudit(tx, u.id, 'client_contact', contactId, 'update', diff(before, body));
      return row;
    });
  });

  app.delete<{ Params: { id: string; contactId: string } }>('/api/clients/:id/contacts/:contactId', async (req) => {
    const u = me(req);
    const contactId = Number(req.params.contactId);
    await app.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(clientContacts)
        .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, Number(req.params.id))))
        .returning();
      if (!row) throw notFound('Contact');
      await writeAudit(tx, u.id, 'client_contact', contactId, 'delete', createdChanges(row));
    });
    return { ok: true };
  });
}
