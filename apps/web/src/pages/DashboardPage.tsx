import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  MessageCircle,
  Phone,
} from 'lucide-react';
import { isManager, JOINING_RISK_LABELS, type JoiningRisk } from '@crm/shared';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { ago, daysSince, fmtDateTime, fmtShort } from '../lib/format';
import type { Task } from '../lib/types';
import { Avatar, Card, Empty, Kpi, Loading, Pill, Tabs } from '../components/ui';
import { useAppDrawer } from '../features/ApplicationDrawer';
import { TaskRow } from './TasksPage';

interface Dashboard {
  scope: 'mine' | 'team';
  kpi: {
    open_positions: number;
    open_requirements: number;
    submissions_week: number;
    submissions_last_week: number;
    interviews_today: number;
    interviews_overdue: number;
    joinings_due: number;
    joining_risks: number;
  };
  spark: { d: string; n: number }[];
  awaitingFeedback: {
    id: number;
    submittedAt: string;
    candidateName: string;
    requirementTitle: string;
    clientName: string;
  }[];
  upcomingInterviews: {
    id: number;
    applicationId: number;
    roundNo: number;
    label: string | null;
    scheduledAt: string;
    candidateName: string;
    requirementTitle: string;
    clientName: string;
    candidateConfirmed: boolean;
    panelConfirmed: boolean;
  }[];
  joinings: {
    id: number;
    status: string;
    joiningRisk: JoiningRisk | null;
    joiningRiskNote: string | null;
    expectedDoj: string | null;
    candidateName: string;
    requirementTitle: string;
    clientName: string;
  }[];
  readyToClose: { id: number; title: string; openings: number; clientName: string }[];
  team: { id: number; name: string; submissions: number; interviews: number; joinings: number }[];
  recent: { id: number; summary: string; createdAt: string; actorName: string | null }[];
}

export function DashboardPage() {
  const me = useMe();
  const [scope, setScope] = useState<'mine' | 'team'>(isManager(me.role) ? 'team' : 'mine');
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', scope],
    queryFn: () => api.get<Dashboard>(`/dashboard?scope=${scope}`),
  });
  const { data: tasks } = useQuery({
    queryKey: ['tasks', 'dashboard'],
    queryFn: () => api.get<Task[]>('/tasks?scope=mine&status=open'),
  });
  const drawer = useAppDrawer();
  const qc = useQueryClient();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dueTasks = (tasks ?? []).filter((t) => new Date(t.dueAt) < endOfToday());
  const overdueTasks = dueTasks.filter((t) => new Date(t.dueAt) < new Date()).length;

  return (
    <>
      <div className="mb-16 flex flex-wrap items-end justify-between gap-12">
        <div>
          <p className="text-10 text-ink-3">{today}</p>
          <h1 className="mock-display text-18">
            {greeting}, {me.name.split(' ')[0]}
          </h1>
        </div>
        <Tabs
          value={scope}
          onChange={setScope}
          items={[
            { value: 'mine', label: 'My requirements' },
            { value: 'team', label: 'Whole team' },
          ]}
        />
      </div>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-10 xl:grid-cols-4">
            <Kpi
              tint="cobalt"
              label="Open positions"
              value={data.kpi.open_positions}
              note={`${data.kpi.open_requirements} open requirement${data.kpi.open_requirements === 1 ? '' : 's'}`}
            />
            <Kpi
              tint="mint"
              label="Profiles submitted this week"
              value={data.kpi.submissions_week}
              spark={data.spark.map((s) => s.n)}
              note={`${data.kpi.submissions_last_week} last week`}
            />
            <Kpi
              tint="marigold"
              label="Interviews today"
              value={data.kpi.interviews_today}
              note={
                data.kpi.interviews_overdue
                  ? `${data.kpi.interviews_overdue} outcome${data.kpi.interviews_overdue > 1 ? 's' : ''} overdue`
                  : 'No outcomes overdue'
              }
              noteTone={data.kpi.interviews_overdue ? 'red' : undefined}
            />
            <Kpi
              tint="coral"
              label="Joinings in the next 7 days"
              value={data.kpi.joinings_due}
              note={
                data.kpi.joining_risks ? `${data.kpi.joining_risks} at risk` : 'No joining risks'
              }
              noteTone={data.kpi.joining_risks ? 'red' : undefined}
            />
          </div>

          {data.readyToClose.length > 0 && (
            <div className="mt-12 space-y-6">
              {data.readyToClose.map((r) => (
                <Link
                  key={r.id}
                  to={`/requirements/${r.id}`}
                  className="flex items-center gap-8 rounded-lg bg-mint-soft px-14 py-10 text-11 text-forest hover:bg-sage-2"
                >
                  <CheckCircle2 className="size-16" strokeWidth={1.8} />
                  All {r.openings} position{r.openings > 1 ? 's' : ''} filled for <b>{r.title}</b> (
                  {r.clientName}). Confirm closure with the client and mark it Filled.
                </Link>
              ))}
            </div>
          )}

          <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Card
              title="Due today"
              action={
                <Link to="/tasks" className="text-10 text-forest-2 hover:underline">
                  {overdueTasks ? (
                    <span className="font-medium text-signal-red">{overdueTasks} overdue · </span>
                  ) : null}
                  All tasks
                </Link>
              }
            >
              {dueTasks.length === 0 ? (
                <Empty
                  icon={<CheckCircle2 className="size-18" strokeWidth={1.8} />}
                  title="Nothing due today"
                >
                  Follow-ups created by the CRM will appear here.
                </Empty>
              ) : (
                <ul className="space-y-6">
                  {dueTasks.slice(0, 8).map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      compact
                      onChange={() => void qc.invalidateQueries({ queryKey: ['tasks'] })}
                    />
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Awaiting client feedback">
              {data.awaitingFeedback.length === 0 ? (
                <p className="text-10 text-ink-3">No submissions waiting on the client.</p>
              ) : (
                <ul className="space-y-8">
                  {data.awaitingFeedback.map((a) => {
                    const age = daysSince(a.submittedAt);
                    return (
                      <li key={a.id}>
                        <button
                          onClick={() => drawer.open(a.id)}
                          className="flex w-full items-center gap-8 text-left"
                        >
                          <span className="grid size-24 shrink-0 place-items-center rounded-md bg-marigold-soft text-[#7a5200]">
                            <Clock className="size-12" strokeWidth={1.8} />
                          </span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate text-10 font-medium">
                              {a.candidateName}
                            </span>
                            <span className="block truncate text-9 text-ink-3">
                              {a.requirementTitle} · {a.clientName}
                            </span>
                          </span>
                          <span
                            className={clsx(
                              'text-9 tnum',
                              age >= 3 ? 'font-medium text-signal-red' : 'text-ink-3',
                            )}
                          >
                            {age}d
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card
              title="Upcoming interviews"
              action={
                <Link to="/calendar" className="text-10 text-forest-2 hover:underline">
                  Calendar
                </Link>
              }
            >
              {data.upcomingInterviews.length === 0 ? (
                <p className="text-10 text-ink-3">No interviews lined up.</p>
              ) : (
                <ul className="space-y-8">
                  {data.upcomingInterviews.map((i) => (
                    <li key={i.id}>
                      <button
                        onClick={() => drawer.open(i.applicationId)}
                        className="flex w-full items-center gap-8 text-left"
                      >
                        <span className="grid size-24 shrink-0 place-items-center rounded-md bg-cobalt-soft text-cobalt">
                          <CalendarClock className="size-12" strokeWidth={1.8} />
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-10 font-medium">
                            {i.candidateName} · R{i.roundNo}
                            {i.label ? ` ${i.label}` : ''}
                          </span>
                          <span className="block truncate text-9 text-ink-3">
                            {fmtDateTime(i.scheduledAt)} · {i.clientName}
                          </span>
                        </span>
                        {(!i.candidateConfirmed || !i.panelConfirmed) && (
                          <Pill tone="warn">Confirm</Pill>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Card title="Selected candidates — notice period">
              {data.joinings.length === 0 ? (
                <p className="text-10 text-ink-3">No candidates serving notice.</p>
              ) : (
                <ul className="space-y-8">
                  {data.joinings.map((j) => (
                    <li key={j.id}>
                      <button
                        onClick={() => drawer.open(j.id)}
                        className="flex w-full items-center gap-8 text-left"
                      >
                        <span
                          className={clsx(
                            'grid size-24 shrink-0 place-items-center rounded-md',
                            j.joiningRisk
                              ? 'bg-coral-soft text-coral-2'
                              : 'bg-mint-soft text-forest',
                          )}
                        >
                          {j.joiningRisk ? (
                            <AlertTriangle className="size-12" strokeWidth={1.8} />
                          ) : (
                            <Phone className="size-12" strokeWidth={1.8} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-10 font-medium">
                            {j.candidateName}
                          </span>
                          <span className="block truncate text-9 text-ink-3">
                            {j.requirementTitle} · {j.clientName}
                          </span>
                        </span>
                        <span className="text-right leading-tight">
                          <span className="block text-9 tnum">Joins {fmtShort(j.expectedDoj)}</span>
                          {j.joiningRisk && (
                            <span className="block text-9 font-medium text-signal-red">
                              {JOINING_RISK_LABELS[j.joiningRisk]}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {data.team.length > 0 ? (
              <Card title="Team this month">
                <table className="w-full text-10">
                  <thead>
                    <tr className="text-9 text-ink-3">
                      <th className="pb-6 text-left font-normal">Recruiter</th>
                      <th className="pb-6 text-right font-normal">Submitted</th>
                      <th className="pb-6 text-right font-normal">Interviews</th>
                      <th className="pb-6 text-right font-normal">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.team.map((t) => (
                      <tr key={t.id}>
                        <td className="py-4">
                          <span className="flex items-center gap-6">
                            <Avatar name={t.name} size={22} />
                            {t.name}
                          </span>
                        </td>
                        <td className="tnum text-right">{t.submissions}</td>
                        <td className="tnum text-right">{t.interviews}</td>
                        <td className="tnum text-right font-medium">{t.joinings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <div />
            )}
            <Card title="Recent activity">
              <ul className="space-y-8">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex gap-8">
                    <MessageCircle
                      className="mt-[2px] size-12 shrink-0 text-ink-3"
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-10">{r.summary}</span>
                      <span className="block text-9 text-ink-3">
                        {r.actorName ?? 'System'} · {ago(r.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
