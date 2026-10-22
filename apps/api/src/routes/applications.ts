import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  applicationCreateSchema,
  canSeeFees,
  INTERVIEW_STATUS_LABELS,
  interviewSchema,
  interviewUpdateSchema,
  JOINING_RISK_LABELS,
  joiningRiskSchema,
  missingScreeningFields,
  moveSchema,
  offerSchema,
  screeningSchema,
  STAGE_ENTRY_STATUS,
  STATUS_LABELS,
  submissionSchema,
  version as versionSchema,
  formatLpa,
  type AppStatus,
  type Stage,
} from '@crm/shared';
import type { Tx } from '../db';
import {
  activities,
  applications,
  candidateNotes,
  candidates,
  clients,
  interviews,
  lookups,
  offers,
  placements,
  requirements,
  resumes,
  users,
} from '../db/schema';
import { me } from '../app';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors';
import { createdChanges, diff, logActivity, writeAudit } from '../lib/audit';
import { updateVersioned } from '../lib/lock';
import { assertCanWork, loadApplication, requirementAccess } from '../lib/access';
import { appContext, applyMove } from '../lib/pipeline';
import { getSettings } from '../lib/settings';
import { sendXlsx, toXlsx } from '../lib/xlsx';

type AppRow = typeof applications.$inferSelect;
type InterviewRow = typeof interviews.$inferSelect;

interface ListQuery {
  requirementId?: string;
  clientId?: string;
  candidateId?: string;
  stage?: string;
  status?: string;
  active?: 'true' | 'false' | 'all';
  recruiterId?: string;
  q?: string;
  risk?: string;
}

const userName = (col: any) => sql<string | null>`(select name from ${users} x where x.id = ${col})`;

export async function applicationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/api/applications', async (req) => {
    me(req);
    const q = req.query;
    const conds: SQL[] = [];
    if (q.requirementId) conds.push(eq(applications.requirementId, Number(q.requirementId)));
    if (q.clientId) conds.push(eq(requirements.clientId, Number(q.clientId)));
    if (q.candidateId) conds.push(eq(applications.candidateId, Number(q.candidateId)));
    if (q.stage) conds.push(inArray(applications.stage, q.stage.split(',') as Stage[]));
    if (q.status) conds.push(inArray(applications.status, q.status.split(',') as AppStatus[]));
    if ((q.active ?? 'true') === 'true') conds.push(isNull(applications.closedAt));
    if (q.active === 'false') conds.push(isNotNull(applications.closedAt));
    if (q.recruiterId) {
      const rid = Number(q.recruiterId);
      conds.push(or(eq(applications.submittedBy, rid), eq(applications.addedBy, rid))!);
    }
    if (q.risk === 'true') conds.push(isNotNull(applications.joiningRisk));
    if (q.q) conds.push(or(ilike(candidates.name, `%${q.q}%`), ilike(candidates.currentCompany, `%${q.q}%`))!);
    const rows = await app.db
      .select({
        a: applications,
        candidateName: candidates.name,
        candidatePhone: candidates.phone,
        candidateCompany: candidates.currentCompany,
        candidateTitle: candidates.currentTitle,
        totalExp: candidates.totalExp,
        currentCtc: candidates.currentCtc,
        expectedCtc: candidates.expectedCtc,
        noticeDays: candidates.noticeDays,
        requirementTitle: requirements.title,
        requirementCode: requirements.code,
        clientId: clients.id,
        clientName: clients.name,
        submittedByName: userName(applications.submittedBy),
        addedByName: userName(applications.addedBy),
        nextInterviewAt: sql<Date | null>`(select min(scheduled_at) from ${interviews} i where i.application_id = ${applications.id} and i.status in ('scheduled','rescheduled') and i.scheduled_at > now() - interval '3 hours')`,
        roundCount: sql<number>`(select count(*)::int from ${interviews} i where i.application_id = ${applications.id})`,
        expectedDoj: offers.expectedDoj,
        reasonLabel: lookups.label,
      })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(requirements, eq(requirements.id, applications.requirementId))
      .innerJoin(clients, eq(clients.id, requirements.clientId))
      .leftJoin(offers, eq(offers.applicationId, applications.id))
      .leftJoin(lookups, eq(lookups.id, applications.reasonId))
      .where(and(...conds))
      .orderBy(desc(applications.updatedAt))
      .limit(1000);
    return rows.map(({ a, ...rest }) => ({ ...a, ...rest }));
  });

  app.get<{ Params: { id: string } }>('/api/applications/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const a = await loadApplication(app.db, id);
    const acc = await requirementAccess(app.db, a.requirementId, u);
    const [[candidate], [requirement], rounds, [offer], [placement], resumeRows, notes, timeline, [reason], names] =
      await Promise.all([
        app.db.select().from(candidates).where(eq(candidates.id, a.candidateId)),
        app.db
          .select({
            id: requirements.id,
            code: requirements.code,
            title: requirements.title,
            status: requirements.status,
            ownerId: requirements.ownerId,
            clientId: clients.id,
            clientName: clients.name,
            budgetMin: requirements.budgetMin,
            budgetMax: requirements.budgetMax,
          })
          .from(requirements)
          .innerJoin(clients, eq(clients.id, requirements.clientId))
          .where(eq(requirements.id, a.requirementId)),
        app.db
          .select({ i: interviews, coordinatorName: users.name })
          .from(interviews)
          .leftJoin(users, eq(users.id, interviews.coordinatorId))
          .where(eq(interviews.applicationId, id))
          .orderBy(asc(interviews.roundNo)),
        app.db.select().from(offers).where(eq(offers.applicationId, id)),
        app.db.select().from(placements).where(eq(placements.applicationId, id)),
        app.db.select().from(resumes).where(eq(resumes.candidateId, a.candidateId)).orderBy(desc(resumes.versionNo)),
        app.db
          .select({ n: candidateNotes, authorName: users.name })
          .from(candidateNotes)
          .leftJoin(users, eq(users.id, candidateNotes.authorId))
          .where(eq(candidateNotes.applicationId, id))
          .orderBy(desc(candidateNotes.createdAt)),
        app.db
          .select({ id: activities.id, summary: activities.summary, verb: activities.verb, createdAt: activities.createdAt, actorName: users.name })
          .from(activities)
          .leftJoin(users, eq(users.id, activities.actorId))
          .where(eq(activities.applicationId, id))
          .orderBy(desc(activities.id))
          .limit(60),
        a.reasonId ? app.db.select().from(lookups).where(eq(lookups.id, a.reasonId)) : Promise.resolve([]),
        app.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [a.addedBy, a.submittedBy, a.screenedBy].filter((x): x is number => !!x).concat(0))),
      ]);
    const nameOf = (uid: number | null) => names.find((n) => n.id === uid)?.name ?? null;
    return {
      ...a,
      addedByName: nameOf(a.addedBy),
      submittedByName: nameOf(a.submittedBy),
      screenedByName: nameOf(a.screenedBy),
      reasonLabel: reason?.label ?? null,
      candidate,
      requirement,
      interviews: rounds.map((r) => ({ ...r.i, coordinatorName: r.coordinatorName })),
      offer: offer ?? null,
      placement: canSeeFees(u.role) ? (placement ?? null) : placement ? { id: placement.id, joinedOn: placement.joinedOn, guaranteeUntil: placement.guaranteeUntil } : null,
      resumes: resumeRows,
      notes: notes.map((n) => ({ ...n.n, authorName: n.authorName })),
      timeline,
      canWork: acc.canWork,
      missingScreening: missingScreeningFields(a.screening),
    };
  });

  app.post('/api/applications', async (req) => {
    const u = me(req);
    const body = applicationCreateSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const acc = await assertCanWork(tx, body.requirementId, u);
      if (acc.requirement.status !== 'open') {
        throw badRequest(`Candidates can be mapped only while the requirement is Open (it is ${acc.requirement.status.replace('_', ' ')})`);
      }
      const [cand] = await tx.select().from(candidates).where(eq(candidates.id, body.candidateId));
      if (!cand) throw notFound('Candidate');
      await assertNotOnRequirement(tx, body.candidateId, body.requirementId);
      if (!body.acknowledgeClientDuplicate) {
        await assertNoClientDuplicate(tx, body.candidateId, acc.requirement.clientId, null);
      }
      let row: AppRow;
      try {
        [row] = await tx
          .insert(applications)
          .values({
            candidateId: body.candidateId,
            requirementId: body.requirementId,
            stage: body.stage,
            status: STAGE_ENTRY_STATUS[body.stage],
            addedBy: u.id,
            updatedBy: u.id,
          })
          .returning();
      } catch (e) {
        // Two recruiters mapping the same person at the same moment: the unique index decides.
        if (isUniqueViolation(e, 'applications_candidate_requirement_uq')) {
          await assertNotOnRequirement(app.db, body.candidateId, body.requirementId);
        }
        throw e;
      }
      await writeAudit(tx, u.id, 'application', row.id, 'create', createdChanges(row));
      await logActivity(tx, {
        actorId: u.id,
        verb: 'app.created',
        summary: `Mapped ${cand.name} to ${acc.requirement.title}`,
        candidateId: cand.id,
        requirementId: acc.requirement.id,
        clientId: acc.requirement.clientId,
        applicationId: row.id,
      });
      return row;
    });
  });

  app.put<{ Params: { id: string } }>('/api/applications/:id/screening', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, ...card } = screeningSchema.extend({ version: versionSchema }).parse(req.body);
    return app.db.transaction(async (tx) => {
      const before = await loadApplication(tx, id);
      await assertCanWork(tx, before.requirementId, u);
      const row = await updateVersioned<AppRow>(tx, applications, 'application', id, version, {
        screening: { ...card, skillRating: card.skillRating ?? null },
        screenedBy: u.id,
        screenedAt: new Date(),
      }, u.id);
      // The screening call is the freshest data on the candidate: copy it to the profile.
      const [cand] = await tx.select().from(candidates).where(eq(candidates.id, row.candidateId));
      const profile: Partial<typeof candidates.$inferSelect> = {};
      if (card.currentCtc != null) profile.currentCtc = card.currentCtc;
      if (card.expectedCtc != null) profile.expectedCtc = card.expectedCtc;
      if (card.noticeDays != null) profile.noticeDays = card.noticeDays;
      if (card.currentLocation) profile.location = card.currentLocation;
      const changes = diff(cand, profile);
      if (Object.keys(changes).length) {
        await tx.update(candidates).set({ ...profile, updatedAt: new Date(), updatedBy: u.id, version: sql`${candidates.version} + 1` }).where(eq(candidates.id, cand.id));
        await writeAudit(tx, u.id, 'candidate', cand.id, 'update', changes);
      }
      const ctx = await appContext(tx, row);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'app.screened',
        summary: `Screened ${ctx.candidateName} for ${ctx.requirementTitle}: ${card.interested ? 'interested' : 'not interested'}, CTC ${formatLpa(card.currentCtc)} → ${formatLpa(card.expectedCtc)}, notice ${card.noticeDays ?? '—'} days`,
        candidateId: row.candidateId,
        requirementId: row.requirementId,
        clientId: ctx.clientId,
        applicationId: id,
      });
      return row;
    });
  });

  /** Doc step 5: the recruiter sent the profile outside the CRM; log it and move to Submitted. */
  app.post<{ Params: { id: string } }>('/api/applications/:id/submit', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, ...body } = submissionSchema.extend({ version: versionSchema }).parse(req.body);
    return app.db.transaction(async (tx) => {
      const before = await loadApplication(tx, id);
      const acc = await assertCanWork(tx, before.requirementId, u);
      if (before.stage !== 'screening' || before.closedAt) {
        throw badRequest('Only candidates in Screening can be submitted');
      }
      const missing = missingScreeningFields(before.screening);
      if (missing.length) throw badRequest(`Complete the screening card first (${missing.join(', ')})`, 'SCREENING_INCOMPLETE');
      if (!body.acknowledgeClientDuplicate) {
        await assertNoClientDuplicate(tx, before.candidateId, acc.requirement.clientId, before.id);
      }
      let resumeId = body.resumeId ?? null;
      if (resumeId) {
        const [r] = await tx.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.candidateId, before.candidateId)));
        if (!r) throw badRequest('Pick one of this candidate’s resumes');
      } else {
        const [latest] = await tx.select().from(resumes).where(eq(resumes.candidateId, before.candidateId)).orderBy(desc(resumes.versionNo)).limit(1);
        resumeId = latest?.id ?? null;
      }
      const logged = await updateVersioned<AppRow>(tx, applications, 'application', id, version, {
        status: 'screened_ok',
        submittedAt: new Date(body.submittedAt),
        submittedBy: u.id,
        submissionChannel: body.channel,
        submissionNote: body.note,
        resumeId,
      }, u.id);
      const ctx = await appContext(tx, logged);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'app.submitted',
        summary: `Submitted ${ctx.candidateName} to ${ctx.clientName} via ${body.channel} · ${ctx.requirementTitle}`,
        payload: { channel: body.channel, resumeId },
        candidateId: logged.candidateId,
        requirementId: logged.requirementId,
        clientId: ctx.clientId,
        applicationId: id,
      });
      const row = await applyMove(tx, u, logged, logged.version, { stage: 'submitted', status: 'feedback_pending' });
      app.automation.kick();
      return row;
    });
  });

  app.post<{ Params: { id: string } }>('/api/applications/:id/move', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = moveSchema.parse(req.body);
    const row = await app.db.transaction(async (tx) => {
      const before = await loadApplication(tx, id);
      await assertCanWork(tx, before.requirementId, u);
      if (body.stage === 'submitted' && before.stage === 'screening') {
        throw badRequest('Use "Mark submitted" to log how the profile was sent', 'USE_SUBMIT');
      }
      return applyMove(tx, u, before, body.version, body);
    });
    app.automation.kick();
    return row;
  });

  app.post<{ Params: { id: string } }>('/api/applications/:id/risk', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = joiningRiskSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const before = await loadApplication(tx, id);
      await assertCanWork(tx, before.requirementId, u);
      if (body.risk && !['offer', 'joining'].includes(before.stage)) throw badRequest('Joining risk applies after selection');
      const row = await updateVersioned<AppRow>(tx, applications, 'application', id, body.version, {
        joiningRisk: body.risk,
        joiningRiskNote: body.risk ? body.note : null,
      }, u.id);
      const ctx = await appContext(tx, row);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'app.risk',
        summary: body.risk
          ? `Joining risk on ${ctx.candidateName}: ${JOINING_RISK_LABELS[body.risk]}${body.note ? ` — ${body.note}` : ''}`
          : `Cleared joining risk on ${ctx.candidateName}`,
        candidateId: row.candidateId,
        requirementId: row.requirementId,
        clientId: ctx.clientId,
        applicationId: id,
      });
      return row;
    });
  });

  app.put<{ Params: { id: string } }>('/api/applications/:id/offer', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = offerSchema.parse(req.body);
    const row = await app.db.transaction(async (tx) => {
      const a = await loadApplication(tx, id);
      await assertCanWork(tx, a.requirementId, u);
      if (!['offer', 'joining'].includes(a.stage)) throw badRequest('Record the offer once the candidate is selected');
      const [before] = await tx.select().from(offers).where(eq(offers.applicationId, id));
      let row: typeof offers.$inferSelect;
      if (before) {
        [row] = await tx.update(offers).set({ ...body, updatedBy: u.id, updatedAt: new Date() }).where(eq(offers.id, before.id)).returning();
        await writeAudit(tx, u.id, 'offer', row.id, 'update', diff(before, body));
      } else {
        [row] = await tx.insert(offers).values({ ...body, applicationId: id, updatedBy: u.id }).returning();
        await writeAudit(tx, u.id, 'offer', row.id, 'create', createdChanges(row));
      }
      const ctx = await appContext(tx, a);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'app.offer',
        summary: `Offer for ${ctx.candidateName}: ${formatLpa(row.offeredCtc)}${row.expectedDoj ? `, joining ${row.expectedDoj}` : ''}`,
        candidateId: a.candidateId,
        requirementId: a.requirementId,
        clientId: ctx.clientId,
        applicationId: id,
      });
      return row;
    });
    app.automation.kick();
    return row;
  });

  // Interviews (doc steps 7-10). Coordination happens outside the CRM; this is the log.
  app.post<{ Params: { id: string } }>('/api/applications/:id/interviews', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const body = interviewSchema.parse(req.body);
    const row = await app.db.transaction(async (tx) => {
      const a = await loadApplication(tx, id);
      await assertCanWork(tx, a.requirementId, u);
      if (a.stage !== 'interview' || a.closedAt) throw badRequest('Move the candidate to Interview first (client shortlisted)');
      if (a.status === 'selected') throw badRequest('The candidate is already selected');
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${interviews.roundNo}), 0)::int + 1` })
        .from(interviews)
        .where(eq(interviews.applicationId, id));
      const [row] = await tx
        .insert(interviews)
        .values({ ...body, scheduledAt: new Date(body.scheduledAt), applicationId: id, roundNo: next, coordinatorId: body.coordinatorId ?? u.id, createdBy: u.id, updatedBy: u.id })
        .returning();
      await writeAudit(tx, u.id, 'interview', row.id, 'create', createdChanges(row));
      // "Next interview round" (doc step 10) puts the candidate back into interviewing.
      if (a.status !== 'interviewing') {
        await applyMove(tx, u, a, a.version, { stage: 'interview', status: 'interviewing' });
      }
      const ctx = await appContext(tx, a);
      await logActivity(tx, {
        actorId: u.id,
        verb: 'interview.scheduled',
        summary: `Round ${next}${row.label ? ` (${row.label})` : ''} for ${ctx.candidateName} on ${fmtWhen(row.scheduledAt)} · ${ctx.requirementTitle}`,
        candidateId: a.candidateId,
        requirementId: a.requirementId,
        clientId: ctx.clientId,
        applicationId: id,
      });
      return row;
    });
    app.automation.kick();
    return row;
  });

  app.patch<{ Params: { id: string } }>('/api/interviews/:id', async (req) => {
    const u = me(req);
    const id = Number(req.params.id);
    const { version, ...body } = interviewUpdateSchema.parse(req.body);
    const row = await app.db.transaction(async (tx) => {
      const [before] = await tx.select().from(interviews).where(eq(interviews.id, id));
      if (!before) throw notFound('Interview');
      const a = await loadApplication(tx, before.applicationId);
      await assertCanWork(tx, a.requirementId, u);
      const values: Partial<InterviewRow> = { ...body, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined };
      if (body.scheduledAt && new Date(body.scheduledAt).getTime() !== before.scheduledAt.getTime() && !body.status) {
        values.status = 'rescheduled';
      }
      const row = await updateVersioned<InterviewRow>(tx, interviews, 'interview', id, version, values, u.id);
      const ctx = await appContext(tx, a);
      const parts: string[] = [];
      if (values.status && values.status !== before.status) parts.push(INTERVIEW_STATUS_LABELS[values.status]);
      if (values.status === 'rescheduled' || (body.scheduledAt && row.scheduledAt.getTime() !== before.scheduledAt.getTime())) parts.push(`now ${fmtWhen(row.scheduledAt)}`);
      if (body.candidateConfirmed && !before.candidateConfirmed) parts.push('candidate confirmed');
      if (body.panelConfirmed && !before.panelConfirmed) parts.push('panel confirmed');
      if (body.feedback && body.feedback !== before.feedback) parts.push(`feedback: ${body.feedback.slice(0, 100)}`);
      if (parts.length) {
        await logActivity(tx, {
          actorId: u.id,
          verb: 'interview.updated',
          summary: `Round ${row.roundNo} for ${ctx.candidateName}: ${parts.join(', ')}`,
          payload: { status: values.status },
          candidateId: a.candidateId,
          requirementId: a.requirementId,
          clientId: ctx.clientId,
          applicationId: a.id,
        });
      }
      // A completed round means the team now waits for the client's decision (doc step 10).
      if (values.status === 'completed' && a.status === 'interviewing') {
        await applyMove(tx, u, a, a.version, { stage: 'interview', status: 'decision_pending' });
      }
      return row;
    });
    app.automation.kick();
    return row;
  });

  /** Profile summary for the client email (doc step 5), as JSON for copying or as XLSX. */
  app.get<{ Params: { id: string }; Querystring: { ids?: string; format?: string } }>(
    '/api/requirements/:id/summary',
    async (req, reply) => {
      me(req);
      const reqId = Number(req.params.id);
      const ids = (req.query.ids ?? '').split(',').map(Number).filter(Boolean);
      if (!ids.length) throw badRequest('Pick candidates');
      const rows = await app.db
        .select({ a: applications, c: candidates })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .where(and(eq(applications.requirementId, reqId), inArray(applications.id, ids)));
      const data = rows.map(({ a, c }) => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
        totalExp: c.totalExp,
        currentCompany: c.currentCompany,
        currentTitle: c.currentTitle,
        currentCtc: a.screening?.currentCtc ?? c.currentCtc,
        expectedCtc: a.screening?.expectedCtc ?? c.expectedCtc,
        noticeDays: a.screening?.noticeDays ?? c.noticeDays,
        location: a.screening?.currentLocation || c.location,
        remarks: a.screening?.remarks ?? '',
      }));
      if (req.query.format !== 'xlsx') return data;
      const buf = await toXlsx('Profiles', [
        { header: 'Name', value: (r) => r.name, width: 24 },
        { header: 'Phone', value: (r) => r.phone, width: 16 },
        { header: 'Email', value: (r) => r.email, width: 28 },
        { header: 'Experience (yrs)', value: (r) => r.totalExp },
        { header: 'Current company', value: (r) => r.currentCompany, width: 22 },
        { header: 'Designation', value: (r) => r.currentTitle, width: 20 },
        { header: 'Current CTC (LPA)', value: (r) => (r.currentCtc != null ? r.currentCtc / 1e5 : null) },
        { header: 'Expected CTC (LPA)', value: (r) => (r.expectedCtc != null ? r.expectedCtc / 1e5 : null) },
        { header: 'Notice (days)', value: (r) => r.noticeDays },
        { header: 'Location', value: (r) => r.location },
        { header: 'Remarks', value: (r) => r.remarks, width: 40 },
      ], data);
      return sendXlsx(reply, `profiles-req-${reqId}.xlsx`, buf);
    },
  );

  app.get<{ Querystring: { from: string; to: string; mine?: string } }>('/api/calendar', async (req) => {
    const u = me(req);
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('from/to required');
    const mine = req.query.mine === 'true';
    const ivs = await app.db
      .select({
        i: interviews,
        candidateName: candidates.name,
        candidateId: candidates.id,
        requirementId: requirements.id,
        requirementTitle: requirements.title,
        clientName: clients.name,
        coordinatorName: users.name,
      })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(requirements, eq(requirements.id, applications.requirementId))
      .innerJoin(clients, eq(clients.id, requirements.clientId))
      .leftJoin(users, eq(users.id, interviews.coordinatorId))
      .where(
        and(
          gte(interviews.scheduledAt, from),
          sql`${interviews.scheduledAt} < ${to.toISOString()}`,
          ne(interviews.status, 'cancelled'),
          mine ? eq(interviews.coordinatorId, u.id) : undefined,
        ),
      )
      .orderBy(asc(interviews.scheduledAt));
    const dojs = await app.db
      .select({
        applicationId: applications.id,
        status: applications.status,
        expectedDoj: offers.expectedDoj,
        candidateName: candidates.name,
        candidateId: candidates.id,
        requirementId: requirements.id,
        requirementTitle: requirements.title,
        clientName: clients.name,
        joiningRisk: applications.joiningRisk,
      })
      .from(offers)
      .innerJoin(applications, eq(applications.id, offers.applicationId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(requirements, eq(requirements.id, applications.requirementId))
      .innerJoin(clients, eq(clients.id, requirements.clientId))
      .where(
        and(
          isNotNull(offers.expectedDoj),
          gte(offers.expectedDoj, req.query.from.slice(0, 10)),
          sql`${offers.expectedDoj} < ${req.query.to.slice(0, 10)}`,
          inArray(applications.status, ['offer_accepted', 'awaiting_doj', 'joining_deferred', 'joined']),
        ),
      );
    return {
      interviews: ivs.map((r) => ({ ...r.i, candidateName: r.candidateName, candidateId: r.candidateId, requirementId: r.requirementId, requirementTitle: r.requirementTitle, clientName: r.clientName, coordinatorName: r.coordinatorName })),
      joinings: dojs,
    };
  });
}

async function assertNotOnRequirement(tx: Tx, candidateId: number, requirementId: number) {
  const [existing] = await tx
    .select({ id: applications.id, status: applications.status, createdAt: applications.createdAt, addedByName: users.name })
    .from(applications)
    .leftJoin(users, eq(users.id, applications.addedBy))
    .where(and(eq(applications.candidateId, candidateId), eq(applications.requirementId, requirementId)));
  if (existing) {
    throw conflict(
      `Already on this requirement — added by ${existing.addedByName ?? 'someone'} (${STATUS_LABELS[existing.status]})`,
      'DUPLICATE_APPLICATION',
      existing,
    );
  }
}

/**
 * Warns when the candidate was already submitted to the same client within the configured window
 * (any requirement). The recruiter can proceed after acknowledging.
 */
async function assertNoClientDuplicate(tx: Tx, candidateId: number, clientId: number, exceptAppId: number | null) {
  const s = await getSettings(tx);
  if (!s.clientDuplicateWindowDays) return;
  const since = new Date(Date.now() - s.clientDuplicateWindowDays * 86_400_000);
  const prior = await tx
    .select({
      id: applications.id,
      status: applications.status,
      submittedAt: applications.submittedAt,
      requirementTitle: requirements.title,
      submittedByName: users.name,
    })
    .from(applications)
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .leftJoin(users, eq(users.id, applications.submittedBy))
    .where(
      and(
        eq(applications.candidateId, candidateId),
        eq(requirements.clientId, clientId),
        gte(applications.submittedAt, since),
        exceptAppId ? ne(applications.id, exceptAppId) : undefined,
      ),
    );
  if (prior.length) {
    const p = prior[0];
    throw conflict(
      `Already submitted to this client for ${p.requirementTitle} on ${p.submittedAt!.toLocaleDateString('en-IN')} by ${p.submittedByName ?? 'someone'} — outcome: ${STATUS_LABELS[p.status]}`,
      'CLIENT_DUPLICATE',
      prior,
    );
  }
}

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

