import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, KanbanSquare } from 'lucide-react';
import { JOINING_RISK_LABELS, STAGE_LABELS, STAGES, type Stage } from '@crm/shared';
import { api, qs } from '../lib/api';
import { useUsers } from '../lib/queries';
import { ago, daysSince, fmtDateTime, fmtShort, formatLpa } from '../lib/format';
import type { ApplicationRow, Client } from '../lib/types';
import { Avatar, Checkbox, Empty, Input, Loading, PageHeader, Pill, Select, StatusPill, Table, Tabs, Td, Th } from '../components/ui';
import { useAppDrawer } from '../features/ApplicationDrawer';

/** Every candidate × requirement across the team, filterable by stage — replaces separate Submissions/Interviews/Offers/Joining pages. */
export function PipelinePage() {
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [active, setActive] = useState<'true' | 'false' | 'all'>('true');
  const [clientId, setClientId] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [risk, setRisk] = useState(false);
  const [q, setQ] = useState('');
  const drawer = useAppDrawer();
  const { data: users } = useUsers();
  const { data: clients } = useQuery({ queryKey: ['clients', '', 'all'], queryFn: () => api.get<Client[]>('/clients?active=all') });
  const { data, isLoading } = useQuery({
    queryKey: ['applications', 'pipeline', active, clientId, recruiterId, risk, q],
    queryFn: () => api.get<ApplicationRow[]>(`/applications${qs({ active, clientId, recruiterId, risk: risk || undefined, q })}`),
  });
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, (data ?? []).filter((a) => a.stage === s).length])), [data]);
  const rows = (data ?? []).filter((a) => stage === 'all' || a.stage === stage);

  return (
    <>
      <PageHeader title="Pipeline" subtitle="All candidates on all requirements. Click a row to work on it." />
      <div className="mb-10">
        <Tabs
          value={stage}
          onChange={setStage}
          items={[{ value: 'all' as const, label: 'All stages', count: data?.length }, ...STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s], count: counts[s] }))]}
        />
      </div>
      <div className="mb-12 flex flex-wrap items-center gap-8">
        <Input className="max-w-[240px]" placeholder="Candidate or company" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-[200px]" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="w-[200px]" value={recruiterId} onChange={(e) => setRecruiterId(e.target.value)}>
          <option value="">All recruiters</option>
          {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select className="w-[140px]" value={active} onChange={(e) => setActive(e.target.value as 'true' | 'false' | 'all')}>
          <option value="true">In progress</option>
          <option value="false">Closed</option>
          <option value="all">All</option>
        </Select>
        <Checkbox label="Joining risks only" checked={risk} onChange={setRisk} />
      </div>
      {isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon={<KanbanSquare className="size-18" />} title="Nothing here">Change the filters, or map candidates to a requirement.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Requirement</Th>
              <Th>Stage</Th>
              <Th>Status</Th>
              <Th className="text-right">CTC → expected</Th>
              <Th>Next</Th>
              <Th>Recruiter</Th>
              <Th>In stage</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const waiting = a.status === 'feedback_pending' && a.submittedAt ? daysSince(a.submittedAt) : null;
              return (
                <tr key={a.id} onClick={() => drawer.open(a.id)} className="cursor-pointer hover:bg-paper/60">
                  <Td>
                    <span className="flex items-center gap-8">
                      <Avatar name={a.candidateName} size={24} />
                      <span className="leading-tight">
                        <span className="block font-medium">{a.candidateName}</span>
                        <span className="block text-9 text-ink-3">{[a.candidateCompany, a.totalExp != null ? `${a.totalExp}y` : null].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <Link to={`/requirements/${a.requirementId}`} onClick={(e) => e.stopPropagation()} className="block hover:underline">{a.requirementTitle}</Link>
                    <span className="text-9 text-ink-3">{a.clientName}</span>
                  </Td>
                  <Td className="text-10 text-ink-2">{STAGE_LABELS[a.stage]}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-2">
                      <StatusPill status={a.status} />
                      {a.reasonLabel && <span className="text-9 text-ink-3">{a.reasonLabel}</span>}
                      {a.joiningRisk && <Pill tone="bad"><AlertTriangle className="size-10" />{JOINING_RISK_LABELS[a.joiningRisk]}</Pill>}
                    </div>
                  </Td>
                  <Td className="tnum whitespace-nowrap text-right text-10">{formatLpa(a.currentCtc)} → {formatLpa(a.expectedCtc)}</Td>
                  <Td className="text-10">
                    {a.nextInterviewAt ? (
                      <span className="text-cobalt">Interview {fmtDateTime(a.nextInterviewAt)}</span>
                    ) : a.expectedDoj && ['offer', 'joining'].includes(a.stage) ? (
                      <span>Joins {fmtShort(a.expectedDoj)}</span>
                    ) : waiting != null ? (
                      <span className={clsx(waiting >= 3 ? 'font-medium text-signal-red' : 'text-ink-2')}>Feedback pending {waiting}d</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </Td>
                  <Td className="text-10 text-ink-2">{a.submittedByName ?? a.addedByName}</Td>
                  <Td className="text-10 text-ink-3">{ago(a.stageChangedAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
