import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { and, eq, gt } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Role } from '@crm/shared';
import { isManager } from '@crm/shared';
import type { Config } from './config';
import { createDb, type DB } from './db';
import { sessions, users } from './db/schema';
import { HttpError, forbidden, unauthorized } from './lib/errors';
import { SESSION_COOKIE, SESSION_TTL_MS, sha256 } from './lib/auth';
import { createStorage, MAX_UPLOAD_BYTES, type Storage } from './lib/storage';
import { Automation } from './automation/scheduler';
import { registerRoutes } from './routes';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  csrfToken: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    cfg: Config;
    storage: Storage;
    automation: Automation;
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const PUBLIC_PATHS = ['/api/auth/login', '/api/health', '/api/public/', '/api/files/'];

export async function buildApp(
  cfg: Config,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  const { db, client } = createDb(cfg.databaseUrl);
  app.decorate('db', db);
  app.decorate('cfg', cfg);
  app.decorate('storage', createStorage(cfg));
  app.decorate('automation', new Automation(db));
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => {
    app.automation.stop();
    await client.end();
  });

  await app.register(cookie, { secret: cfg.sessionSecret });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: cfg.isProd ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 30 } });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = await loadSession(app, req);
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;
    if (!req.user) throw unauthorized();
    // CSRF: state-changing requests must echo the session's token in a header.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-csrf-token'] !== req.user.csrfToken) {
        reply.code(403);
        throw new HttpError(403, 'Security token missing or expired. Reload the page.', 'CSRF');
      }
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.message, code: err.code, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '),
        code: 'VALIDATION',
        details: err.flatten(),
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await registerRoutes(app);

  // Serve the built SPA in production (apps/web/dist).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = [path.resolve(here, '../../web/dist'), path.resolve(here, '../web')].find((p) =>
    existsSync(path.join(p, 'index.html')),
  );
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

async function loadSession(app: FastifyInstance, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const id = sha256(token);
  const now = new Date();
  const [row] = await app.db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)));
  if (!row || !row.active) return null;
  // Sliding expiry: extend once less than half the lifetime remains.
  if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
    await app.db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    csrfToken: row.csrfToken,
    sessionId: id,
  };
}

/** Throws 403 unless the user has one of the roles (admin always passes manager checks). */
export function requireRole(req: FastifyRequest, role: 'manager' | 'admin'): SessionUser {
  const u = req.user;
  if (!u) throw unauthorized();
  if (role === 'admin' ? u.role !== 'admin' : !isManager(u.role)) throw forbidden();
  return u;
}

export function me(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
