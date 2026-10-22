import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { loadConfig } from '../src/config';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { seedDefaults } from '../src/db/seed';
import { users } from '../src/db/schema';
import { hashPassword, randomToken } from '../src/lib/auth';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm_test';
export const PASSWORD = 'Password@123';

/** Fresh schema + defaults + four users (admin, manager, two recruiters). */
export async function setupApp() {
  const sql = postgres(TEST_DB, { onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await sql.end();
  await runMigrations(TEST_DB);
  const cfg = loadConfig({
    databaseUrl: TEST_DB,
    automationIntervalMs: 0,
    storage: {
      driver: 'local',
      localDir: `/tmp/crm-test-uploads-${randomBytes(4).toString('hex')}`,
    },
  });
  const app = await buildApp(cfg);
  await seedDefaults(app.db);
  const pw = await hashPassword(PASSWORD);
  await app.db.insert(users).values([
    {
      name: 'Asha Admin',
      email: 'admin@test.crm',
      role: 'admin',
      passwordHash: pw,
      referralCode: randomToken(9),
    },
    {
      name: 'Manoj Manager',
      email: 'manager@test.crm',
      role: 'manager',
      passwordHash: pw,
      referralCode: randomToken(9),
    },
    {
      name: 'Riya Recruiter',
      email: 'riya@test.crm',
      role: 'recruiter',
      passwordHash: pw,
      referralCode: randomToken(9),
    },
    {
      name: 'Rohan Recruiter',
      email: 'rohan@test.crm',
      role: 'recruiter',
      passwordHash: pw,
      referralCode: randomToken(9),
    },
  ]);
  return app;
}

export interface Agent {
  id: number;
  name: string;
  get: <T = any>(url: string) => Promise<Res<T>>;
  post: <T = any>(url: string, body?: unknown) => Promise<Res<T>>;
  put: <T = any>(url: string, body?: unknown) => Promise<Res<T>>;
  patch: <T = any>(url: string, body?: unknown) => Promise<Res<T>>;
  del: <T = any>(url: string) => Promise<Res<T>>;
  upload: <T = any>(
    url: string,
    fileName: string,
    content: Buffer,
    type: string,
    fields?: Record<string, string>,
  ) => Promise<Res<T>>;
}
export interface Res<T> {
  status: number;
  body: T;
}

export async function login(app: FastifyInstance, email: string): Promise<Agent> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.body}`);
  const cookie = r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const { csrfToken, user } = r.json();
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url,
      payload: body as any,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
  };
  return {
    id: user.id,
    name: user.name,
    get: (u) => call('GET', u) as any,
    post: (u, b) => call('POST', u, b ?? {}) as any,
    put: (u, b) => call('PUT', u, b ?? {}) as any,
    patch: (u, b) => call('PATCH', u, b ?? {}) as any,
    del: (u) => call('DELETE', u) as any,
    upload: async (url, fileName, content, type, fields = {}) => {
      const boundary = `----crm${randomBytes(8).toString('hex')}`;
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${type}\r\n\r\n`,
        ),
      );
      parts.push(content, Buffer.from(`\r\n--${boundary}--\r\n`));
      const res = await app.inject({
        method: 'POST',
        url,
        payload: Buffer.concat(parts),
        headers: {
          cookie,
          'x-csrf-token': csrfToken,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });
      return { status: res.statusCode, body: safeJson(res.body) } as any;
    },
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

/** Creates an open requirement with a client; returns ids. */
export async function openRequirement(
  owner: Agent,
  opts: { clientId?: number; title?: string; openings?: number } = {},
) {
  let clientId = opts.clientId;
  if (!clientId) {
    const c = await owner.post('/api/clients', {
      name: `Client ${randomBytes(3).toString('hex')}`,
      replacementDays: 90,
      feedbackChaseDays: 2,
    });
    clientId = c.body.id;
  }
  const r = await owner.post('/api/requirements', {
    clientId,
    title: opts.title ?? 'Senior React Developer',
    openings: opts.openings ?? 2,
    skills: ['React'],
  });
  const open = await owner.post(`/api/requirements/${r.body.id}/status`, {
    version: r.body.version,
    status: 'open',
  });
  if (open.status !== 200) throw new Error(JSON.stringify(open.body));
  return { clientId: clientId!, requirementId: r.body.id as number };
}

let phoneSeq = 0;
export async function newCandidate(agent: Agent, extra: Record<string, unknown> = {}) {
  phoneSeq++;
  const r = await agent.post('/api/candidates', {
    name: `Candidate ${phoneSeq} ${randomBytes(2).toString('hex')}`,
    phone: `98${String(10000000 + phoneSeq * 7919).slice(0, 8)}`,
    currentCompany: 'Infosys',
    totalExp: 5,
    currentCtc: 1200000,
    expectedCtc: 1600000,
    noticeDays: 30,
    ...extra,
  });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

export const SCREENING = {
  interested: true,
  currentCtc: 1200000,
  expectedCtc: 1600000,
  noticeDays: 30,
  noticeNegotiable: false,
  currentLocation: 'Pune',
  willingToRelocate: true,
  skillRating: 4,
  remarks: 'Strong React and TypeScript',
};

/** Moves a fresh application up to Screening/screened_ok with the card filled; returns the app. */
export async function screenedApplication(
  agent: Agent,
  candidateId: number,
  requirementId: number,
) {
  const a = await agent.post('/api/applications', {
    candidateId,
    requirementId,
    stage: 'screening',
  });
  if (a.status !== 200) throw new Error(JSON.stringify(a.body));
  const s = await agent.put(`/api/applications/${a.body.id}/screening`, {
    version: a.body.version,
    ...SCREENING,
  });
  return s.body;
}
