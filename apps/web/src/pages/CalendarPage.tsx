import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { INTERVIEW_AWAITING_OUTCOME, INTERVIEW_STATUS_LABELS, JOINING_RISK_LABELS, type InterviewStatus, type JoiningRisk } from '@crm/shared';
import { api } from '../lib/api';
import { dateInput, fmtTime } from '../lib/format';
import { Button, Loading, PageHeader, Tabs } from '../components/ui';
import { useAppDrawer } from '../features/ApplicationDrawer';

interface CalendarData {
  interviews: {
    id: number;
    applicationId: number;
    roundNo: number;
    label: string | null;
    scheduledAt: string;
    status: InterviewStatus;
    candidateName: string;
    requirementTitle: string;
    clientName: string;
    coordinatorName: string | null;
    candidateConfirmed: boolean;
    panelConfirmed: boolean;
  }[];
  joinings: { applicationId: number; expectedDoj: string; candidateName: string; requirementTitle: string; clientName: string; status: string; joiningRisk: JoiningRisk | null }[];
}

export function CalendarPage() {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [mine, setMine] = useState<'all' | 'mine'>('all');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const drawer = useAppDrawer();
  const days = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [anchor, view]);
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const { data, isLoading } = useQuery({
    queryKey: ['calendar', from.toISOString(), to.toISOString(), mine],
    queryFn: () => api.get<CalendarData>(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}&mine=${mine === 'mine'}`),
  });
  const shift = (n: number) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));
  const title =
    view === 'week'
      ? `${days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const todayKey = dateInput(new Date());

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Interviews logged by the team and expected joining dates"
        actions={
          <>
            <Tabs value={mine} onChange={setMine} items={[{ value: 'all', label: 'Team' }, { value: 'mine', label: 'I coordinate' }]} />
            <Tabs value={view} onChange={setView} items={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          </>
        }
      />
      <div className="mb-12 flex items-center gap-8">
        <Button variant="quiet" size="sm" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft className="size-16" /></Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>Today</Button>
        <Button variant="quiet" size="sm" onClick={() => shift(1)} aria-label="Next"><ChevronRight className="size-16" /></Button>
        <h2 className="title ml-8 text-14">{title}</h2>
        <span className="ml-auto flex items-center gap-12 text-9 text-ink-3">
          <span className="flex items-center gap-4"><span className="size-8 rounded-full bg-cobalt" />Interview</span>
          <span className="flex items-center gap-4"><span className="size-8 rounded-full bg-moss" />Joining</span>
          <span className="flex items-center gap-4"><span className="size-8 rounded-full bg-signal-red" />Needs attention</span>
        </span>
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b hairline bg-detail">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-10 py-6 text-9 font-semibold uppercase tracking-[0.06em] text-ink-3">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = dateInput(d);
              const ivs = data?.interviews.filter((i) => dateInput(i.scheduledAt) === key) ?? [];
              const joins = data?.joinings.filter((j) => j.expectedDoj === key) ?? [];
              const outside = view === 'month' && d.getMonth() !== anchor.getMonth();
              return (
                <div key={key} className={clsx('border-b border-r hairline p-6', view === 'week' ? 'min-h-[360px]' : 'min-h-[112px]', outside && 'bg-paper/50')}>
                  <p className={clsx('mb-4 inline-grid size-22 place-items-center rounded-full text-10 tnum', key === todayKey ? 'bg-forest font-semibold text-mint' : outside ? 'text-ink-3' : 'text-ink-2')}>
                    {d.getDate()}
                  </p>
                  <div className="space-y-4">
                    {ivs.map((i) => {
                      const attention = (INTERVIEW_AWAITING_OUTCOME.includes(i.status) && new Date(i.scheduledAt).getTime() + 2 * 3_600_000 < Date.now()) || (!i.candidateConfirmed && new Date(i.scheduledAt) > new Date());
                      return (
                        <button
                          key={`i${i.id}`}
                          onClick={() => drawer.open(i.applicationId)}
                          title={`${i.candidateName} · ${i.requirementTitle} (${i.clientName}) · ${INTERVIEW_STATUS_LABELS[i.status]}${i.coordinatorName ? ` · ${i.coordinatorName}` : ''}`}
                          className={clsx(
                            'block w-full rounded-sm border-l-2 px-6 py-[3px] text-left text-9 leading-tight hover:brightness-95',
                            attention ? 'border-signal-red bg-coral-soft' : i.status === 'completed' ? 'border-moss bg-mint-soft' : 'border-cobalt bg-cobalt-soft',
                          )}
                        >
                          <span className="block truncate font-medium">{fmtTime(i.scheduledAt)} {i.candidateName}</span>
                          {view === 'week' && <span className="block truncate text-ink-2">R{i.roundNo}{i.label ? ` ${i.label}` : ''} · {i.clientName}</span>}
                        </button>
                      );
                    })}
                    {joins.map((j) => (
                      <button
                        key={`j${j.applicationId}`}
                        onClick={() => drawer.open(j.applicationId)}
                        className={clsx('block w-full rounded-sm border-l-2 px-6 py-[3px] text-left text-9 leading-tight', j.joiningRisk ? 'border-signal-red bg-coral-soft' : 'border-moss bg-mint-soft')}
                      >
                        <span className="block truncate font-medium">Joins: {j.candidateName}</span>
                        {view === 'week' && <span className="block truncate text-ink-2">{j.clientName}{j.joiningRisk ? ` · ${JOINING_RISK_LABELS[j.joiningRisk]}` : ''}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
