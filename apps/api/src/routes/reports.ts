import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  isManager,
  isoDate,
  REQUIREMENT_STATUS_LABELS,
  STAGES,
  STATUS_LABELS,
  type AppStatus,
  type RequirementStatus,
} from '@crm/shared';
import { me } from '../app';
import { badRequest } from '../lib/errors';
import { sendXlsx, toXlsx, type Column } from '../lib/xlsx';

interface RangeQuery {
  from?: string;
  to?: string;
  recruiterId?: string;
  clientId?: string;
  format?: string;
  scope?: 'mine' | 'team';
}

function range(q: RangeQuery) {
  const to = q.to ? new Date(`${q.to}T23:59:59.999`) : new Date();
  const from = q.from
    ? new Date(`${q.from}T00:00:00`)
    : new Date(to.getFullYear(), to.getMonth(), 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw badRequest('Invalid date range');
  return { from, to };
}

const rows = <T>(r: unknown) => r as T[];
/** Raw SQL templates bind Dates as ISO strings (drizzle + postgres-js can't serialise Date there). */
const iso = (d: Date) => d.toISOString();

async function maybeXlsx<T>(
  reply: FastifyReply,
  q: RangeQuery,
  name: string,
  columns: Column<T>[],
  data: T[],
) {
  if (q.format !== 'xlsx') return data;
  return sendXlsx(reply, `${name}.xlsx`, await toXlsx(name, columns, data));
}

export async function reportRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get<{ Querystring: RangeQuery }>('/api/dashboard', async (req) => {
    const u = me(req);
    const scope = req.query.scope ?? (isManager(u.role) ? 'team' : 'mine');
    const mine = scope === 'mine';
    // "Mine" = requirements I own or am assigned to.
    const myReq = (alias: string) =>
      mine
        ? sql.raw(
            `and (${alias}.owner_id = ${u.id} or exists (select 1 from requirement_assignees ra where ra.requirement_id = ${alias}.id and ra.user_id = ${u.id}))`,
          )
        : sql``;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [kpi] = rows<Record<string, number>>(
      await db.execute(sql`
        select
          (select coalesce(sum(greatest(r.openings - (select count(*) from applications a where a.requirement_id = r.id and a.status = 'joined'), 0)), 0)::int
             from requirements r where r.status = 'open' ${myReq('r')}) as open_positions,
          (select count(*)::int from requirements r where r.status = 'open' ${myReq('r')}) as open_requirements,
          (select count(*)::int from applications a join requirements r on r.id = a.requirement_id
             where a.submitted_at >= ${iso(weekStart)} ${myReq('r')}) as submissions_week,
          (select count(*)::int from applications a join requirements r on r.id = a.requirement_id
             where a.submitted_at >= ${iso(lastWeekStart)} and a.submitted_at < ${iso(weekStart)} ${myReq('r')}) as submissions_last_week,
          (select count(*)::int from interviews i join applications a on a.id = i.application_id join requirements r on r.id = a.requirement_id
             where i.scheduled_at >= ${iso(dayStart)} and i.scheduled_at < ${iso(dayEnd)} and i.status <> 'cancelled' ${myReq('r')}) as interviews_today,
          (select count(*)::int from interviews i join applications a on a.id = i.application_id join requirements r on r.id = a.requirement_id
             where i.status in ('scheduled','rescheduled','pending') and i.scheduled_at < now() - interval '2 hours' and a.closed_at is null ${myReq('r')}) as interviews_overdue,
          (select count(*)::int from offers o join applications a on a.id = o.application_id join requirements r on r.id = a.requirement_id
             where a.status in ('offer_accepted','awaiting_doj','joining_deferred') and o.expected_doj <= (current_date + 7) ${myReq('r')}) as joinings_due,
          (select count(*)::int from applications a join requirements r on r.id = a.requirement_id
             where a.joining_risk is not null and a.closed_at is null ${myReq('r')}) as joining_risks
      `),
    );

    const spark = rows<{ d: string; n: number }>(
      await db.execute(sql`
        select to_char(d, 'YYYY-MM-DD') as d,
          (select count(*)::int from applications a join requirements r on r.id = a.requirement_id
             where a.submitted_at >= d and a.submitted_at < d + interval '1 day' ${myReq('r')}) as n
        from generate_series(${iso(dayStart)}::timestamptz - interval '13 days', ${iso(dayStart)}::timestamptz, interval '1 day') d
        order by d
      `),
    );

    const awaitingFeedback = rows(
      await db.execute(sql`
        select a.id, a.requirement_id as "requirementId", a.submitted_at as "submittedAt", c.name as "candidateName",
               r.title as "requirementTitle", cl.name as "clientName"
        from applications a join candidates c on c.id = a.candidate_id join requirements r on r.id = a.requirement_id
        join clients cl on cl.id = r.client_id
        where a.status = 'feedback_pending' and a.closed_at is null ${myReq('r')}
        order by a.submitted_at asc limit 8
      `),
    );

    const upcomingInterviews = rows(
      await db.execute(sql`
        select i.id, i.round_no as "roundNo", i.label, i.scheduled_at as "scheduledAt", i.status, i.mode,
               i.candidate_confirmed as "candidateConfirmed", i.panel_confirmed as "panelConfirmed",
               a.id as "applicationId", a.requirement_id as "requirementId", c.name as "candidateName",
               r.title as "requirementTitle", cl.name as "clientName"
        from interviews i join applications a on a.id = i.application_id join candidates c on c.id = a.candidate_id
        join requirements r on r.id = a.requirement_id join clients cl on cl.id = r.client_id
        where i.status in ('scheduled','rescheduled','pending') and i.scheduled_at >= ${iso(dayStart)} ${myReq('r')}
        order by i.scheduled_at asc limit 8
      `),
    );

    const joinings = rows(
      await db.execute(sql`
        select a.id, a.requirement_id as "requirementId", a.status, a.joining_risk as "joiningRisk",
               a.joining_risk_note as "joiningRiskNote", o.expected_doj as "expectedDoj",
               c.name as "candidateName", r.title as "requirementTitle", cl.name as "clientName"
        from applications a join offers o on o.application_id = a.id join candidates c on c.id = a.candidate_id
        join requirements r on r.id = a.requirement_id join clients cl on cl.id = r.client_id
        where a.status in ('offer_accepted','awaiting_doj','joining_deferred') ${myReq('r')}
        order by (a.joining_risk is null), o.expected_doj asc nulls last limit 8
      `),
    );

    const readyToClose = rows(
      await db.execute(sql`
        select r.id, r.title, r.openings, cl.name as "clientName"
        from requirements r join clients cl on cl.id = r.client_id
        where r.status = 'open' ${myReq('r')}
          and (select count(*) from applications a where a.requirement_id = r.id and a.status = 'joined') >= r.openings
      `),
    );

    const team = isManager(u.role)
      ? rows(
          await db.execute(sql`
            select u.id, u.name,
              (select count(*)::int from applications a where a.submitted_by = u.id and a.submitted_at >= ${iso(monthStart)}) as submissions,
              (select count(*)::int from activities x where x.actor_id = u.id and x.verb = 'interview.scheduled' and x.created_at >= ${iso(monthStart)}) as interviews,
              (select count(*)::int from placements p join applications a on a.id = p.application_id
                 where coalesce(a.submitted_by, a.added_by) = u.id and p.joined_on >= ${isoDate(monthStart)}) as joinings
            from users u where u.active order by submissions desc, u.name
          `),
        )
      : [];

    const recent = rows(
      await db.execute(sql`
        select x.id, x.summary, x.verb, x.created_at as "createdAt", u.name as "actorName",
               x.candidate_id as "candidateId", x.requirement_id as "requirementId", x.application_id as "applicationId"
        from activities x left join users u on u.id = x.actor_id
        ${mine ? sql`where x.actor_id = ${u.id}` : sql``}
        order by x.id desc limit 10
      `),
    );

    return {
      scope,
      kpi,
      spark,
      awaitingFeedback,
      upcomingInterviews,
      joinings,
      readyToClose,
      team,
      recent,
    };
  });

  /** Recruiter productivity: replaces the daily Excel tracker. */
  app.get<{ Querystring: RangeQuery }>('/api/reports/productivity', async (req, reply) => {
    const u = me(req);
    const { from, to } = range(req.query);
    const only = !isManager(u.role)
      ? u.id
      : req.query.recruiterId
        ? Number(req.query.recruiterId)
        : null;
    const data = rows<{
      id: number;
      name: string;
      candidatesAdded: number;
      screened: number;
      submitted: number;
      shortlisted: number;
      interviews: number;
      selected: number;
      joined: number;
    }>(
      await db.execute(sql`
        select u.id, u.name,
          (select count(*)::int from candidates c where c.sourced_by = u.id and c.created_at between ${iso(from)} and ${iso(to)}) as "candidatesAdded",
          (select count(*)::int from activities x where x.actor_id = u.id and x.verb = 'app.screened' and x.created_at between ${iso(from)} and ${iso(to)}) as "screened",
          (select count(*)::int from applications a where a.submitted_by = u.id and a.submitted_at between ${iso(from)} and ${iso(to)}) as "submitted",
          (select count(*)::int from activities x join applications a on a.id = x.application_id
             where a.submitted_by = u.id and x.verb = 'app.status' and x.payload->>'toStatus' = 'client_shortlisted' and x.created_at between ${iso(from)} and ${iso(to)}) as "shortlisted",
          (select count(*)::int from activities x where x.actor_id = u.id and x.verb = 'interview.scheduled' and x.created_at between ${iso(from)} and ${iso(to)}) as "interviews",
          (select count(*)::int from activities x join applications a on a.id = x.application_id
             where coalesce(a.submitted_by, a.added_by) = u.id and x.verb = 'app.status' and x.payload->>'toStatus' = 'selected' and x.created_at between ${iso(from)} and ${iso(to)}) as "selected",
          (select count(*)::int from placements p join applications a on a.id = p.application_id
             where coalesce(a.submitted_by, a.added_by) = u.id and p.joined_on between ${isoDate(from)} and ${isoDate(to)}) as "joined"
        from users u
        where (u.active or exists (select 1 from applications a where a.submitted_by = u.id and a.submitted_at between ${iso(from)} and ${iso(to)}))
          ${only ? sql`and u.id = ${only}` : sql``}
        order by "submitted" desc, u.name
      `),
    );
    return maybeXlsx(
      reply,
      req.query,
      'Recruiter productivity',
      [
        { header: 'Recruiter', value: (r) => r.name, width: 22 },
        { header: 'Candidates added', value: (r) => r.candidatesAdded },
        { header: 'Screened', value: (r) => r.screened },
        { header: 'Submitted', value: (r) => r.submitted },
        { header: 'Client shortlisted', value: (r) => r.shortlisted },
        { header: 'Interviews scheduled', value: (r) => r.interviews },
        { header: 'Selected', value: (r) => r.selected },
        { header: 'Joined', value: (r) => r.joined },
      ],
      data,
    );
  });

  /** Requirement status: openings vs filled, funnel and age. */
  app.get<{ Querystring: RangeQuery & { status?: string } }>(
    '/api/reports/requirements',
    async (req, reply) => {
      me(req);
      const statuses = (req.query.status ?? 'open,on_hold').split(',') as RequirementStatus[];
      const data = rows<{
        id: number;
        code: string;
        title: string;
        clientName: string;
        ownerName: string;
        status: RequirementStatus;
        openings: number;
        filled: number;
        mapped: number;
        submitted: number;
        interviewed: number;
        selected: number;
        ageDays: number;
        lastActivityAt: string | null;
        stages: Record<string, number>;
      }>(
        await db.execute(sql`
        select r.id, r.code, r.title, cl.name as "clientName", u.name as "ownerName", r.status, r.openings,
          (select count(*)::int from applications a where a.requirement_id = r.id and a.status = 'joined') as filled,
          (select count(*)::int from applications a where a.requirement_id = r.id) as mapped,
          (select count(*)::int from applications a where a.requirement_id = r.id and a.submitted_at is not null) as submitted,
          (select count(distinct i.application_id)::int from interviews i join applications a on a.id = i.application_id where a.requirement_id = r.id) as interviewed,
          (select count(*)::int from applications a where a.requirement_id = r.id and (a.status in ('selected','joined','did_not_join') or a.stage in ('offer','joining'))) as selected,
          (current_date - coalesce(r.opened_at, r.created_at)::date)::int as "ageDays",
          (select max(created_at) from activities x where x.requirement_id = r.id) as "lastActivityAt",
          (select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) from
             (select a.stage, count(*)::int as n from applications a where a.requirement_id = r.id and a.closed_at is null group by a.stage) s) as stages
        from requirements r join clients cl on cl.id = r.client_id join users u on u.id = r.owner_id
        where r.status in ${statuses}
          ${req.query.clientId ? sql`and r.client_id = ${Number(req.query.clientId)}` : sql``}
        order by "ageDays" desc
      `),
      );
      return maybeXlsx(
        reply,
        req.query,
        'Requirement status',
        [
          { header: 'Code', value: (r) => r.code },
          { header: 'Position', value: (r) => r.title, width: 26 },
          { header: 'Client', value: (r) => r.clientName, width: 22 },
          { header: 'Owner', value: (r) => r.ownerName, width: 18 },
          { header: 'Status', value: (r) => REQUIREMENT_STATUS_LABELS[r.status] },
          { header: 'Openings', value: (r) => r.openings },
          { header: 'Filled', value: (r) => r.filled },
          ...STAGES.map((s) => ({
            header: `Active: ${s}`,
            value: (r: (typeof data)[number]) => r.stages[s] ?? 0,
          })),
          { header: 'Total mapped', value: (r) => r.mapped },
          { header: 'Submitted', value: (r) => r.submitted },
          { header: 'Interviewed', value: (r) => r.interviewed },
          { header: 'Selected', value: (r) => r.selected },
          { header: 'Age (days)', value: (r) => r.ageDays },
          {
            header: 'Last activity',
            value: (r) => (r.lastActivityAt ? new Date(r.lastActivityAt) : null),
          },
        ],
        data,
      );
    },
  );

  /** Client report: how each client responds to our submissions. */
  app.get<{ Querystring: RangeQuery }>('/api/reports/clients', async (req, reply) => {
    me(req);
    const { from, to } = range(req.query);
    const data = rows<{
      id: number;
      name: string;
      requirementsOpened: number;
      submitted: number;
      shortlisted: number;
      rejected: number;
      interviewed: number;
      selected: number;
      joined: number;
      avgFeedbackDays: number | null;
    }>(
      await db.execute(sql`
        with subs as (
          select a.*, r.client_id from applications a join requirements r on r.id = a.requirement_id
          where a.submitted_at between ${iso(from)} and ${iso(to)}
        )
        select cl.id, cl.name,
          (select count(*)::int from requirements r where r.client_id = cl.id and r.created_at between ${iso(from)} and ${iso(to)}) as "requirementsOpened",
          (select count(*)::int from subs s where s.client_id = cl.id) as submitted,
          (select count(*)::int from subs s where s.client_id = cl.id and exists (
             select 1 from activities x where x.application_id = s.id and x.verb = 'app.status' and x.payload->>'toStatus' = 'client_shortlisted')) as shortlisted,
          (select count(*)::int from subs s where s.client_id = cl.id and s.status = 'client_rejected') as rejected,
          (select count(*)::int from subs s where s.client_id = cl.id and exists (select 1 from interviews i where i.application_id = s.id)) as interviewed,
          (select count(*)::int from subs s where s.client_id = cl.id and exists (
             select 1 from activities x where x.application_id = s.id and x.verb = 'app.status' and x.payload->>'toStatus' = 'selected')) as selected,
          (select count(*)::int from placements p join applications a on a.id = p.application_id join requirements r on r.id = a.requirement_id
             where r.client_id = cl.id and p.joined_on between ${isoDate(from)} and ${isoDate(to)}) as joined,
          (select round(avg(extract(epoch from (s.feedback_at - s.submitted_at)) / 86400)::numeric, 1)::float
             from subs s where s.client_id = cl.id and s.feedback_at is not null) as "avgFeedbackDays"
        from clients cl
        ${req.query.clientId ? sql`where cl.id = ${Number(req.query.clientId)}` : sql``}
        order by submitted desc, cl.name
      `),
    );
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
    const withRatios = data
      .filter((r) => r.submitted || r.requirementsOpened || r.joined)
      .map((r) => ({
        ...r,
        shortlistPct: pct(r.shortlisted, r.submitted),
        interviewToSelectPct: pct(r.selected, r.interviewed),
      }));
    return maybeXlsx(
      reply,
      req.query,
      'Client report',
      [
        { header: 'Client', value: (r) => r.name, width: 24 },
        { header: 'Requirements opened', value: (r) => r.requirementsOpened },
        { header: 'Profiles submitted', value: (r) => r.submitted },
        { header: 'Shortlisted', value: (r) => r.shortlisted },
        { header: 'Shortlist %', value: (r) => r.shortlistPct },
        { header: 'Rejected', value: (r) => r.rejected },
        { header: 'Interviewed', value: (r) => r.interviewed },
        { header: 'Selected', value: (r) => r.selected },
        { header: 'Interview→select %', value: (r) => r.interviewToSelectPct },
        { header: 'Joined', value: (r) => r.joined },
        { header: 'Avg feedback (days)', value: (r) => r.avgFeedbackDays },
      ],
      withRatios,
    );
  });

  /** Drop-off reasons: where and why candidates fall out. */
  app.get<{ Querystring: RangeQuery }>('/api/reports/dropoffs', async (req, reply) => {
    me(req);
    const { from, to } = range(req.query);
    const data = rows<{ stage: string; status: AppStatus; reason: string | null; n: number }>(
      await db.execute(sql`
        select a.stage, a.status, l.label as reason, count(*)::int as n
        from applications a join requirements r on r.id = a.requirement_id
        left join lookups l on l.id = a.reason_id
        where a.closed_at between ${iso(from)} and ${iso(to)} and a.status <> 'joined'
          ${req.query.clientId ? sql`and r.client_id = ${Number(req.query.clientId)}` : sql``}
          ${req.query.recruiterId ? sql`and coalesce(a.submitted_by, a.added_by) = ${Number(req.query.recruiterId)}` : sql``}
        group by a.stage, a.status, l.label
        order by n desc
      `),
    );
    return maybeXlsx(
      reply,
      req.query,
      'Drop-off reasons',
      [
        { header: 'Stage', value: (r) => r.stage },
        { header: 'Outcome', value: (r) => STATUS_LABELS[r.status] },
        { header: 'Reason', value: (r) => r.reason ?? '—', width: 30 },
        { header: 'Candidates', value: (r) => r.n },
      ],
      data,
    );
  });
}
