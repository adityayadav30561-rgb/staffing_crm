import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Briefcase, Plus } from 'lucide-react';
import { PRIORITIES, REQUIREMENT_STATUS_LABELS, STAGE_LABELS, STAGES, splitSkills, type Priority, type RequirementStatus } from '@crm/shared';
import { api, ApiError } from '../lib/api';
import { ago, daysSince, formatLpa, fromLakhs, toLakhs } from '../lib/format';
import type { Client, Contact, Requirement } from '../lib/types';
import { Avatar, Button, Checkbox, Empty, Field, Input, Loading, Modal, PageHeader, Pill, Select, Table, Tabs, Td, Textarea, Th, type Tone } from '../components/ui';
import { useToast } from '../components/toast';

export const requirementTone = (s: RequirementStatus): Tone =>
  ({ draft: 'neutral', open: 'good', on_hold: 'warn', filled: 'dark', closed: 'neutral', cancelled: 'bad' })[s] as Tone;

export const priorityTone = (p: Priority): Tone => ({ low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'bad' })[p] as Tone;

const STATUS_TABS = [
  { value: 'active', label: 'Active', status: 'draft,open,on_hold' },
  { value: 'open', label: 'Open', status: 'open' },
  { value: 'draft', label: 'Draft', status: 'draft' },
  { value: 'done', label: 'Filled & closed', status: 'filled,closed' },
  { value: 'cancelled', label: 'Cancelled', status: 'cancelled' },
  { value: 'all', label: 'All', status: 'all' },
] as const;

export function RequirementsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]['value']>('active');
  const [mine, setMine] = useState(false);
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  useEffect(() => {
    if (params.get('new') === '1') {
      setNewOpen(true);
      setParams((p) => {
        p.delete('new');
        return p;
      });
    }
  }, [params, setParams]);
  const status = STATUS_TABS.find((t) => t.value === tab)!.status;
  const { data, isLoading } = useQuery({
    queryKey: ['requirements', status, mine, clientId, q],
    queryFn: () => api.get<Requirement[]>(`/requirements?status=${status}&mine=${mine}&clientId=${clientId}&q=${encodeURIComponent(q)}`),
  });
  const { data: clients } = useQuery({ queryKey: ['clients', '', 'all'], queryFn: () => api.get<Client[]>('/clients?active=all') });

  return (
    <>
      <PageHeader
        title="Requirements"
        subtitle={data ? `${data.length} shown · ${data.reduce((n, r) => n + Math.max(r.openings - r.filled, 0), 0)} open positions` : undefined}
        actions={
          <Button variant="primary" icon={<Plus className="size-14" strokeWidth={1.8} />} onClick={() => setNewOpen(true)}>
            New requirement
          </Button>
        }
      />
      <div className="mb-12 flex flex-wrap items-center gap-8">
        <Tabs value={tab} onChange={setTab} items={STATUS_TABS.map((t) => ({ value: t.value, label: t.label }))} />
        <Input className="max-w-[240px]" placeholder="Search title or code" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-[200px]" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Checkbox label="Only mine" checked={mine} onChange={setMine} />
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty icon={<Briefcase className="size-18" />} title="No requirements here">Create a requirement when a client shares a position.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Requirement</Th>
              <Th>Status</Th>
              <Th>Team</Th>
              <Th className="text-right">Filled</Th>
              {STAGES.map((s) => <Th key={s} className="text-right">{STAGE_LABELS[s]}</Th>)}
              <Th>Age</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="hover:bg-paper/60">
                <Td>
                  <Link to={`/requirements/${r.id}`} className="block font-medium hover:underline">{r.title}</Link>
                  <span className="text-9 text-ink-3">{r.code} · {r.clientName}{r.budgetMax ? ` · up to ${formatLpa(r.budgetMax)}` : ''}</span>
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-4">
                    <Pill tone={requirementTone(r.status)}>{REQUIREMENT_STATUS_LABELS[r.status]}</Pill>
                    {['high', 'urgent'].includes(r.priority) && <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>}
                  </div>
                </Td>
                <Td>
                  <div className="flex -space-x-4">
                    <Avatar name={r.ownerName} size={24} className="ring-2 ring-surface" />
                    {r.assignees.map((a) => <Avatar key={a.id} name={a.name} size={24} className="ring-2 ring-surface" />)}
                  </div>
                </Td>
                <Td className="tnum text-right"><span className={clsx(r.filled >= r.openings && 'font-semibold text-forest')}>{r.filled}/{r.openings}</span></Td>
                {STAGES.map((s) => (
                  <Td key={s} className={clsx('tnum text-right', r.stageCounts[s] ? 'text-ink' : 'text-ink-3')}>{r.stageCounts[s] || '·'}</Td>
                ))}
                <Td className="tnum text-ink-2">{daysSince(r.openedAt ?? r.createdAt)}d</Td>
                <Td className="text-10 text-ink-3">{ago(r.lastActivityAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {newOpen && <RequirementDialog onClose={() => setNewOpen(false)} defaultClientId={params.get('clientId') ?? clientId} />}
    </>
  );
}

export function RequirementDialog({ requirement, onClose, defaultClientId }: { requirement?: Requirement; onClose: () => void; defaultClientId?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: clients } = useQuery({ queryKey: ['clients', '', 'true'], queryFn: () => api.get<Client[]>('/clients?active=true') });
  const [f, setF] = useState(() => ({
    clientId: String(requirement?.clientId ?? defaultClientId ?? ''),
    contactId: String(requirement?.contactId ?? ''),
    title: requirement?.title ?? '',
    openings: String(requirement?.openings ?? 1),
    expMin: requirement?.expMin?.toString() ?? '',
    expMax: requirement?.expMax?.toString() ?? '',
    budgetMin: toLakhs(requirement?.budgetMin),
    budgetMax: toLakhs(requirement?.budgetMax),
    skills: requirement?.skills.join(', ') ?? '',
    location: requirement?.location ?? '',
    workMode: requirement?.workMode ?? '',
    priority: (requirement?.priority ?? 'normal') as Priority,
    targetDate: requirement?.targetDate ?? '',
    jdText: requirement?.jdText ?? '',
    notes: requirement?.notes ?? '',
  }));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const { data: client } = useQuery({
    queryKey: ['client', Number(f.clientId)],
    queryFn: () => api.get<Client & { contacts: Contact[] }>(`/clients/${f.clientId}`),
    enabled: !!f.clientId,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        clientId: Number(f.clientId),
        contactId: f.contactId ? Number(f.contactId) : null,
        title: f.title,
        openings: Number(f.openings) || 1,
        expMin: f.expMin === '' ? null : Number(f.expMin),
        expMax: f.expMax === '' ? null : Number(f.expMax),
        budgetMin: fromLakhs(f.budgetMin),
        budgetMax: fromLakhs(f.budgetMax),
        skills: splitSkills(f.skills),
        location: f.location,
        workMode: f.workMode || null,
        priority: f.priority,
        targetDate: f.targetDate || null,
        jdText: f.jdText,
        notes: f.notes,
      };
      return requirement
        ? api.patch<Requirement>(`/requirements/${requirement.id}`, { ...body, version: requirement.version })
        : api.post<Requirement>('/requirements', body);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['requirements'] });
      void qc.invalidateQueries({ queryKey: ['requirement'] });
      toast(requirement ? 'Requirement updated' : 'Requirement created as Draft — open it once confirmed with the client');
      onClose();
      if (!requirement) navigate(`/requirements/${r.id}`);
    },
    onError: (e) => {
      toast((e as Error).message, 'error');
      if (e instanceof ApiError && e.code === 'STALE') void qc.invalidateQueries({ queryKey: ['requirement'] });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={requirement ? `Edit ${requirement.code}` : 'New requirement'}
      width={680}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.clientId || f.title.trim().length < 2} onClick={() => save.mutate()}>
            {requirement ? 'Save' : 'Create requirement'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-6 gap-10">
        <Field label="Client" className="col-span-3">
          <Select value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('contactId', ''); }} disabled={!!requirement && requirement.filled > 0}>
            <option value="">Pick a client…</option>
            {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Client contact" className="col-span-3">
          <Select value={f.contactId} onChange={(e) => set('contactId', e.target.value)} disabled={!client}>
            <option value="">—</option>
            {client?.contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.designation ? ` (${c.designation})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Job title" className="col-span-4"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Senior React Developer" /></Field>
        <Field label="Positions" className="col-span-2"><Input inputMode="numeric" value={f.openings} onChange={(e) => set('openings', e.target.value)} /></Field>
        <Field label="Experience from (yrs)" className="col-span-2"><Input inputMode="decimal" value={f.expMin} onChange={(e) => set('expMin', e.target.value)} /></Field>
        <Field label="to (yrs)" className="col-span-1"><Input inputMode="decimal" value={f.expMax} onChange={(e) => set('expMax', e.target.value)} /></Field>
        <Field label="Budget from (LPA)" className="col-span-2"><Input inputMode="decimal" value={f.budgetMin} onChange={(e) => set('budgetMin', e.target.value)} /></Field>
        <Field label="to (LPA)" className="col-span-1"><Input inputMode="decimal" value={f.budgetMax} onChange={(e) => set('budgetMax', e.target.value)} /></Field>
        <Field label="Skills" hint="Separate with commas" className="col-span-6"><Input value={f.skills} onChange={(e) => set('skills', e.target.value)} placeholder="React, TypeScript, Redux" /></Field>
        <Field label="Location" className="col-span-2"><Input value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Work mode" className="col-span-2">
          <Select value={f.workMode} onChange={(e) => set('workMode', e.target.value)}>
            <option value="">—</option>
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </Select>
        </Field>
        <Field label="Priority" className="col-span-2">
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Hiring timeline (target date)" className="col-span-3"><Input type="date" value={f.targetDate} onChange={(e) => set('targetDate', e.target.value)} /></Field>
        <Field label="Job description" className="col-span-6"><Textarea className="min-h-[140px]" value={f.jdText} onChange={(e) => set('jdText', e.target.value)} placeholder="Paste the JD from the client's email or WhatsApp" /></Field>
        <Field label="Internal notes" className="col-span-6"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
