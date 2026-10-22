import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { userCreateSchema, userUpdateSchema } from '@crm/shared';
import { sessions, users } from '../db/schema';
import { me, requireRole } from '../app';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors';
import { hashPassword, randomToken } from '../lib/auth';
import { createdChanges, diff, writeAudit } from '../lib/audit';
import { publicUser } from './auth';

export async function userRoutes(app: FastifyInstance) {
  /** Everyone can list active users (for assignee and owner pickers). */
  app.get('/api/users', async (req) => {
    const u = me(req);
    const rows = await app.db.select().from(users).orderBy(asc(users.name));
    return rows
      .filter((r) => r.active || u.role === 'admin')
      .map((r) =>
        u.role === 'admin'
          ? publicUser(r)
          : { id: r.id, name: r.name, role: r.role, active: r.active },
      );
  });

  app.post('/api/users', async (req) => {
    const admin = requireRole(req, 'admin');
    const body = userCreateSchema.parse(req.body);
    try {
      const [row] = await app.db
        .insert(users)
        .values({
          name: body.name,
          email: body.email,
          role: body.role,
          passwordHash: await hashPassword(body.password),
          referralCode: randomToken(9),
        })
        .returning();
      await writeAudit(app.db, admin.id, 'user', row.id, 'create', createdChanges(publicUser(row)));
      return publicUser(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A user with this email already exists');
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const admin = requireRole(req, 'admin');
    const id = Number(req.params.id);
    const body = userUpdateSchema.parse(req.body);
    const [before] = await app.db.select().from(users).where(eq(users.id, id));
    if (!before) throw notFound('User');
    if (id === admin.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('You cannot deactivate or demote yourself');
    }
    const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (body.name) values.name = body.name;
    if (body.role) values.role = body.role;
    if (body.active !== undefined) values.active = body.active;
    if (body.password) values.passwordHash = await hashPassword(body.password);
    const [row] = await app.db.update(users).set(values).where(eq(users.id, id)).returning();
    if (body.active === false || body.password) {
      await app.db.delete(sessions).where(eq(sessions.userId, id));
    }
    const changes = diff(publicUser(before), {
      name: body.name,
      role: body.role,
      active: body.active,
    });
    if (body.password) changes.password = ['***', '***'];
    await writeAudit(app.db, admin.id, 'user', id, 'update', changes);
    return publicUser(row);
  });
}
