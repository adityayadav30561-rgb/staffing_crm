import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  candidateSchema,
  candidateUpdateSchema,
  formatLpa,
  noteSchema,
  normalizeEmail,
  normalizePhone,
  type CandidateInput,
} from '@crm/shared';
import {
  activities,
  applications,
  candidateNotes,
  candidates,
  clients,
  requirements,
  resumes,
  users,
} from '../db/schema';
import type { Tx } from '../db';
import { me, requireRole } from '../app';
import { badRequest, notFound } from '../lib/errors';
import { createdChanges, logActivity, writeAudit } from '../lib/audit';
import { updateVersioned } from '../lib/lock';
import { findDuplicates } from '../lib/duplicates';
import { ALLOWED_DOC_TYPES, newKey, sniffDocType } from '../lib/storage';
import { sendXlsx, toXlsx } from '../lib/xlsx';

type CandRow = typeof candidates.$inferSelect;

interface ListQuery {
  q?: string;
  skill?: string;
  location?: string;
  expMin?: string;
  expMax?: string;
  noticeMax?: string;
  source?: string;
  sourcedBy?: string;
  page?: string;
  pageSize?: string;
}

/** Derived columns kept in sync with what the user typed. */
export function normalizedFields(body: Partial<CandidateInput>) {
  const out: Partial<CandRow> = {};
  if ('phone' in body) out.phoneE164 = normalizePhone(body.phone);
  if ('email' in body) out.emailNorm = normalizeEmail(body.email);
  return out;
}

function listConditions(q: ListQuery): SQL[] {
  const conds: SQL[] = [];
  if (q.q?.trim()) {
    const term = q.q.trim();
    const digits = term.replace(/\D/g, '');
    const like = `%${term}%`;
    conds.push(
      or(
        ilike(candidates.name, like),
        ilike(candidates.email, like),
        ilike(candidates.currentCompany, like),
        ilike(candidates.currentTitle, like),
        sql`array_to_string(${candidates.skills}, ',') ilike ${like}`,
        digits.length >= 4 ? sql`${candidates.phoneE164} like ${'%' + digits + '%'}` : undefined,
      )!,
    );
  }
  if (q.skill) {
    for (const s of q.skill.split(',').map((x) => x.trim()).filter(Boolean)) {
      conds.push(sql`array_to_string(${candidates.skills}, ',') ilike ${'%' + s + '%'}`);
    }
  }
  if (q.location) conds.push(or(ilike(candidates.location, `%${q.location}%`), ilike(candidates.preferredLocations, `%${q.location}%`))!);
  if (q.expMin) conds.push(gte(candidates.totalExp, Number(q.expMin)));
  if (q.expMax) conds.push(lte(candidates.totalExp, Number(q.expMax)));
  if (q.noticeMax) conds.push(lte(candidates.noticeDays, Number(q.noticeMax)));
  if (q.source) conds.push(ilike(candidates.source, `${q.source}%`));
  if (q.sourcedBy) conds.push(eq(candidates.sourcedBy, Number(q.sourcedBy)));
  return conds;
}

const activeAppsSql = sql<number>`(select count(*)::int from ${applications} a where a.candidate_id = ${candidates.id} and a.closed_at is null)`;

export async function candidateRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/api/candidates', async (req) => {
    me(req);
    const q = req.query;
    const pageSize = Math.min(Number(q.pageSize ?? 50), 200);
    const page = Math.max(Number(q.page ?? 1), 1);
    const where = and(...listConditions(q));
    const [rows, [{ total }]] = await Promise.all([
      app.db
        .select({ c: candidates, sourcedByName: users.name, activeApps: activeAppsSql })
        .from(candidates)
        .leftJoin(users, eq(users.id, candidates.sourcedBy))
        .where(where)
        .orderBy(desc(candidates.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      app.db.select({ total: sql<number>`count(*)::int` }).from(candidates).where(where),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({ ...r.c, sourcedByName: r.sourcedByName, activeApps: r.activeApps })),
    };
  });

  app.get<{ Querystring: ListQuery }>('/api/candidates/export', async (req, reply) => {
    requireRole(req, 'manager');
    const rows = await app.db
      .select({ c: candidates, sourcedByName: users.name })
      .from(candidates)
      .leftJoin(users, eq(users.id, candidates.sourcedBy))
      .where(and(...listConditions(req.query)))
      .orderBy(desc(candidates.updatedAt));
    const buf = await toXlsx('Candidates', [
      { header: 'Name', value: (r) => r.c.name, width: 24 },
      { header: 'Phone', value: (r) => r.c.phone, width: 16 },
      { header: 'Email', value: (r) => r.c.email, width: 28 },
      { header: 'Current company', value: (r) => r.c.currentCompany, width: 22 },
      { header: 'Designation', value: (r) => r.c.currentTitle, width: 22 },
      { header: 'Experience (yrs)', value: (r) => r.c.totalExp },
      { header: 'Current CTC', value: (r) => r.c.currentCtc },
      { header: 'Expected CTC', value: (r) => r.c.expectedCtc },
      { header: 'Notice (days)', value: (r) => r.c.noticeDays },
      { header: 'Location', value: (r) => r.c.location },
      { header: 'Skills', value: (r) => r.c.skills.join(', '), width: 30 },
      { header: 'Source', value: (r) => r.c.source },
      { header: 'Sourced by', value: (r) => r.sourcedByName },
      { header: 'Added on', value: (r) => r.c.createdAt },
    ], rows);
    return sendXlsx(reply, `candidates-${new Date().toISOString().slice(0, 10)}.xlsx`, buf);
  });

  app.get<{ Querystring: { phone?: string; email?: string; name?: string; currentCompany?: string; excludeId?: string } }>(
    '/api/candidates/duplicates',
    async (req) => {
      me(req);
      const q = req.query;
      return findDuplicates(app.db, { ...q, excludeId: q.excludeId ? Number(q.excludeId) : undefined });
    },
  );

  app.get<{ Params: { id: string } }>('/api/candidates/:id', async (req) => {
    me(req);
    const id = Number(req.params.id);
    const [row] = await app.db
      .select({ c: candidates, sourcedByName: users.name })
      .from(candidates)
      .leftJoin(users, eq(users.id, candidates.sourcedBy))
      .where(eq(candidates.id, id));
    if (!row) throw notFound('Candidate');
    const submitter = sql<string | null>`(select name from ${users} su where su.id = ${applications.submittedBy})`;
    const [resumeRows, apps, notes, timeline] = await Promise.all([
      app.db
        .select({ r: resumes, uploadedByName: users.name })
        .from(resumes)
        .leftJoin(users, eq(users.id, resumes.uploadedBy))
        .where(eq(resumes.candidateId, id))
        .orderBy(desc(resumes.versionNo)),
      app.db
        .select({
          id: applications.id,
          stage: applications.stage,
          status: applications.status,
          submittedAt: applications.submittedAt,
          submittedByName: submitter,
          closedAt: applications.closedAt,
          updatedAt: applications.updatedAt,
          requirementId: requirements.id,
          requirementTitle: requirements.title,
          requirementCode: requirements.code,
          clientId: clients.id,
          clientName: clients.name,
        })
        .from(applications)
        .innerJoin(requirements, eq(requirements.id, applications.requirementId))
        .innerJoin(clients, eq(clients.id, requirements.clientId))
        .where(eq(applications.candidateId, id))
        .orderBy(desc(applications.updatedAt)),
      app.db
        .select({ n: candidateNotes, authorName: users.name })
        .from(candidateNotes)
        .leftJoin(users, eq(users.id, candidateNotes.authorId))
        .where(eq(candidateNotes.candidateId, id))
        .orderBy(desc(candidateNotes.createdAt)),
      app.db
        .select({ id: activities.id, summary: activities.summary, verb: activities.verb, createdAt: activities.createdAt, actorName: users.name })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.actorId))
        .where(eq(activities.candidateId, id))
        .orderBy(desc(activities.id))
        .limit(60),
    ]);
    return {
      ...row.c,
      sourcedByName: row.sourcedByName,
      resumes: resumeRows.map((r) => ({ ...r.r, uploadedByName: r.uploadedByName })),
      applications: apps,
      noteEntries: notes.map((n) => ({ ...n.n, authorName: n.authorName })),
      timeline,
    };
  });

  app.post('/api/candidates', async (req) => {
    const u = me(req);
    const body = candidateSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const duplicates = await findDuplicates(tx, body);
      const row = await insertCandidate(tx, u.id, { ...body, sourcedBy: u.id });
      if (duplicates.length) {
        await logActivity(tx, {
          actorId: u.id,
          verb: 'candidate.duplicate_override',
          summary: `Added ${row.name} despite ${duplicates.length} possible duplicate${duplicates.length > 1 ? 's' : ''} (${duplicates.map((d) => d.name).join(', ')})`,
          candidateId: row.id,
          payload: { duplicateIds: duplicates.map((d) => d.id) },
        });
      }
      return { ...row, duplicates };
    });
  });

  app.patch<{ Params: { id: string } }>('/api/candidates/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, ...body } = candidateUpdateSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const row = await updateVersioned<CandRow>(tx, candidates, 'candidate', id, version, { ...body, ...normalizedFields(body) }, u.id);
      await logActivity(tx, { actorId: u.id, verb: 'candidate.updated', summary: `Updated profile of ${row.name}`, candidateId: id });
      return row;
    });
  });

  app.delete<{ Params: { id: string } }>('/api/candidates/:id', async (req) => {
    const u = requireRole(req, 'manager');
    const id = Number(req.params.id);
    const keys = await app.db.transaction(async (tx) => {
      const files = await tx.select({ key: resumes.storageKey }).from(resumes).where(eq(resumes.candidateId, id));
      const [row] = await tx.delete(candidates).where(eq(candidates.id, id)).returning();
      if (!row) throw notFound('Candidate');
      await writeAudit(tx, u.id, 'candidate', id, 'delete', createdChanges(row));
      return files.map((f) => f.key);
    });
    await Promise.all(keys.map((k) => app.storage.delete(k)));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/candidates/:id/notes', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = noteSchema.extend({ applicationId: z.coerce.number().int().optional().nullable() }).parse(req.body);
    return app.db.transaction(async (tx) => {
      const [c] = await tx.select({ name: candidates.name }).from(candidates).where(eq(candidates.id, id));
      if (!c) throw notFound('Candidate');
      let appRow: { requirementId: number } | undefined;
      if (body.applicationId) {
        [appRow] = await tx
          .select({ requirementId: applications.requirementId })
          .from(applications)
          .where(and(eq(applications.id, body.applicationId), eq(applications.candidateId, id)));
        if (!appRow) throw badRequest('That application belongs to another candidate');
      }
      const [row] = await tx
        .insert(candidateNotes)
        .values({ candidateId: id, applicationId: body.applicationId ?? null, body: body.body, authorId: u.id })
        .returning();
      await logActivity(tx, {
        actorId: u.id,
        verb: 'candidate.note',
        summary: `Note on ${c.name}: ${body.body.slice(0, 120)}${body.body.length > 120 ? '…' : ''}`,
        candidateId: id,
        requirementId: appRow?.requirementId ?? null,
        applicationId: body.applicationId ?? null,
      });
      return { ...row, authorName: u.name };
    });
  });

  app.post<{ Params: { id: string } }>('/api/candidates/:id/resumes', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const file = await req.file();
    if (!file) throw badRequest('Attach a resume');
    const buf = await file.toBuffer();
    return saveResume(app, u.id, id, file.filename, file.mimetype, buf);
  });

  app.get<{ Params: { id: string } }>('/api/resumes/:id/url', async (req) => {
    me(req);
    const [r] = await app.db.select().from(resumes).where(eq(resumes.id, Number(req.params.id)));
    if (!r) throw notFound('Resume');
    return { url: await app.storage.signedUrl(r.storageKey, r.fileName) };
  });
}

export async function insertCandidate(
  tx: Tx,
  actorId: number | null,
  body: CandidateInput & { sourcedBy?: number | null; referredBy?: number | null; importJobId?: number },
  activitySummary?: string,
) {
  const [row] = await tx
    .insert(candidates)
    .values({ ...body, ...normalizedFields(body), updatedBy: actorId })
    .returning();
  await writeAudit(tx, actorId, 'candidate', row.id, 'create', createdChanges(row));
  await logActivity(tx, {
    actorId,
    verb: 'candidate.created',
    summary:
      activitySummary ??
      `Added ${row.name}${row.currentCompany ? ` (${row.currentCompany})` : ''}${row.expectedCtc ? `, expects ${formatLpa(row.expectedCtc)}` : ''}${row.source ? ` · via ${row.source}` : ''}`,
    candidateId: row.id,
  });
  return row;
}

export async function saveResume(
  app: FastifyInstance,
  actorId: number | null,
  candidateId: number,
  fileName: string,
  declaredType: string,
  buf: Buffer,
) {
  const type = sniffDocType(buf, declaredType);
  if (!type) throw badRequest('Upload the resume as PDF, Word (.doc/.docx), RTF or text');
  const key = newKey('resumes', ALLOWED_DOC_TYPES[type]);
  await app.storage.put(key, buf, type);
  try {
    return await app.db.transaction(async (tx) => {
      const [c] = await tx.select({ name: candidates.name }).from(candidates).where(eq(candidates.id, candidateId));
      if (!c) throw notFound('Candidate');
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${resumes.versionNo}), 0)::int + 1` })
        .from(resumes)
        .where(eq(resumes.candidateId, candidateId));
      const [row] = await tx
        .insert(resumes)
        .values({ candidateId, storageKey: key, fileName, mimeType: type, sizeBytes: buf.length, versionNo: next, uploadedBy: actorId })
        .returning();
      await tx.update(candidates).set({ updatedAt: new Date() }).where(eq(candidates.id, candidateId));
      await writeAudit(tx, actorId, 'resume', row.id, 'create', createdChanges(row));
      await logActivity(tx, { actorId, verb: 'candidate.resume', summary: `Uploaded resume v${next} for ${c.name}`, candidateId });
      return row;
    });
  } catch (e) {
    await app.storage.delete(key);
    throw e;
  }
}
