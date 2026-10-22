import { useMemo, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCopy, Download, ExternalLink, FileUp, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import {
  checkMove,
  isClosed,
  JOINING_RISK_LABELS,
  REQUIREMENT_STATUS_LABELS,
  STAGE_ENTRY_STATUS,
  STAGE_LABELS,
  STAGES,
  type RequirementStatus,
  type Stage,
} from '@crm/shared';
import { api, ApiError, download } from '../lib/api';
import { useMe } from '../lib/auth';
import { useLookup, useUsers } from '../lib/queries';
import { ago, daysSince, fmtDate, fmtDateTime, fmtShort, formatLpa } from '../lib/format';
import type { ApplicationRow, Candidate, RequirementDetail } from '../lib/types';
import { Avatar, Button, Card, Checkbox, ErrorNote, Field, Input, KeyValue, Loading, Modal, PageHeader, Pill, Select, StatusPill, Tabs, Textarea, Timeline } from '../components/ui';
import { useToast } from '../components/toast';
import { useAppDrawer, useInvalidatePipeline } from '../features/ApplicationDrawer';
import { priorityTone, RequirementDialog, requirementTone } from './RequirementsPage';

export function RequirementDetailPage() {
  const id = Number(useParams().id);
  const { data: r, isLoading, error } = useQuery({ queryKey: ['requirement', id], queryFn: () => api.get<RequirementDetail>(`/requirements/${id}`) });
  const { data: apps } = useQuery({
    queryKey: ['applications', 'requirement', id],
    queryFn: () => api.get<ApplicationRow[]>(`/applications?requirementId=${id}&active=all`),
  });
  const [tab, setTab] = useState<'pipeline' | 'details' | 'activity'>('pipeline');
  const [edit, setEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  if (isLoading) return <Loading />;
  if (error || !r) return <ErrorNote error={error} />;
  const openSlots = Math.max(r.openings - r.filled, 0);

  return (
    <>
      <PageHeader
        subtitle={
          <>
            <Link to="/requirements" className="hover:underline">Requirements</Link> · {r.code} ·{' '}
            <Link to={`/clients/${r.clientId}`} className="hover:underline">{r.client.name}</Link>
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-8">
            {r.title}
            <Pill tone={requirementTone(r.status)}>{REQUIREMENT_STATUS_LABELS[r.status]}</Pill>
            {r.priority !== 'normal' && <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>}
          </span>
        }
        actions={
          <>
            {r.canWork && <StatusActions r={r} />}
            {r.canWork && <Button icon={<Pencil className="size-14" strokeWidth={1.8} />} onClick={() => setEdit(true)}>Edit</Button>}
            <Button icon={<ClipboardCopy className="size-14" strokeWidth={1.8} />} onClick={() => setSummaryOpen(true)}>Client summary</Button>
            {r.canWork && r.status === 'open' && (
              <Button variant="primary" icon={<UserPlus className="size-14" strokeWidth={1.8} />} onClick={() => setAddOpen(true)}>
                Add candidate
              </Button>
            )}
          </>
        }
      />
      {r.status === 'draft' && (
        <p className="mb-12 rounded-lg bg-brass-soft px-14 py-10 text-11 text-brass-text">
          This requirement is a draft. Confirm the details and hiring timeline with the client, then mark it <b>Open</b> to start mapping candidates.
        </p>
      )}
      {r.status === 'open' && r.filled >= r.openings && (
        <p className="mb-12 flex items-center gap-8 rounded-lg bg-mint-soft px-14 py-10 text-11 text-forest">
          <CheckCircle2 className="size-16" /> All {r.openings} positions are filled. Once the client confirms closure, mark the requirement Filled.
        </p>
      )}
      <div className="mb-12 grid grid-cols-2 gap-10 md:grid-cols-4">
        <Stat label="Positions filled" value={`${r.filled} / ${r.openings}`} note={openSlots ? `${openSlots} open` : 'All filled'} />
        <Stat label="In pipeline" value={STAGES.reduce((n, s) => n + r.stageCounts[s], 0)} note={`${r.stageCounts.submitted} awaiting client`} />
        <Stat label="Budget" value={r.budgetMax ? `${formatLpa(r.budgetMin).replace(' LPA', '')}–${formatLpa(r.budgetMax)}` : '—'} note={r.expMin != null ? `${r.expMin}–${r.expMax ?? '+'} yrs experience` : undefined} />
        <Stat label="Age" value={`${daysSince(r.openedAt ?? r.createdAt)} days`} note={r.targetDate ? `Target ${fmtDate(r.targetDate)}` : 'No target date'} />
      </div>
      <div className="mb-12">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'pipeline', label: 'Pipeline', count: apps?.filter((a) => !a.closedAt).length },
            { value: 'details', label: 'Details & postings' },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </div>
      {tab === 'pipeline' && <Kanban r={r} apps={apps ?? []} />}
      {tab === 'details' && <DetailsTab r={r} />}
      {tab === 'activity' && <Card><Timeline items={r.timeline} /></Card>}
      {edit && <RequirementDialog requirement={r} onClose={() => setEdit(false)} />}
      {addOpen && <AddCandidateDialog r={r} onClose={() => setAddOpen(false)} existing={new Set((apps ?? []).map((a) => a.candidateId))} />}
      {summaryOpen && <SummaryDialog r={r} apps={apps ?? []} onClose={() => setSummaryOpen(false)} />}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="card px-14 py-12">
      <p className="text-9 text-ink-3">{label}</p>
      <p className="mock-display tnum mt-4 text-16">{value}</p>
      {note && <p className="mt-2 text-9 text-ink-3">{note}</p>}
    </div>
  );
}

function StatusActions({ r }: { r: RequirementDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState<RequirementStatus | null>(null);
  const [note, setNote] = useState('');
  const change = useMutation({
    mutationFn: (status: RequirementStatus) => api.post(`/requirements/${r.id}/status`, { version: r.version, status, note: note || null }),
    onSuccess: () => {
      for (const k of ['requirement', 'requirements', 'applications', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
      toast('Requirement updated');
      setTarget(null);
      setNote('');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const options: { status: RequirementStatus; label: string; primary?: boolean }[] = [];
  if (r.status === 'draft') options.push({ status: 'open', label: 'Confirmed — open', primary: true });
  if (r.status === 'open') options.push({ status: 'on_hold', label: 'Put on hold' }, { status: 'filled', label: 'Mark filled' });
  if (r.status === 'on_hold') options.push({ status: 'open', label: 'Reopen', primary: true });
  if (['filled', 'closed', 'cancelled'].includes(r.status)) options.push({ status: 'open', label: 'Reopen' });
  if (!['closed', 'cancelled'].includes(r.status)) options.push({ status: 'closed', label: 'Close' }, { status: 'cancelled', label: 'Client cancelled' });
  return (
    <>
      <Select
        className="w-[170px]"
        value=""
        onChange={(e) => e.target.value && setTarget(e.target.value as RequirementStatus)}
        aria-label="Change status"
      >
        <option value="">Change status…</option>
        {options.map((o) => <option key={o.status} value={o.status}>{o.label}</option>)}
      </Select>
      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `${REQUIREMENT_STATUS_LABELS[r.status]} → ${REQUIREMENT_STATUS_LABELS[target]}` : ''}
        width={440}
        footer={
          <>
            <Button variant="quiet" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target === 'cancelled' ? 'danger' : 'primary'} loading={change.isPending} onClick={() => change.mutate(target!)}>Confirm</Button>
          </>
        }
      >
        {target === 'cancelled' && (
          <p className="mb-10 rounded-md bg-coral-soft px-12 py-8 text-10 text-coral-2">
            Every open candidate on this requirement will be closed as “Client cancelled requirement”.
          </p>
        )}
        {target === 'open' && r.status === 'draft' && <p className="mb-10 text-10 text-ink-2">Assigned recruiters can start mapping candidates once it is open.</p>}
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

function Kanban({ r, apps }: { r: RequirementDetail; apps: ApplicationRow[] }) {
  const [showClosed, setShowClosed] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const drawer = useAppDrawer();
  const toast = useToast();
  const invalidate = useInvalidatePipeline();
  const move = useMutation({
    mutationFn: ({ a, stage }: { a: ApplicationRow; stage: Stage }) =>
      api.post(`/applications/${a.id}/move`, { version: a.version, stage, status: STAGE_ENTRY_STATUS[stage] }),
    onSuccess: () => invalidate(),
    onError: (e) => {
      toast((e as Error).message, 'error');
      if (e instanceof ApiError && e.code === 'STALE') invalidate();
    },
  });
  const visible = apps.filter((a) => showClosed || !a.closedAt);
  const onDrop = (e: DragEvent, stage: Stage) => {
    e.preventDefault();
    setOver(null);
    const a = apps.find((x) => x.id === dragId);
    setDragId(null);
    if (!a || a.stage === stage) return;
    if (a.stage === 'screening' && stage === 'submitted') {
      drawer.open(a.id); // submission needs the screening card and how it was sent
      toast('Use “Mark submitted to client” to log the submission');
      return;
    }
    const check = checkMove({ stage: a.stage, status: a.status }, { stage, status: STAGE_ENTRY_STATUS[stage] }, { hasOfferWithDoj: !!a.expectedDoj, screening: a.screening, hasSubmission: !!a.submittedAt });
    if (!check.ok) {
      toast(check.error, 'error');
      return;
    }
    move.mutate({ a, stage });
  };
  if (!apps.length) {
    return (
      <div className="card p-24 text-center">
        <Users className="mx-auto size-24 text-ink-3" strokeWidth={1.6} />
        <p className="mt-8 text-12 font-medium">No candidates mapped yet</p>
        <p className="mt-4 text-10 text-ink-3">{r.status === 'open' ? 'Use “Add candidate” to map people from the database or add new ones.' : 'Open the requirement to start mapping candidates.'}</p>
      </div>
    );
  }
  return (
    <>
      <div className="mb-8 flex items-center justify-between">
        <p className="text-9 text-ink-3">Drag a card to the next stage, or click it to update status, screening, interviews and offer.</p>
        <Checkbox label={`Show closed (${apps.filter((a) => a.closedAt).length})`} checked={showClosed} onChange={setShowClosed} />
      </div>
      <div className="grid gap-10 overflow-x-auto pb-8 [grid-template-columns:repeat(6,minmax(180px,1fr))]">
        {STAGES.map((stage) => {
          const items = visible.filter((a) => a.stage === stage);
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                if (r.canWork) {
                  e.preventDefault();
                  setOver(stage);
                }
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => onDrop(e, stage)}
              className={clsx('flex min-h-[320px] flex-col rounded-lg bg-detail p-8 ring-1 ring-ink/[0.06] transition', over === stage && 'ring-2 ring-forest-2')}
            >
              <div className="mb-8 flex items-center justify-between px-4">
                <p className="text-10 font-semibold">{STAGE_LABELS[stage]}</p>
                <span className="tnum rounded-full bg-paper-2 px-6 text-9 text-ink-2">{items.filter((a) => !a.closedAt).length}</span>
              </div>
              <div className="space-y-6">
                {items.map((a) => (
                  <KanbanCard key={a.id} a={a} draggable={r.canWork && !a.closedAt} onDragStart={() => setDragId(a.id)} onClick={() => drawer.open(a.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function KanbanCard({ a, draggable, onDragStart, onClick }: { a: ApplicationRow; draggable: boolean; onDragStart: () => void; onClick: () => void }) {
  const closed = isClosed(a.status);
  const waiting = a.status === 'feedback_pending' && a.submittedAt ? daysSince(a.submittedAt) : null;
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onClick={onClick}
      className={clsx('block w-full rounded-md bg-surface p-10 text-left shadow-[0_1px_2px_rgb(22_24_27/0.06)] ring-1 ring-ink/[0.08] transition hover:ring-forest-2/40', closed && 'opacity-60', draggable && 'cursor-grab active:cursor-grabbing')}
    >
      <div className="flex items-start gap-6">
        <Avatar name={a.candidateName} size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-10 font-medium">{a.candidateName}</p>
          <p className="truncate text-9 text-ink-3">{[a.candidateCompany, a.totalExp != null ? `${a.totalExp}y` : null].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <StatusPill status={a.status} />
        {a.joiningRisk && (
          <Pill tone="bad"><AlertTriangle className="size-10" />{JOINING_RISK_LABELS[a.joiningRisk]}</Pill>
        )}
      </div>
      <div className="mt-6 space-y-2 text-9 text-ink-3">
        <p className="tnum">{formatLpa(a.currentCtc)} → {formatLpa(a.expectedCtc)}{a.noticeDays != null ? ` · ${a.noticeDays}d notice` : ''}</p>
        {a.nextInterviewAt && <p className="flex items-center gap-4 text-cobalt"><CalendarClock className="size-10" />{fmtDateTime(a.nextInterviewAt)}</p>}
        {a.expectedDoj && ['offer', 'joining'].includes(a.stage) && <p>Joins {fmtShort(a.expectedDoj)}</p>}
        {waiting != null && <p className={clsx(waiting >= 3 && 'font-medium text-signal-red')}>Waiting {waiting}d for feedback</p>}
        {a.reasonLabel && <p>{a.reasonLabel}</p>}
        <p>{a.submittedByName ? `Submitted by ${a.submittedByName}` : `Added by ${a.addedByName ?? '—'}`}</p>
      </div>
    </button>
  );
}

function DetailsTab({ r }: { r: RequirementDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: users } = useUsers();
  const platforms = useLookup('platform');
  const [team, setTeam] = useState<number[] | null>(null);
  const [posting, setPosting] = useState({ platform: '', postedOn: new Date().toISOString().slice(0, 10), url: '', expiresOn: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['requirement', r.id] });
  const saveTeam = useMutation({
    mutationFn: () => api.put(`/requirements/${r.id}/assignees`, { userIds: team }),
    onSuccess: () => {
      toast('Team updated');
      setTeam(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const addPosting = useMutation({
    mutationFn: () => api.post(`/requirements/${r.id}/postings`, { ...posting, url: posting.url || null, expiresOn: posting.expiresOn || null }),
    onSuccess: () => {
      setPosting((p) => ({ ...p, url: '', expiresOn: '' }));
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const delPosting = useMutation({ mutationFn: (pid: number) => api.del(`/requirements/${r.id}/postings/${pid}`), onSuccess: refresh });
  const uploadJd = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/requirements/${r.id}/jd`, fd);
    },
    onSuccess: () => {
      toast('JD uploaded');
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const assigned = new Set(r.assignees.map((a) => a.id));

  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-12">
        <Card
          title="Job description"
          action={
            <span className="flex items-center gap-8">
              {r.jdFileUrl && (
                <a href={r.jdFileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-4 text-10 text-forest-2 hover:underline">
                  <ExternalLink className="size-12" />{r.jdFileName}
                </a>
              )}
              {r.canWork && (
                <label className="inline-flex cursor-pointer items-center gap-4 text-10 text-ink-2 hover:text-ink">
                  <FileUp className="size-12" /> {r.jdFileName ? 'Replace file' : 'Attach JD file'}
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.rtf" onChange={(e) => e.target.files?.[0] && uploadJd.mutate(e.target.files[0])} />
                </label>
              )}
            </span>
          }
        >
          {r.jdText ? <p className="whitespace-pre-wrap text-11 leading-relaxed">{r.jdText}</p> : <p className="text-10 text-ink-3">No JD text yet.</p>}
          {r.skills.length > 0 && (
            <div className="mt-12 flex flex-wrap gap-4">{r.skills.map((s) => <Pill key={s} tone="lilac">{s}</Pill>)}</div>
          )}
        </Card>
        <Card title="Job postings" action={<span className="text-9 text-ink-3">Where this opening is advertised</span>}>
          {r.postings.length > 0 && (
            <ul className="mb-12 space-y-6">
              {r.postings.map((p) => {
                const expired = p.expiresOn && new Date(p.expiresOn) < new Date();
                return (
                  <li key={p.id} className="flex items-center gap-8 text-10">
                    <Pill tone={expired ? 'warn' : 'good'}>{p.platform}</Pill>
                    <span className="text-ink-2">Posted {fmtDate(p.postedOn)} by {p.postedByName ?? '—'}</span>
                    {p.expiresOn && <span className={clsx(expired ? 'font-medium text-brass-text' : 'text-ink-3')}>{expired ? 'Expired' : 'Refresh by'} {fmtDate(p.expiresOn)}</span>}
                    {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="link">Link</a>}
                    {r.canWork && (
                      <button className="ml-auto text-ink-3 hover:text-signal-red" onClick={() => delPosting.mutate(p.id)} aria-label="Remove posting">
                        <Trash2 className="size-12" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {r.canWork && (
            <div className="grid grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)_140px_auto] items-end gap-8">
              <Field label="Platform">
                <Select value={posting.platform} onChange={(e) => setPosting({ ...posting, platform: e.target.value })}>
                  <option value="">Pick…</option>
                  {platforms.map((p) => <option key={p.id} value={p.label}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Posted on"><Input type="date" value={posting.postedOn} onChange={(e) => setPosting({ ...posting, postedOn: e.target.value })} /></Field>
              <Field label="Link (optional)"><Input value={posting.url} onChange={(e) => setPosting({ ...posting, url: e.target.value })} /></Field>
              <Field label="Refresh / expires"><Input type="date" value={posting.expiresOn} onChange={(e) => setPosting({ ...posting, expiresOn: e.target.value })} /></Field>
              <Button disabled={!posting.platform} loading={addPosting.isPending} onClick={() => addPosting.mutate()}>Log</Button>
            </div>
          )}
        </Card>
      </div>
      <div className="space-y-12">
        <Card
          title="Team"
          action={r.canAssign && team === null && <Button size="sm" variant="quiet" onClick={() => setTeam([...assigned])}>Assign recruiters</Button>}
        >
          <ul className="space-y-8">
            <li className="flex items-center gap-8 text-11">
              <Avatar name={r.owner.name} />
              <span className="flex-1">{r.owner.name}</span>
              <Pill tone="dark">Owner</Pill>
            </li>
            {team === null &&
              r.assignees.map((a) => (
                <li key={a.id} className="flex items-center gap-8 text-11">
                  <Avatar name={a.name} />
                  <span className="flex-1">{a.name}</span>
                  <span className="text-9 text-ink-3">Assigned</span>
                </li>
              ))}
          </ul>
          {team !== null && (
            <div className="mt-10 space-y-6">
              {users?.filter((u) => u.active && u.id !== r.ownerId).map((u) => (
                <Checkbox key={u.id} label={u.name} checked={team.includes(u.id)} onChange={(v) => setTeam((t) => (v ? [...t!, u.id] : t!.filter((x) => x !== u.id)))} />
              ))}
              <div className="flex justify-end gap-8 pt-6">
                <Button size="sm" variant="quiet" onClick={() => setTeam(null)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={saveTeam.isPending} onClick={() => saveTeam.mutate()}>Save team</Button>
              </div>
            </div>
          )}
          {team === null && !r.assignees.length && <p className="mt-8 text-10 text-ink-3">Only the owner is working on this.</p>}
        </Card>
        <Card title="Details">
          <KeyValue
            items={[
              ['Client contact', r.contact ? `${r.contact.name}${r.contact.designation ? ` (${r.contact.designation})` : ''}` : null],
              ['Contact phone', r.contact?.phone ? <a className="link" href={`tel:${r.contact.phone}`}>{r.contact.phone}</a> : null],
              ['Location', [r.location, r.workMode].filter(Boolean).join(' · ') || null],
              ['Experience', r.expMin != null ? `${r.expMin}–${r.expMax ?? '+'} years` : null],
              ['Budget', r.budgetMax ? `${formatLpa(r.budgetMin)} – ${formatLpa(r.budgetMax)}` : null],
              ['Target date', r.targetDate ? fmtDate(r.targetDate) : null],
              ['Opened', r.openedAt ? `${fmtDate(r.openedAt)} (${ago(r.openedAt)})` : 'Not yet'],
              ['Replacement guarantee', `${r.client.replacementDays} days`],
              ['Notes', r.notes],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function AddCandidateDialog({ r, onClose, existing }: { r: RequirementDetail; onClose: () => void; existing: Set<number> }) {
  const [q, setQ] = useState(r.skills.slice(0, 1).join(''));
  const [stage, setStage] = useState<'sourced' | 'screening'>('sourced');
  const [warning, setWarning] = useState<{ candidateId: number; message: string } | null>(null);
  const toast = useToast();
  const invalidate = useInvalidatePipeline();
  const drawer = useAppDrawer();
  const { data } = useQuery({
    queryKey: ['candidates', 'pick', q],
    queryFn: () => api.get<{ items: Candidate[] }>(`/candidates?q=${encodeURIComponent(q)}&pageSize=20`),
  });
  const add = useMutation({
    mutationFn: ({ candidateId, ack }: { candidateId: number; ack: boolean }) =>
      api.post<{ id: number }>('/applications', { candidateId, requirementId: r.id, stage, acknowledgeClientDuplicate: ack }),
    onSuccess: (a) => {
      invalidate();
      toast('Candidate mapped');
      setWarning(null);
      onClose();
      drawer.open(a.id);
    },
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === 'CLIENT_DUPLICATE') setWarning({ candidateId: v.candidateId, message: e.message });
      else toast((e as Error).message, 'error');
    },
  });
  return (
    <Modal open onClose={onClose} title={`Add candidate to ${r.title}`} width={640}>
      <div className="mb-10 grid grid-cols-[minmax(0,1fr)_180px] gap-8">
        <Input autoFocus placeholder="Search name, phone, company or skill" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={stage} onChange={(e) => setStage(e.target.value as 'sourced' | 'screening')}>
          <option value="sourced">Start at Sourced</option>
          <option value="screening">Start at Screening</option>
        </Select>
      </div>
      {warning && (
        <div className="mb-10 rounded-md bg-brass-soft px-12 py-10 text-10 text-brass-text">
          <p className="flex gap-6"><AlertTriangle className="size-14 shrink-0" />{warning.message}</p>
          <div className="mt-8 flex justify-end gap-8">
            <Button size="sm" variant="quiet" onClick={() => setWarning(null)}>Cancel</Button>
            <Button size="sm" variant="danger" loading={add.isPending} onClick={() => add.mutate({ candidateId: warning.candidateId, ack: true })}>Add anyway</Button>
          </div>
        </div>
      )}
      <ul className="max-h-[50vh] divide-y divide-ink/[0.08] overflow-y-auto">
        {data?.items.map((c) => {
          const already = existing.has(c.id);
          return (
            <li key={c.id} className="flex items-center gap-10 py-8">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-11 font-medium">{c.name}</p>
                <p className="truncate text-9 text-ink-3">
                  {[c.currentTitle, c.currentCompany, c.totalExp != null ? `${c.totalExp} yrs` : null, formatLpa(c.expectedCtc), c.noticeDays != null ? `${c.noticeDays}d notice` : null].filter(Boolean).join(' · ')}
                </p>
                {c.skills.length > 0 && <p className="truncate text-9 text-ink-2">{c.skills.join(', ')}</p>}
              </div>
              {already ? (
                <Pill>Already mapped</Pill>
              ) : (
                <Button size="sm" variant="primary" loading={add.isPending && add.variables?.candidateId === c.id} onClick={() => add.mutate({ candidateId: c.id, ack: false })}>
                  <Plus className="size-12" /> Add
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-10 text-9 text-ink-3">
        Not in the database? <Link to="/candidates?new=1" className="link" onClick={onClose}>Add a new candidate</Link> first, then map them here.
      </p>
    </Modal>
  );
}

/** Doc step 5: profile summary table to paste into the client email, or download as Excel. */
function SummaryDialog({ r, apps, onClose }: { r: RequirementDetail; apps: ApplicationRow[]; onClose: () => void }) {
  const toast = useToast();
  const candidates = useMemo(() => apps.filter((a) => !a.closedAt && ['screening', 'submitted'].includes(a.stage)), [apps]);
  const [ids, setIds] = useState<number[]>(() => candidates.filter((a) => a.status === 'screened_ok').map((a) => a.id));
  const copy = async () => {
    const rows = await api.get<Record<string, string | number | null>[]>(`/requirements/${r.id}/summary?ids=${ids.join(',')}`);
    const head = ['Name', 'Experience', 'Current company', 'Current CTC', 'Expected CTC', 'Notice', 'Location', 'Remarks'];
    const lines = rows.map((x) => [
      x.name,
      x.totalExp != null ? `${x.totalExp} yrs` : '',
      x.currentCompany ?? '',
      formatLpa(x.currentCtc as number | null),
      formatLpa(x.expectedCtc as number | null),
      x.noticeDays != null ? `${x.noticeDays} days` : '',
      x.location ?? '',
      x.remarks ?? '',
    ]);
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const html = `<table border="1" cellpadding="4" style="border-collapse:collapse;font-family:Arial;font-size:12px"><tr>${head.map((h) => `<th style="background:#e0f1e6">${h}</th>`).join('')}</tr>${lines.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = [head, ...lines].map((l) => l.join('\t')).join('\n');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    toast('Table copied — paste it into your email');
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Client summary"
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Close</Button>
          <Button icon={<Download className="size-14" />} disabled={!ids.length} onClick={() => void download(`/requirements/${r.id}/summary?ids=${ids.join(',')}&format=xlsx`, 'profiles.xlsx').catch((e) => toast(e.message, 'error'))}>
            Excel
          </Button>
          <Button variant="primary" icon={<ClipboardCopy className="size-14" />} disabled={!ids.length} onClick={() => void copy().catch((e) => toast(e.message, 'error'))}>
            Copy table
          </Button>
        </>
      }
    >
      <p className="mb-10 text-10 text-ink-2">Pick the profiles you are sending. The table uses the screening card (CTC, notice, remarks).</p>
      {!candidates.length && <p className="text-10 text-ink-3">No candidates in Screening or Submitted.</p>}
      <ul className="space-y-6">
        {candidates.map((a) => (
          <li key={a.id} className="flex items-center gap-8">
            <Checkbox label={a.candidateName} checked={ids.includes(a.id)} onChange={(v) => setIds((s) => (v ? [...s, a.id] : s.filter((x) => x !== a.id)))} />
            <span className="ml-auto"><StatusPill status={a.status} /></span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
