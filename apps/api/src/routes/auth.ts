import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { changePasswordSchema, loginSchema } from '@crm/shared';
import { sessions, users } from '../db/schema';
import { me } from '../app';
import { badRequest, unauthorized } from '../lib/errors';
import { hashPassword, randomToken, SESSION_COOKIE, SESSION_TTL_MS, sha256, verifyPassword } from '../lib/auth';
import { writeAudit } from '../lib/audit';

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const [user] = await app.db.select().from(users).where(eq(users.email, body.email));
      // Verify even for unknown users so timing doesn't reveal which emails exist.
      const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, body.password);
      if (!user || !ok || !user.active) throw unauthorized('Email or password is incorrect');

      const token = randomToken();
      const csrfToken = randomToken(24);
      await app.db.insert(sessions).values({
        id: sha256(token),
        userId: user.id,
        csrfToken,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      });
      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: app.cfg.isProd,
        maxAge: 30 * 24 * 3600, // the server-side expiry is the real limit
      });
      return { user: publicUser(user), csrfToken };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const u = me(req);
    await app.db.delete(sessions).where(eq(sessions.id, u.sessionId));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = me(req);
    const [user] = await app.db.select().from(users).where(eq(users.id, u.id));
    return { user: publicUser(user), csrfToken: u.csrfToken };
  });

  app.post('/api/auth/password', async (req) => {
    const u = me(req);
    const body = changePasswordSchema.parse(req.body);
    const [user] = await app.db.select().from(users).where(eq(users.id, u.id));
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw badRequest('Current password is incorrect');
    }
    await app.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
      .where(eq(users.id, u.id));
    // Sign out other devices.
    await app.db.delete(sessions).where(and(eq(sessions.userId, u.id), ne(sessions.id, u.sessionId)));
    await writeAudit(app.db, u.id, 'user', u.id, 'update', { password: ['***', '***'] });
    return { ok: true };
  });
}

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';

export function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    referralCode: u.referralCode,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}
