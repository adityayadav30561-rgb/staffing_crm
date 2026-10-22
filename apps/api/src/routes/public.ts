import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { referralSchema, splitSkills } from '@crm/shared';
import { candidates, clients, requirements, users } from '../db/schema';
import { me } from '../app';
import { badRequest, notFound } from '../lib/errors';
import { verifyLocal } from '../lib/storage';
import { notify } from '../lib/notify';
import { findDuplicates } from '../lib/duplicates';
import { logActivity } from '../lib/audit';
import { insertCandidate, saveResume } from './candidates';

export async function publicRoutes(app: FastifyInstance) {
  /** Signed, short-lived download of a stored file (local storage driver). */
  app.get<{ Params: { token: string } }>('/api/files/:token', async (req, reply) => {
    const v = verifyLocal(app.cfg.sessionSecret, req.params.token);
    if (!v) throw notFound('File (the link may have expired)');
    const buf = await app.storage.get(v.key);
    const ext = v.key.split('.').pop();
    const type =
      ext === 'pdf'
        ? 'application/pdf'
        : ext === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === 'doc'
            ? 'application/msword'
            : ext === 'rtf'
              ? 'application/rtf'
              : 'text/plain; charset=utf-8';
    return reply
      .header('Content-Type', type)
      .header(
        'Content-Disposition',
        `${ext === 'pdf' ? 'inline' : 'attachment'}; filename="${v.name.replace(/[^\w.\- ]/g, '_')}"`,
      )
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(buf);
  });

  // Employee referral link: /refer/:code (no login).
  app.get<{ Params: { code: string } }>('/api/public/referral/:code', async (req) => {
    const [u] = await app.db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.referralCode, req.params.code), eq(users.active, true)));
    if (!u) throw notFound('Referral link');
    return { referrerName: u.name };
  });

  app.post<{ Params: { code: string } }>(
    '/api/public/referral/:code',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req) => {
      const [referrer] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.referralCode, req.params.code), eq(users.active, true)));
      if (!referrer) throw notFound('Referral link');
      const fields: Record<string, string> = {};
      let file: { name: string; type: string; buf: Buffer } | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          file = { name: part.filename, type: part.mimetype, buf: await part.toBuffer() };
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
      const body = referralSchema.parse(fields);
      const dupes = await findDuplicates(app.db, {
        phone: body.phone,
        email: body.email,
        name: body.name,
        currentCompany: body.currentCompany,
      });
      const source = `Referral – ${referrer.name}`;
      const cand = await app.db.transaction(async (tx) => {
        const c = await insertCandidate(
          tx,
          null,
          {
            name: body.name,
            phone: body.phone,
            email: body.email,
            currentCompany: body.currentCompany,
            currentTitle: body.currentTitle,
            totalExp: body.totalExp,
            location: body.location,
            skills: splitSkills(body.skills),
            source,
            notes: body.message,
            sourcedBy: referrer.id,
            referredBy: referrer.id,
          } as never,
          `${body.name} was referred through ${referrer.name}'s link`,
        );
        if (dupes.length) {
          await logActivity(tx, {
            actorId: null,
            verb: 'candidate.duplicate_override',
            summary: `Referral ${c.name} may duplicate ${dupes.map((d) => d.name).join(', ')}`,
            candidateId: c.id,
          });
        }
        await notify(tx, [referrer.id], {
          title: `New referral: ${c.name}`,
          body: dupes.length ? 'Possible duplicate — check before mapping' : undefined,
          link: `/candidates/${c.id}`,
        });
        return c;
      });
      if (file && file.buf.length) {
        await saveResume(app, null, cand.id, file.name, file.type, file.buf).catch(() => {
          throw badRequest(
            'Thanks! The details were saved, but the resume must be a PDF or Word file.',
          );
        });
      }
      return { ok: true };
    },
  );

  /** Global search in the top bar. */
  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    me(req);
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { candidates: [], requirements: [], clients: [] };
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const [c, r, cl] = await Promise.all([
      app.db
        .select({
          id: candidates.id,
          name: candidates.name,
          currentCompany: candidates.currentCompany,
          phone: candidates.phone,
        })
        .from(candidates)
        .where(
          or(
            ilike(candidates.name, like),
            ilike(candidates.email, like),
            ilike(candidates.currentCompany, like),
            digits.length >= 4
              ? sql`${candidates.phoneE164} like ${'%' + digits + '%'}`
              : undefined,
          ),
        )
        .orderBy(desc(sql`similarity(${candidates.name}, ${q})`))
        .limit(8),
      app.db
        .select({
          id: requirements.id,
          code: requirements.code,
          title: requirements.title,
          status: requirements.status,
          clientName: clients.name,
        })
        .from(requirements)
        .innerJoin(clients, eq(clients.id, requirements.clientId))
        .where(or(ilike(requirements.title, like), ilike(requirements.code, like)))
        .orderBy(desc(requirements.createdAt))
        .limit(5),
      app.db
        .select({ id: clients.id, name: clients.name, city: clients.city })
        .from(clients)
        .where(ilike(clients.name, like))
        .limit(5),
    ]);
    return { candidates: c, requirements: r, clients: cl };
  });
}
