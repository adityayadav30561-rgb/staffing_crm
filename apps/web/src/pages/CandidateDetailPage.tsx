import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Link2, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { canDelete, STAGE_LABELS } from '@crm/shared';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { ago, fmtDate, fmtDateTime, formatLpa } from '../lib/format';
import type { CandidateDetail, Requirement } from '../lib/types';
import { Avatar, Button, Card, ErrorNote, Input, KeyValue, Loading, Modal, PageHeader, Pill, Select, StatusPill, Timeline } from '../components/ui';
import { useToast } from '../components/toast';
import { useAppDrawer, useInvalidatePipeline } from '../features/ApplicationDrawer';
import { ResumeLink } from '../features/ResumeLink';
import { CandidateDialog } from './CandidatesPage';
import { NewTaskDialog } from './TasksPage';

export function CandidateDetailPage() {
  const id = Number(useParams().id);
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const drawer = useAppDrawer();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['candidate', id], queryFn: () => api.get<CandidateDetail>(`/candidates/${id}`) });
  const [edit, setEdit] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [note, setNote] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['candidate', id] });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/candidates/${id}/resumes`, fd);
    },
    onSuccess: () => {
      toast('Resume uploaded');
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const addNote = useMutation({
    mutationFn: () => api.post(`/candidates/${id}/notes`, { body: note }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/candidates/${id}`),
    onSuccess: () => {
      toast('Candidate deleted');
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      navigate('/candidates');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (isLoading) return <Loading />;
  if (error || !c) return <ErrorNote error={error} />;
  return (
    <>
      <PageHeader
        subtitle={<Link to="/candidates" className="hover:underline">Candidates</Link>}
        title={
          <span className="flex items-center gap-10">
            <Avatar name={c.name} size={36} />
            {c.name}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setTaskOpen(true)}>Add task</Button>
            <Button icon={<Pencil className="size-14" strokeWidth={1.8} />} onClick={() => setEdit(true)}>Edit</Button>
            {canDelete(me.role) && (
              <Button variant="danger" icon={<Trash2 className="size-14" />} loading={del.isPending} onClick={() => confirm(`Delete ${c.name} and all their applications? This cannot be undone.`) && del.mutate()}>
                Delete
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="size-14" strokeWidth={1.8} />} onClick={() => setMapOpen(true)}>
              Map to requirement
            </Button>
          </>
        }
      />
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-12">
          <Card title="Requirements" action={<span className="text-9 text-ink-3">Each one keeps its own status</span>}>
            {!c.applications.length ? (
              <p className="text-10 text-ink-3">Not mapped to any requirement yet.</p>
            ) : (
              <ul className="divide-y divide-ink/[0.08]">
                {c.applications.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => drawer.open(a.id)} className="flex w-full items-center gap-10 py-8 text-left hover:bg-paper/50">
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-11 font-medium">{a.requirementTitle}</p>
                        <p className="truncate text-9 text-ink-3">
                          {a.requirementCode} · {a.clientName}
                          {a.submittedAt ? ` · submitted ${fmtDate(a.submittedAt)} by ${a.submittedByName}` : ''}
                        </p>
                      </div>
                      <span className="text-9 text-ink-3">{STAGE_LABELS[a.stage]}</span>
                      <StatusPill status={a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Notes">
            <div className="flex gap-8">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call notes, preferences, anything useful" onKeyDown={(e) => e.key === 'Enter' && note.trim() && addNote.mutate()} />
              <Button disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Add</Button>
            </div>
            <ul className="mt-12 space-y-10">
              {c.noteEntries.map((n) => (
                <li key={n.id} className="text-10">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-9 text-ink-3">{n.authorName ?? 'System'} · {fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="History"><Timeline items={c.timeline} /></Card>
        </div>
        <div className="space-y-12">
          <Card title="Profile">
            <div className="mb-12 flex flex-wrap gap-10 text-10">
              {c.phone && <a className="link inline-flex items-center gap-4" href={`tel:${c.phone}`}><Phone className="size-12" />{c.phone}</a>}
              {c.email && <a className="link inline-flex items-center gap-4" href={`mailto:${c.email}`}><Mail className="size-12" />{c.email}</a>}
              {c.linkedinUrl && <a className="link inline-flex items-center gap-4" href={c.linkedinUrl} target="_blank" rel="noreferrer"><Link2 className="size-12" />LinkedIn</a>}
            </div>
            <KeyValue
              items={[
                ['Current', [c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || null],
                ['Experience', c.totalExp != null ? `${c.totalExp} years` : null],
                ['Current CTC', formatLpa(c.currentCtc)],
                ['Expected CTC', formatLpa(c.expectedCtc)],
                ['Notice period', c.noticeDays != null ? `${c.noticeDays} days` : null],
                ['Location', c.location],
                ['Preferred', c.preferredLocations],
                ['Qualification', c.qualification],
                ['Alt. phone', c.altPhone],
                ['Source', c.source],
                ['Sourced by', c.sourcedByName ? `${c.sourcedByName} · ${ago(c.createdAt)}` : fmtDate(c.createdAt)],
                ['Notes', c.notes],
              ]}
            />
            {c.skills.length > 0 && <div className="mt-12 flex flex-wrap gap-4">{c.skills.map((s) => <Pill key={s} tone="lilac">{s}</Pill>)}</div>}
          </Card>
          <Card
            title="Resumes"
            action={
              <label className="inline-flex cursor-pointer items-center gap-4 text-10 text-forest-2 hover:underline">
                <FileUp className="size-12" /> Upload new version
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.rtf,.txt" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </label>
            }
          >
            {!c.resumes.length && <p className="text-10 text-ink-3">No resume uploaded yet.</p>}
            <ul className="space-y-6">
              {c.resumes.map((r) => (
                <li key={r.id} className="flex items-center gap-8 text-10">
                  <ResumeLink resume={r} />
                  <span className="ml-auto shrink-0 text-9 text-ink-3">{r.uploadedByName ?? 'Referral'} · {fmtDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {edit && <CandidateDialog candidate={c} onClose={() => setEdit(false)} />}
      {mapOpen && <MapDialog candidateId={c.id} mapped={new Set(c.applications.map((a) => a.requirementId))} onClose={() => setMapOpen(false)} />}
      {taskOpen && <NewTaskDialog onClose={() => setTaskOpen(false)} defaults={{ candidateId: c.id, title: `Follow up with ${c.name}` }} />}
    </>
  );
}

function MapDialog({ candidateId, mapped, onClose }: { candidateId: number; mapped: Set<number>; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidatePipeline();
  const drawer = useAppDrawer();
  const { data: reqs } = useQuery({ queryKey: ['requirements', 'open'], queryFn: () => api.get<Requirement[]>('/requirements?status=open') });
  const [reqId, setReqId] = useState('');
  const [stage, setStage] = useState<'sourced' | 'screening'>('sourced');
  const [warning, setWarning] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (ack: boolean) => api.post<{ id: number }>('/applications', { candidateId, requirementId: Number(reqId), stage, acknowledgeClientDuplicate: ack }),
    onSuccess: (a) => {
      invalidate();
      toast('Mapped to requirement');
      onClose();
      drawer.open(a.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CLIENT_DUPLICATE') setWarning(e.message);
      else toast((e as Error).message, 'error');
    },
  });
  const options = (reqs ?? []).filter((r) => !mapped.has(r.id));
  return (
    <Modal
      open
      onClose={onClose}
      title="Map to requirement"
      width={520}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          {warning ? (
            <Button variant="danger" loading={add.isPending} onClick={() => add.mutate(true)}>Map anyway</Button>
          ) : (
            <Button variant="primary" loading={add.isPending} disabled={!reqId} onClick={() => add.mutate(false)}>Map</Button>
          )}
        </>
      }
    >
      {warning && <p className="mb-10 rounded-md bg-brass-soft px-12 py-8 text-10 text-brass-text">{warning}</p>}
      <div className="space-y-10">
        <Select value={reqId} onChange={(e) => { setReqId(e.target.value); setWarning(null); }}>
          <option value="">Pick an open requirement…</option>
          {options.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.title} — {r.clientName}</option>)}
        </Select>
        <Select value={stage} onChange={(e) => setStage(e.target.value as 'sourced' | 'screening')}>
          <option value="sourced">Start at Sourced (contacted)</option>
          <option value="screening">Start at Screening</option>
        </Select>
        <p className="text-9 text-ink-3">Only requirements you own or are assigned to can be worked on; others will be refused.</p>
      </div>
    </Modal>
  );
}
