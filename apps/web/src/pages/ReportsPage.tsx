import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { isManager, REQUIREMENT_STATUS_LABELS, STAGE_LABELS, STAGES, STATUS_LABELS, type AppStatus, type RequirementStatus } from '@crm/shared';
import { api, download, qs } from '../lib/api';
import { useMe } from '../lib/auth';
import { useUsers } from '../lib/queries';
import { ago, dateInput } from '../lib/format';
import { Button, Card, Empty, Field, Input, Loading, PageHeader, Pill, Select, Table, Tabs, Td, Th } from '../components/ui';
import { useToast } from '../components/toast';
import { requirementTone } from './RequirementsPage';

type Tab = 'productivity' | 'requirements' | 'clients' | 'dropoffs';

export function ReportsPage() {
  const me = useMe();
  const toast = useToast();
  const { data: users } = useUsers();
  const [tab, setTab] = useState<Tab>('productivity');
  const now = new Date();
  const [from, setFrom] = useState(dateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(dateInput(now));
  const [recruiterId, setRecruiterId] = useState('');
  const [reqStatus, setReqStatus] = useState('open,on_hold');
  const params = qs({ from, to, recruiterId, status: tab === 'requirements' ? reqStatus : undefined });
  const preset = (days: number | 'month' | 'lastMonth') => {
    const t = new Date();
    if (days === 'month') {
      setFrom(dateInput(new Date(t.getFullYear(), t.getMonth(), 1)));
      setTo(dateInput(t));
    } else if (days === 'lastMonth') {
      setFrom(dateInput(new Date(t.getFullYear(), t.getMonth() - 1, 1)));
      setTo(dateInput(new Date(t.getFullYear(), t.getMonth(), 0)));
    } else {
      setFrom(dateInput(new Date(t.getTime() - (days - 1) * 86_400_000)));
      setTo(dateInput(t));
    }
  };
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Replaces the daily Excel tracker"
        actions={
          <Button icon={<Download className="size-14" strokeWidth={1.8} />} onClick={() => void download(`/reports/${tab}${qs({ from, to, recruiterId, status: tab === 'requirements' ? reqStatus : undefined, format: 'xlsx' })}`, `${tab}.xlsx`).catch((e) => toast(e.message, 'error'))}>
            Export Excel
          </Button>
        }
      />
      <div className="mb-12">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'productivity', label: 'Recruiter productivity' },
            { value: 'requirements', label: 'Requirement status' },
            { value: 'clients', label: 'Client report' },
            { value: 'dropoffs', label: 'Drop-off reasons' },
          ]}
        />
      </div>
      <div className="mb-14 flex flex-wrap items-end gap-8">
        {tab !== 'requirements' ? (
          <>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <div className="flex gap-4 pb-[2px]">
              <Button size="sm" variant="quiet" onClick={() => preset(1)}>Today</Button>
              <Button size="sm" variant="quiet" onClick={() => preset(7)}>7 days</Button>
              <Button size="sm" variant="quiet" onClick={() => preset('month')}>This month</Button>
              <Button size="sm" variant="quiet" onClick={() => preset('lastMonth')}>Last month</Button>
            </div>
            {isManager(me.role) && tab !== 'clients' && (
              <Field label="Recruiter">
                <Select className="w-[200px]" value={recruiterId} onChange={(e) => setRecruiterId(e.target.value)}>
                  <option value="">Everyone</option>
                  {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </Field>
            )}
          </>
        ) : (
          <Field label="Requirements">
            <Select className="w-[220px]" value={reqStatus} onChange={(e) => setReqStatus(e.target.value)}>
              <option value="open,on_hold">Open & on hold</option>
              <option value="draft,open,on_hold">Active incl. drafts</option>
              <option value="filled,closed">Filled & closed</option>
              <option value="draft,open,on_hold,filled,closed,cancelled">All</option>
            </Select>
          </Field>
        )}
      </div>
      {tab === 'productivity' && <Productivity params={params} />}
      {tab === 'requirements' && <RequirementStatusReport params={params} />}
      {tab === 'clients' && <ClientReport params={params} />}
      {tab === 'dropoffs' && <Dropoffs params={params} />}
    </>
  );
}

function useReport<T>(name: string, params: string) {
  return useQuery({ queryKey: ['report', name, params], queryFn: () => api.get<T[]>(`/reports/${name}${params}`) });
}

const Bar = ({ value, max }: { value: number; max: number }) => (
  <span className="ml-8 inline-block h-[6px] w-[60px] overflow-hidden rounded-full bg-paper-2 align-middle">
    <span className="block h-full rounded-full bg-chart-1" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
  </span>
);

function Productivity({ params }: { params: string }) {
  const { data, isLoading } = useReport<{ id: number; name: string; candidatesAdded: number; screened: number; submitted: number; shortlisted: number; interviews: number; selected: number; joined: number }>('productivity', params);
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty title="No activity in this period" />;
  const cols = ['candidatesAdded', 'screened', 'submitted', 'shortlisted', 'interviews', 'selected', 'joined'] as const;
  const labels = { candidatesAdded: 'Candidates added', screened: 'Screened', submitted: 'Submitted', shortlisted: 'Client shortlisted', interviews: 'Interviews scheduled', selected: 'Selected', joined: 'Joined' };
  const max = Object.fromEntries(cols.map((c) => [c, Math.max(...data.map((d) => d[c]))]));
  const total = Object.fromEntries(cols.map((c) => [c, data.reduce((n, d) => n + d[c], 0)]));
  return (
    <Table>
      <thead>
        <tr>
          <Th>Recruiter</Th>
          {cols.map((c) => <Th key={c} className="text-right">{labels[c]}</Th>)}
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id}>
            <Td className="font-medium">{r.name}</Td>
            {cols.map((c) => (
              <Td key={c} className="tnum whitespace-nowrap text-right">
                {r[c]}
                <Bar value={r[c]} max={max[c]} />
              </Td>
            ))}
          </tr>
        ))}
        <tr className="bg-detail font-semibold">
          <Td>Total</Td>
          {cols.map((c) => <Td key={c} className="tnum text-right">{total[c]}<span className="ml-8 inline-block w-[60px]" /></Td>)}
        </tr>
      </tbody>
    </Table>
  );
}

function RequirementStatusReport({ params }: { params: string }) {
  const { data, isLoading } = useReport<{
    id: number; code: string; title: string; clientName: string; ownerName: string; status: RequirementStatus; openings: number; filled: number;
    mapped: number; submitted: number; interviewed: number; selected: number; ageDays: number; lastActivityAt: string | null; stages: Record<string, number>;
  }>('requirements', params);
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty title="No requirements" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Requirement</Th>
          <Th>Owner</Th>
          <Th>Status</Th>
          <Th className="text-right">Filled</Th>
          {STAGES.map((s) => <Th key={s} className="text-right">{STAGE_LABELS[s]}</Th>)}
          <Th className="text-right">Submitted</Th>
          <Th className="text-right">Interviewed</Th>
          <Th className="text-right">Selected</Th>
          <Th className="text-right">Age</Th>
          <Th>Last activity</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link to={`/requirements/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
              <span className="block text-9 text-ink-3">{r.code} · {r.clientName}</span>
            </Td>
            <Td className="text-10">{r.ownerName}</Td>
            <Td><Pill tone={requirementTone(r.status)}>{REQUIREMENT_STATUS_LABELS[r.status]}</Pill></Td>
            <Td className="tnum text-right">{r.filled}/{r.openings}</Td>
            {STAGES.map((s) => <Td key={s} className="tnum text-right text-ink-2">{r.stages[s] ?? 0}</Td>)}
            <Td className="tnum text-right">{r.submitted}</Td>
            <Td className="tnum text-right">{r.interviewed}</Td>
            <Td className="tnum text-right">{r.selected}</Td>
            <Td className="tnum text-right">{r.ageDays}d</Td>
            <Td className="text-10 text-ink-3">{ago(r.lastActivityAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ClientReport({ params }: { params: string }) {
  const { data, isLoading } = useReport<{
    id: number; name: string; requirementsOpened: number; submitted: number; shortlisted: number; rejected: number; interviewed: number; selected: number; joined: number;
    avgFeedbackDays: number | null; shortlistPct: number | null; interviewToSelectPct: number | null;
  }>('clients', params);
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty title="No client activity in this period" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Client</Th>
          <Th className="text-right">Requirements opened</Th>
          <Th className="text-right">Profiles submitted</Th>
          <Th className="text-right">Shortlisted</Th>
          <Th className="text-right">Shortlist %</Th>
          <Th className="text-right">Rejected</Th>
          <Th className="text-right">Interviewed</Th>
          <Th className="text-right">Selected</Th>
          <Th className="text-right">Interview → select</Th>
          <Th className="text-right">Joined</Th>
          <Th className="text-right">Avg feedback time</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id}>
            <Td><Link to={`/clients/${r.id}`} className="font-medium hover:underline">{r.name}</Link></Td>
            <Td className="tnum text-right">{r.requirementsOpened}</Td>
            <Td className="tnum text-right">{r.submitted}</Td>
            <Td className="tnum text-right">{r.shortlisted}</Td>
            <Td className="tnum text-right">{r.shortlistPct != null ? `${r.shortlistPct}%` : '—'}</Td>
            <Td className="tnum text-right">{r.rejected}</Td>
            <Td className="tnum text-right">{r.interviewed}</Td>
            <Td className="tnum text-right">{r.selected}</Td>
            <Td className="tnum text-right">{r.interviewToSelectPct != null ? `${r.interviewToSelectPct}%` : '—'}</Td>
            <Td className="tnum text-right font-medium">{r.joined}</Td>
            <Td className="tnum text-right">{r.avgFeedbackDays != null ? `${r.avgFeedbackDays} days` : '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Dropoffs({ params }: { params: string }) {
  const { data, isLoading } = useReport<{ stage: string; status: AppStatus; reason: string | null; n: number }>('dropoffs', params);
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty title="No candidates dropped out in this period" />;
  const total = data.reduce((n, d) => n + d.n, 0);
  const byOutcome = Object.entries(
    data.reduce<Record<string, number>>((acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + d.n), acc), {}),
  ).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...data.map((d) => d.n));
  return (
    <div className="grid gap-12 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="By outcome">
        <ul className="space-y-8">
          {byOutcome.map(([status, n]) => (
            <li key={status} className="text-10">
              <div className="flex justify-between"><span>{STATUS_LABELS[status as AppStatus]}</span><span className="tnum font-medium">{n} <span className="font-normal text-ink-3">({Math.round((n / total) * 100)}%)</span></span></div>
              <div className="mt-4 h-[6px] rounded-full bg-paper-2"><div className="h-full rounded-full bg-chart-2" style={{ width: `${(n / total) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      </Card>
      <Table>
        <thead>
          <tr>
            <Th>Stage</Th>
            <Th>Outcome</Th>
            <Th>Reason</Th>
            <Th className="text-right">Candidates</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <Td className="text-ink-2">{STAGE_LABELS[d.stage as keyof typeof STAGE_LABELS] ?? d.stage}</Td>
              <Td>{STATUS_LABELS[d.status]}</Td>
              <Td>{d.reason ?? <span className="text-ink-3">—</span>}</Td>
              <Td className="tnum whitespace-nowrap text-right">{d.n}<Bar value={d.n} max={max} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
