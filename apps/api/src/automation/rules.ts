// Auto-task rules agreed in the process walkthrough. Each run is idempotent: tasks carry an
// `auto_key`, so a rule that already fired for a record/period never fires twice, and tasks whose
// condition has cleared (feedback came in, outcome logged, candidate joined) are closed.
import { and, eq, inArray, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import {
  addDays,
  addWorkingDays,
  daysBetween,
  INTERVIEW_AWAITING_OUTCOME,
  isoDate,
  type Settings,
  type TaskRule,
} from '@crm/shared';
import type { DB } from '../db';
import {
  applications,
  candidates,
  clients,
  interviews,
  offers,
  placements,
  requirements,
  tasks,
} from '../db/schema';
import { getSettings } from '../lib/settings';
import { outer } from '../lib/sql';

export interface RunResult {
  created: number;
  closed: number;
}

type NewTask = typeof tasks.$inferInsert;

export async function runRules(db: DB, now = new Date()): Promise<RunResult> {
  const s = await getSettings(db);
  const result: RunResult = { created: 0, closed: 0 };
  const create = async (t: NewTask) => {
    const rows = await db
      .insert(tasks)
      .values(t)
      .onConflictDoNothing({ target: tasks.autoKey })
      .returning({ id: tasks.id });
    result.created += rows.length;
  };

  await feedbackRules(db, s, now, create);
  await interviewOutcomeRule(db, s, now, create);
  await noticeRules(db, s, now, create);
  await guaranteeRule(db, s, now, create);
  result.closed = await closeClearedTasks(db, s, now);
  return result;
}

type Create = (t: NewTask) => Promise<void>;

/** Doc step 6: chase the client after N working days, escalate to the owner later. */
async function feedbackRules(db: DB, s: Settings, now: Date, create: Create) {
  if (!s.rules.chase_feedback && !s.rules.escalate_feedback) return;
  const rows = await db
    .select({
      id: applications.id,
      submittedAt: applications.submittedAt,
      submittedBy: applications.submittedBy,
      candidateId: applications.candidateId,
      requirementId: applications.requirementId,
      candidateName: candidates.name,
      requirementTitle: requirements.title,
      ownerId: requirements.ownerId,
      clientName: clients.name,
      chaseDays: clients.feedbackChaseDays,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .innerJoin(clients, eq(clients.id, requirements.clientId))
    .where(
      and(
        eq(applications.status, 'feedback_pending'),
        isNotNull(applications.submittedAt),
        isNull(applications.closedAt),
      ),
    );

  for (const r of rows) {
    const submitted = r.submittedAt!;
    const base = {
      candidateId: r.candidateId,
      requirementId: r.requirementId,
      applicationId: r.id,
    };
    const chaseDue = addWorkingDays(submitted, r.chaseDays, s.offDays);
    if (s.rules.chase_feedback && chaseDue <= now) {
      await create({
        ...base,
        rule: 'chase_feedback',
        autoKey: `chase_feedback:${r.id}:${submitted.getTime()}`,
        title: `Chase feedback: ${r.candidateName} — ${r.requirementTitle} (${r.clientName})`,
        assigneeId: r.submittedBy ?? r.ownerId,
        dueAt: chaseDue,
      });
    }
    const escalateDue = addWorkingDays(submitted, s.feedbackEscalationDays, s.offDays);
    if (s.rules.escalate_feedback && escalateDue <= now) {
      await create({
        ...base,
        rule: 'escalate_feedback',
        autoKey: `escalate_feedback:${r.id}:${submitted.getTime()}`,
        title: `No client feedback for ${s.feedbackEscalationDays} working days: ${r.candidateName} — ${r.requirementTitle} (${r.clientName})`,
        assigneeId: r.ownerId,
        dueAt: escalateDue,
      });
    }
  }
}

/** Doc step 9: outcome not logged a couple of hours after the slot. */
async function interviewOutcomeRule(db: DB, s: Settings, now: Date, create: Create) {
  if (!s.rules.interview_outcome) return;
  const cutoff = new Date(now.getTime() - s.interviewOutcomeGraceHours * 3_600_000);
  const rows = await db
    .select({
      i: interviews,
      candidateId: applications.candidateId,
      requirementId: applications.requirementId,
      addedBy: applications.addedBy,
      candidateName: candidates.name,
      requirementTitle: requirements.title,
      ownerId: requirements.ownerId,
    })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .where(
      and(
        inArray(interviews.status, INTERVIEW_AWAITING_OUTCOME),
        lte(interviews.scheduledAt, cutoff),
        isNull(applications.closedAt),
      ),
    );
  for (const r of rows) {
    await create({
      rule: 'interview_outcome',
      autoKey: interviewKey(r.i.id, r.i.scheduledAt),
      title: `Update outcome: round ${r.i.roundNo}${r.i.label ? ` (${r.i.label})` : ''} — ${r.candidateName}, ${r.requirementTitle}`,
      assigneeId: r.i.coordinatorId ?? r.ownerId,
      dueAt: new Date(r.i.scheduledAt.getTime() + s.interviewOutcomeGraceHours * 3_600_000),
      candidateId: r.candidateId,
      requirementId: r.requirementId,
      applicationId: r.i.applicationId,
      interviewId: r.i.id,
    });
  }
}
const interviewKey = (id: number, at: Date) => `interview_outcome:${id}:${at.getTime()}`;

const NOTICE_STATUSES = ['offer_accepted', 'awaiting_doj', 'joining_deferred'] as const;

/** Doc steps 11-12: weekly check-ins during the notice period, daily near the joining date. */
async function noticeRules(db: DB, s: Settings, now: Date, create: Create) {
  if (!s.rules.notice_checkin && !s.rules.confirm_joining) return;
  const today = isoDate(now);
  const rows = await db
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      requirementId: applications.requirementId,
      submittedBy: applications.submittedBy,
      addedBy: applications.addedBy,
      ownerId: requirements.ownerId,
      candidateName: candidates.name,
      requirementTitle: requirements.title,
      clientName: clients.name,
      expectedDoj: offers.expectedDoj,
    })
    .from(applications)
    .innerJoin(offers, eq(offers.applicationId, applications.id))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .innerJoin(clients, eq(clients.id, requirements.clientId))
    .where(
      and(
        inArray(applications.status, [...NOTICE_STATUSES]),
        isNull(applications.closedAt),
        isNotNull(offers.expectedDoj),
      ),
    );

  for (const r of rows) {
    const doj = r.expectedDoj!;
    const assigneeId = r.submittedBy ?? r.addedBy ?? r.ownerId;
    const base = {
      candidateId: r.candidateId,
      requirementId: r.requirementId,
      applicationId: r.id,
      assigneeId,
    };
    const daysLeft = daysBetween(now, new Date(`${doj}T00:00:00`));

    if (s.rules.confirm_joining && daysLeft <= 0) {
      await create({
        ...base,
        rule: 'confirm_joining',
        autoKey: `confirm_joining:${r.id}:${doj}`,
        title: `Confirm joining: ${r.candidateName} was due to join ${r.clientName} on ${doj}`,
        dueAt: at10(new Date(`${doj}T00:00:00`)),
      });
      continue;
    }
    if (!s.rules.notice_checkin) continue;
    const interval = daysLeft <= s.noticeDailyWindowDays ? 1 : s.noticeCheckinIntervalDays;
    const [last] = await db
      .select({ doneAt: tasks.doneAt, dueAt: tasks.dueAt })
      .from(tasks)
      .where(and(eq(tasks.applicationId, r.id), eq(tasks.rule, 'notice_checkin')))
      .orderBy(sql`${tasks.dueAt} desc`)
      .limit(1);
    if (last && !last.doneAt) continue; // one open check-in at a time
    const nextDue = last ? at10(addDays(last.doneAt!, interval)) : now;
    if (nextDue > now) continue;
    await create({
      ...base,
      rule: 'notice_checkin',
      autoKey: `notice_checkin:${r.id}:${today}`,
      title: `Check in with ${r.candidateName} — joins ${r.clientName} in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${doj})`,
      dueAt: nextDue,
    });
  }
}

/** Replacement guarantee about to end: confirm the candidate is still employed. */
async function guaranteeRule(db: DB, s: Settings, now: Date, create: Create) {
  if (!s.rules.guarantee_expiry) return;
  const horizon = isoDate(addDays(now, s.guaranteeReminderDays));
  const rows = await db
    .select({
      p: placements,
      candidateId: applications.candidateId,
      requirementId: applications.requirementId,
      ownerId: requirements.ownerId,
      candidateName: candidates.name,
      clientName: clients.name,
    })
    .from(placements)
    .innerJoin(applications, eq(applications.id, placements.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .innerJoin(clients, eq(clients.id, requirements.clientId))
    .where(
      and(
        isNull(placements.leftOn),
        lte(placements.guaranteeUntil, horizon),
        sql`${placements.guaranteeUntil} >= ${isoDate(now)}`,
      ),
    );
  for (const r of rows) {
    await create({
      rule: 'guarantee_expiry',
      autoKey: `guarantee_expiry:${r.p.id}`,
      title: `Replacement guarantee ends ${r.p.guaranteeUntil}: confirm ${r.candidateName} is still with ${r.clientName}`,
      assigneeId: r.ownerId,
      dueAt: at10(new Date(`${r.p.guaranteeUntil}T00:00:00`)),
      candidateId: r.candidateId,
      requirementId: r.requirementId,
      applicationId: r.p.applicationId,
      placementId: r.p.id,
    });
  }
}

/** Closes open auto-tasks whose triggering condition no longer holds. */
async function closeClearedTasks(db: DB, _s: Settings, now: Date): Promise<number> {
  const close = { doneAt: now, autoClosed: true };
  let n = 0;
  const run = async (rules: TaskRule[], cond: ReturnType<typeof sql>) => {
    const rows = await db
      .update(tasks)
      .set(close)
      .where(and(isNull(tasks.doneAt), inArray(tasks.rule, rules), cond))
      .returning({ id: tasks.id });
    n += rows.length;
  };
  await run(
    ['chase_feedback', 'escalate_feedback'],
    sql`not exists (select 1 from ${applications} a where a.id = ${outer('tasks', 'application_id')} and a.status = 'feedback_pending' and a.closed_at is null)`,
  );
  await run(
    ['interview_outcome'],
    sql`not exists (select 1 from ${interviews} i where i.id = ${outer('tasks', 'interview_id')} and i.status in ('scheduled','rescheduled','pending') and ${outer('tasks', 'auto_key')} = 'interview_outcome:' || i.id || ':' || (extract(epoch from i.scheduled_at) * 1000)::bigint)`,
  );
  await run(
    ['notice_checkin', 'confirm_joining'],
    sql`not exists (select 1 from ${applications} a where a.id = ${outer('tasks', 'application_id')} and a.status in ('offer_accepted','awaiting_doj','joining_deferred') and a.closed_at is null)`,
  );
  await run(
    ['guarantee_expiry'],
    sql`exists (select 1 from ${placements} p where p.id = ${outer('tasks', 'placement_id')} and p.left_on is not null)`,
  );
  return n;
}

function at10(d: Date) {
  const x = new Date(d.getTime());
  x.setHours(10, 0, 0, 0);
  return x;
}
