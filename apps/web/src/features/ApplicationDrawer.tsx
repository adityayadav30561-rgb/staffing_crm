// One application (candidate × requirement): every stage of the process doc is worked from here.
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  FileText,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import {
  INTERVIEW_AWAITING_OUTCOME,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUSES,
  INTERVIEW_MODES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  JOINING_RISK_LABELS,
  JOINING_RISKS,
  REASON_KIND_FOR_STATUS,
  STAGE_ENTRY_STATUS,
  STAGE_GATE,
  STAGE_LABELS,
  STAGE_STATUSES,
  STAGES,
  STATUS_LABELS,
  SUBMISSION_CHANNELS,
  canSeeFees,
  isClosed,
  stageIndex,
  type AppStatus,
  type InterviewMode,
  type InterviewStatus,
  type InvoiceStatus,
  type JoiningRisk,
  type Stage,
  type SubmissionChannel,
} from '@crm/shared';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { useLookup, useSettings, useUsers } from '../lib/queries';
import {
  dateTimeInput,
  fmtDate,
  fmtDateTime,
  formatInr,
  formatLpa,
  fromLakhs,
  toLakhs,
} from '../lib/format';
import type { ApplicationDetail, Interview } from '../lib/types';
import {
  Avatar,
  Button,
  Checkbox,
  Drawer,
  ErrorNote,
  Field,
  Input,
  KeyValue,
  Loading,
  Modal,
  Pill,
  Select,
  StatusPill,
  Textarea,
  Timeline,
} from '../components/ui';
import { useToast } from '../components/toast';
import { ResumeLink } from './ResumeLink';

export function useAppDrawer() {
  const [params, setParams] = useSearchParams();
  return {
    open: (id: number) =>
      setParams((p) => {
        p.set('app', String(id));
        return p;
      }),
    close: () =>
      setParams((p) => {
        p.delete('app');
        return p;
      }),
    id: params.get('app') ? Number(params.get('app')) : null,
  };
}

/** Refreshes every view that shows pipeline data after a change. */
export function useInvalidatePipeline() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      'application',
      'applications',
      'requirement',
      'requirements',
      'candidate',
      'candidates',
      'dashboard',
      'counts',
      'tasks',
      'calendar',
      'placements',
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function ApplicationDrawer() {
  const { id, close } = useAppDrawer();
  return (
    <Drawer open={!!id} onClose={close} width={560}>
      {id && <DrawerBody id={id} onClose={close} />}
    </Drawer>
  );
}

function DrawerBody({ id, onClose }: { id: number; onClose: () => void }) {
  const {
    data: a,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['application', id],
    queryFn: () => api.get<ApplicationDetail>(`/applications/${id}`),
  });
  if (isLoading) return <Loading />;
  if (error || !a)
    return (
      <div className="p-18">
        <ErrorNote error={error ?? new Error('Not found')} />
      </div>
    );
  const closed = isClosed(a.status);
  return (
    <>
      <header className="border-b hairline px-18 pb-14 pt-16">
        <div className="flex items-start gap-10">
          <Avatar name={a.candidate.name} size={36} />
          <div className="min-w-0 flex-1">
            <Link
              to={`/candidates/${a.candidateId}`}
              onClick={onClose}
              className="title block truncate text-14 hover:underline"
            >
              {a.candidate.name}
            </Link>
            <p className="truncate text-10 text-ink-2">
              <Link
                to={`/requirements/${a.requirementId}`}
                onClick={onClose}
                className="hover:underline"
              >
                {a.requirement.code} · {a.requirement.title}
              </Link>{' '}
              · {a.requirement.clientName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-4 text-ink-3 hover:bg-paper-2"
            aria-label="Close"
          >
            <X className="size-16" strokeWidth={1.8} />
          </button>
        </div>
        <StageTrack stage={a.stage} closed={closed} />
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <StatusPill status={a.status} />
          {a.reasonLabel && <span className="text-10 text-ink-2">— {a.reasonLabel}</span>}
          {a.joiningRisk && (
            <Pill tone="bad">
              <AlertTriangle className="size-12" strokeWidth={1.8} />{' '}
              {JOINING_RISK_LABELS[a.joiningRisk]}
            </Pill>
          )}
          <span className="ml-auto text-9 text-ink-3">Added by {a.addedByName ?? '—'}</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-14 overflow-y-auto px-18 py-16">
        {!a.canWork && (
          <p className="rounded-md bg-paper-2 px-12 py-8 text-10 text-ink-2">
            You can view this, but only the requirement's owner, its assigned recruiters or a
            manager can change it.
          </p>
        )}
        <StatusControl a={a} />
        <CandidateFacts a={a} />
        {(a.stage === 'screening' || a.screening) && <ScreeningSection a={a} />}
        {a.submittedAt && <SubmissionSection a={a} />}
        {(a.stage === 'interview' || a.interviews.length > 0) && <InterviewsSection a={a} />}
        {(a.stage === 'offer' || a.stage === 'joining' || a.offer) && <OfferSection a={a} />}
        {['offer', 'joining'].includes(a.stage) && !closed && <RiskSection a={a} />}
        {a.placement && <PlacementSection a={a} />}
        <NotesSection a={a} />
        <Section title="Timeline">
          <Timeline items={a.timeline} />
        </Section>
      </div>
    </>
  );
}

function StageTrack({ stage, closed }: { stage: Stage; closed: boolean }) {
  const cur = stageIndex(stage);
  return (
    <ol className="mt-14 grid grid-cols-6 gap-4">
      {STAGES.map((s, i) => (
        <li key={s} className="min-w-0">
          <div
            className={clsx(
              'h-[4px] rounded-full',
              i < cur ? 'bg-moss' : i === cur ? (closed ? 'bg-ink-3' : 'bg-forest') : 'bg-paper-3',
            )}
          />
          <p
            className={clsx(
              'mt-4 truncate text-9',
              i === cur ? 'font-medium text-ink' : 'text-ink-3',
            )}
          >
            {STAGE_LABELS[s]}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-surface p-14 ring-1 ring-ink/[0.08]">
      <div className="mb-10 flex items-center justify-between gap-8">
        <h3 className="text-11 font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Wraps a mutation with toast + stale-record handling. */
function useAppMutation<T>(
  a: ApplicationDetail,
  fn: (v: T) => Promise<unknown>,
  okMessage?: string,
) {
  const invalidate = useInvalidatePipeline();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate();
      if (okMessage) toast(okMessage);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'STALE') {
        invalidate();
        toast(e.message, 'error');
      } else if (!(e instanceof ApiError && e.code === 'CLIENT_DUPLICATE')) {
        toast((e as Error).message, 'error');
      }
    },
    meta: { applicationId: a.id },
  });
}

function StatusControl({ a }: { a: ApplicationDetail }) {
  const [reasonFor, setReasonFor] = useState<{ stage: Stage; status: AppStatus } | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const move = useAppMutation(
    a,
    (v: { stage: Stage; status: AppStatus; reasonId?: number | null; note?: string | null }) =>
      api.post(`/applications/${a.id}/move`, { version: a.version, ...v }),
  );
  const pick = (stage: Stage, status: AppStatus) => {
    if (REASON_KIND_FOR_STATUS[status]) setReasonFor({ stage, status });
    else move.mutate({ stage, status });
  };
  const idx = stageIndex(a.stage);
  const next = STAGES[idx + 1];
  const gate = STAGE_GATE[a.stage];
  const canAdvance = a.canWork && next && a.status === gate;
  const disabled = !a.canWork || move.isPending;

  return (
    <Section title={`${STAGE_LABELS[a.stage]} status`}>
      <div className="flex flex-wrap gap-6">
        {STAGE_STATUSES[a.stage].map((s) => (
          <button
            key={s}
            disabled={disabled || s === a.status}
            onClick={() => pick(a.stage, s)}
            className={clsx(
              'rounded-full px-10 py-5 text-10 transition disabled:cursor-default',
              s === a.status
                ? 'bg-forest font-medium text-mint'
                : 'text-ink-2 ring-1 ring-ink/10 hover:bg-paper disabled:opacity-60',
            )}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {a.canWork && (
        <div className="mt-12 flex flex-wrap items-center gap-8">
          {a.stage === 'screening' && !isClosed(a.status) && (
            <Button
              variant="primary"
              icon={<Send className="size-14" strokeWidth={1.8} />}
              onClick={() => setSubmitOpen(true)}
              disabled={a.missingScreening.length > 0}
            >
              Mark submitted to client
            </Button>
          )}
          {canAdvance && a.stage !== 'screening' && (
            <Button
              variant="primary"
              icon={<ArrowRight className="size-14" strokeWidth={1.8} />}
              loading={move.isPending}
              onClick={() => move.mutate({ stage: next, status: STAGE_ENTRY_STATUS[next] })}
              disabled={next === 'joining' && !a.offer?.expectedDoj}
              title={
                next === 'joining' && !a.offer?.expectedDoj
                  ? 'Record the offer with an expected joining date first'
                  : undefined
              }
            >
              Move to {STAGE_LABELS[next]}
            </Button>
          )}
          {a.stage === 'interview' && !isClosed(a.status) && a.status !== 'selected' && (
            <Button
              icon={<CalendarPlus className="size-14" strokeWidth={1.8} />}
              onClick={() => setInterviewOpen(true)}
            >
              {a.interviews.length ? 'Next round' : 'Log interview'}
            </Button>
          )}
          <MoreMenu
            a={a}
            onWithdraw={() => setReasonFor({ stage: a.stage, status: 'withdrawn' })}
            onBack={(s) => move.mutate({ stage: s, status: STAGE_ENTRY_STATUS[s] })}
          />
        </div>
      )}
      {a.stage === 'screening' && a.missingScreening.length > 0 && !isClosed(a.status) && (
        <p className="mt-8 text-9 text-ink-3">
          Fill the screening card below before marking the profile as submitted.
        </p>
      )}
      {next === 'joining' && a.status === 'offer_accepted' && !a.offer?.expectedDoj && (
        <p className="mt-8 text-9 text-ink-3">
          Record the offer with an expected joining date to move to Joining.
        </p>
      )}
      <ReasonDialog
        target={reasonFor}
        onClose={() => setReasonFor(null)}
        loading={move.isPending}
        onConfirm={(reasonId, note) =>
          move.mutate({ ...reasonFor!, reasonId, note }, { onSuccess: () => setReasonFor(null) })
        }
      />
      {submitOpen && <SubmitDialog a={a} onClose={() => setSubmitOpen(false)} />}
      {interviewOpen && <InterviewDialog a={a} onClose={() => setInterviewOpen(false)} />}
    </Section>
  );
}

function MoreMenu({
  a,
  onWithdraw,
  onBack,
}: {
  a: ApplicationDetail;
  onWithdraw: () => void;
  onBack: (s: Stage) => void;
}) {
  const [open, setOpen] = useState(false);
  const earlier = STAGES.slice(0, stageIndex(a.stage));
  if (isClosed(a.status) && !earlier.length) return null;
  return (
    <div className="relative ml-auto">
      <Button variant="quiet" size="sm" onClick={() => setOpen((o) => !o)}>
        More…
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full z-10 mt-4 w-[220px] rounded-lg bg-surface p-4 shadow-pop"
          onMouseLeave={() => setOpen(false)}
        >
          {!isClosed(a.status) && (
            <button
              className="flex w-full items-center gap-8 rounded-md px-10 py-7 text-left text-10 hover:bg-paper"
              onClick={() => {
                setOpen(false);
                onWithdraw();
              }}
            >
              <Undo2 className="size-14" strokeWidth={1.8} /> Withdraw candidate…
            </button>
          )}
          {earlier.map((s) => (
            <button
              key={s}
              className="flex w-full items-center gap-8 rounded-md px-10 py-7 text-left text-10 hover:bg-paper"
              onClick={() => {
                setOpen(false);
                if (confirm(`Move back to ${STAGE_LABELS[s]}? Use this to correct a mistake.`))
                  onBack(s);
              }}
            >
              <ArrowLeft className="size-14" strokeWidth={1.8} /> Move back to {STAGE_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReasonDialog({
  target,
  onClose,
  onConfirm,
  loading,
}: {
  target: { stage: Stage; status: AppStatus } | null;
  onClose: () => void;
  onConfirm: (reasonId: number, note: string | null) => void;
  loading: boolean;
}) {
  const kind = target ? REASON_KIND_FOR_STATUS[target.status] : undefined;
  const reasons = useLookup(kind);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  if (!target) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={STATUS_LABELS[target.status]}
      width={460}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={!reasonId}
            onClick={() => onConfirm(Number(reasonId), note.trim() || null)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-12">
        <Field label="Reason">
          <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">Pick a reason…</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the team should know"
          />
        </Field>
      </div>
    </Modal>
  );
}

function CandidateFacts({ a }: { a: ApplicationDetail }) {
  const c = a.candidate;
  return (
    <Section
      title="Candidate"
      action={
        <Link to={`/candidates/${c.id}`} className="text-10 text-forest-2 hover:underline">
          Full profile
        </Link>
      }
    >
      <KeyValue
        items={[
          [
            'Phone',
            c.phone ? (
              <a className="link" href={`tel:${c.phone}`}>
                {c.phone}
              </a>
            ) : (
              '—'
            ),
          ],
          [
            'Email',
            c.email ? (
              <a className="link" href={`mailto:${c.email}`}>
                {c.email}
              </a>
            ) : (
              '—'
            ),
          ],
          ['Current', [c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || '—'],
          ['Experience', c.totalExp != null ? `${c.totalExp} yrs` : '—'],
          ['CTC', `${formatLpa(c.currentCtc)} → ${formatLpa(c.expectedCtc)}`],
          [
            'Budget',
            a.requirement.budgetMax
              ? `${formatLpa(a.requirement.budgetMin)} – ${formatLpa(a.requirement.budgetMax)}`
              : '—',
          ],
          ['Notice', c.noticeDays != null ? `${c.noticeDays} days` : '—'],
          [
            'Resume',
            a.resumes[0] ? (
              <ResumeLink resume={a.resumes[0]} />
            ) : (
              <span className="text-ink-3">None uploaded</span>
            ),
          ],
        ]}
      />
    </Section>
  );
}

function ScreeningSection({ a }: { a: ApplicationDetail }) {
  const s = a.screening;
  const [editing, setEditing] = useState(!s && a.canWork);
  const [form, setForm] = useState(() => ({
    interested: s?.interested ?? true,
    currentCtc: toLakhs(s?.currentCtc ?? a.candidate.currentCtc),
    expectedCtc: toLakhs(s?.expectedCtc ?? a.candidate.expectedCtc),
    noticeDays: String(s?.noticeDays ?? a.candidate.noticeDays ?? ''),
    noticeNegotiable: s?.noticeNegotiable ?? false,
    currentLocation: s?.currentLocation ?? a.candidate.location ?? '',
    willingToRelocate: s?.willingToRelocate ?? false,
    skillRating: String(s?.skillRating ?? ''),
    remarks: s?.remarks ?? '',
  }));
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const save = useAppMutation(
    a,
    () =>
      api.put(`/applications/${a.id}/screening`, {
        version: a.version,
        interested: form.interested,
        currentCtc: fromLakhs(form.currentCtc),
        expectedCtc: fromLakhs(form.expectedCtc),
        noticeDays: form.noticeDays === '' ? null : Number(form.noticeDays),
        noticeNegotiable: form.noticeNegotiable,
        currentLocation: form.currentLocation,
        willingToRelocate: form.willingToRelocate,
        skillRating: form.skillRating ? Number(form.skillRating) : null,
        remarks: form.remarks,
      }),
    'Screening saved',
  );
  if (!editing && s) {
    return (
      <Section
        title="Screening card"
        action={
          a.canWork && (
            <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        <KeyValue
          items={[
            ['Interested', s.interested ? 'Yes' : 'No'],
            ['Current → expected', `${formatLpa(s.currentCtc)} → ${formatLpa(s.expectedCtc)}`],
            [
              'Notice period',
              s.noticeDays != null
                ? `${s.noticeDays} days${s.noticeNegotiable ? ' (negotiable)' : ''}`
                : '—',
            ],
            [
              'Location',
              `${s.currentLocation || '—'}${s.willingToRelocate ? ' · willing to relocate' : ''}`,
            ],
            ['Skill rating', s.skillRating ? `${s.skillRating} / 5` : '—'],
            ['Remarks', s.remarks || '—'],
            ['Screened by', `${a.screenedByName ?? '—'} · ${fmtDate(a.screenedAt)}`],
          ]}
        />
      </Section>
    );
  }
  if (!a.canWork) return null;
  return (
    <Section title="Screening card" action={<Pill tone="warn">Required before submission</Pill>}>
      <div className="grid grid-cols-2 gap-10">
        <div className="col-span-2 flex flex-wrap gap-16">
          <Checkbox
            label="Interested in this role"
            checked={form.interested}
            onChange={(v) => set('interested', v)}
          />
        </div>
        <Field label="Current CTC (lakhs p.a.)">
          <Input
            inputMode="decimal"
            value={form.currentCtc}
            onChange={(e) => set('currentCtc', e.target.value)}
          />
        </Field>
        <Field label="Expected CTC (lakhs p.a.)">
          <Input
            inputMode="decimal"
            value={form.expectedCtc}
            onChange={(e) => set('expectedCtc', e.target.value)}
          />
        </Field>
        <Field label="Notice period (days)">
          <Input
            inputMode="numeric"
            value={form.noticeDays}
            onChange={(e) => set('noticeDays', e.target.value)}
          />
        </Field>
        <div className="flex items-end pb-6">
          <Checkbox
            label="Notice negotiable"
            checked={form.noticeNegotiable}
            onChange={(v) => set('noticeNegotiable', v)}
          />
        </div>
        <Field label="Current location">
          <Input
            value={form.currentLocation}
            onChange={(e) => set('currentLocation', e.target.value)}
          />
        </Field>
        <div className="flex items-end pb-6">
          <Checkbox
            label="Willing to relocate"
            checked={form.willingToRelocate}
            onChange={(v) => set('willingToRelocate', v)}
          />
        </div>
        <Field label="Skill rating (1–5)">
          <Select value={form.skillRating} onChange={(e) => set('skillRating', e.target.value)}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Remarks for the client" className="col-span-2">
          <Textarea
            value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
            placeholder="Strengths, gaps, availability for interviews…"
          />
        </Field>
      </div>
      <div className="mt-12 flex justify-end gap-8">
        {s && (
          <Button variant="quiet" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}
        >
          Save screening
        </Button>
      </div>
    </Section>
  );
}

function SubmitDialog({ a, onClose }: { a: ApplicationDetail; onClose: () => void }) {
  const [when, setWhen] = useState(dateTimeInput(new Date()));
  const [channel, setChannel] = useState<SubmissionChannel>('email');
  const [resumeId, setResumeId] = useState(String(a.resumes[0]?.id ?? ''));
  const [note, setNote] = useState('');
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const submit = useAppMutation(
    a,
    (ack: boolean) =>
      api.post(`/applications/${a.id}/submit`, {
        version: a.version,
        submittedAt: new Date(when).toISOString(),
        channel,
        resumeId: resumeId ? Number(resumeId) : null,
        note: note || null,
        acknowledgeClientDuplicate: ack,
      }),
    'Submission logged — feedback reminder scheduled',
  );
  const go = (ack: boolean) =>
    submit.mutate(ack, {
      onSuccess: onClose,
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'CLIENT_DUPLICATE') setDupWarning(e.message);
      },
    });
  return (
    <Modal
      open
      onClose={onClose}
      title="Mark profile as submitted"
      width={480}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          {dupWarning ? (
            <Button variant="danger" loading={submit.isPending} onClick={() => go(true)}>
              Submit anyway
            </Button>
          ) : (
            <Button variant="primary" loading={submit.isPending} onClick={() => go(false)}>
              Log submission
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-12">
        <p className="text-10 text-ink-2">
          Send the profile to {a.requirement.clientName} from your email or WhatsApp as usual, then
          log it here. The CRM will remind you to chase feedback.
        </p>
        {dupWarning && (
          <p className="flex gap-8 rounded-md bg-brass-soft px-12 py-8 text-10 text-brass-text">
            <AlertTriangle className="mt-[1px] size-14 shrink-0" strokeWidth={1.8} /> {dupWarning}
          </p>
        )}
        <div className="grid grid-cols-2 gap-10">
          <Field label="Sent on">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Channel">
            <Select
              value={channel}
              onChange={(e) => setChannel(e.target.value as SubmissionChannel)}
            >
              {SUBMISSION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c === 'whatsapp' ? 'WhatsApp' : c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Resume sent"
          hint={a.resumes.length ? undefined : 'No resume uploaded for this candidate yet'}
        >
          <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            {!a.resumes.length && <option value="">—</option>}
            {a.resumes.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.versionNo} · {r.fileName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function SubmissionSection({ a }: { a: ApplicationDetail }) {
  const resume = a.resumes.find((r) => r.id === a.resumeId);
  return (
    <Section title="Submission">
      <KeyValue
        items={[
          ['Submitted', `${fmtDateTime(a.submittedAt)} by ${a.submittedByName ?? '—'}`],
          [
            'Channel',
            a.submissionChannel === 'whatsapp' ? 'WhatsApp' : (a.submissionChannel ?? '—'),
          ],
          ['Resume sent', resume ? <ResumeLink resume={resume} /> : '—'],
          [
            'Client responded',
            a.feedbackAt ? (
              fmtDateTime(a.feedbackAt)
            ) : (
              <span className="text-brass-text">Awaiting feedback</span>
            ),
          ],
          ...(a.submissionNote ? ([['Note', a.submissionNote]] as [ReactNode, ReactNode][]) : []),
        ]}
      />
    </Section>
  );
}

function InterviewsSection({ a }: { a: ApplicationDetail }) {
  const [edit, setEdit] = useState<Interview | null>(null);
  const { data: settings } = useSettings();
  const grace = (settings?.interviewOutcomeGraceHours ?? 2) * 3_600_000;
  return (
    <Section title="Interviews">
      {!a.interviews.length && (
        <p className="text-10 text-ink-3">
          No rounds logged yet. Coordinate with the client and candidate, then log the round here.
        </p>
      )}
      <ul className="space-y-8">
        {a.interviews.map((i) => {
          const overdue =
            INTERVIEW_AWAITING_OUTCOME.includes(i.status) &&
            new Date(i.scheduledAt).getTime() + grace < Date.now();
          return (
            <li
              key={i.id}
              className={clsx(
                'rounded-md p-10 ring-1',
                overdue ? 'bg-coral-soft/50 ring-coral/30' : 'ring-ink/[0.08]',
              )}
            >
              <div className="flex items-start gap-8">
                <div className="min-w-0 flex-1">
                  <p className="text-11 font-medium">
                    Round {i.roundNo}
                    {i.label ? ` · ${i.label}` : ''}{' '}
                    <span className="font-normal text-ink-3">
                      · {INTERVIEW_MODE_LABELS[i.mode]}
                    </span>
                  </p>
                  <p className="text-10 text-ink-2">
                    {fmtDateTime(i.scheduledAt)}
                    {i.panel ? ` · ${i.panel}` : ''}
                    {i.coordinatorName ? ` · coordinated by ${i.coordinatorName}` : ''}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-6">
                    <Pill
                      tone={
                        i.status === 'completed'
                          ? 'good'
                          : ['cancelled', 'candidate_no_show', 'panel_no_show'].includes(i.status)
                            ? 'bad'
                            : 'warn'
                      }
                    >
                      {INTERVIEW_STATUS_LABELS[i.status]}
                    </Pill>
                    {overdue && <Pill tone="bad">Outcome overdue</Pill>}
                    <Pill tone={i.candidateConfirmed ? 'good' : 'neutral'}>
                      {i.candidateConfirmed ? <Check className="size-12" /> : null}Candidate{' '}
                      {i.candidateConfirmed ? 'confirmed' : 'not confirmed'}
                    </Pill>
                    <Pill tone={i.panelConfirmed ? 'good' : 'neutral'}>
                      {i.panelConfirmed ? <Check className="size-12" /> : null}Panel{' '}
                      {i.panelConfirmed ? 'confirmed' : 'not confirmed'}
                    </Pill>
                  </div>
                  {i.feedback && <p className="mt-6 text-10 text-ink-2">“{i.feedback}”</p>}
                </div>
                {a.canWork && (
                  <Button size="sm" variant="quiet" onClick={() => setEdit(i)}>
                    Update
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {edit && <InterviewDialog a={a} interview={edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function InterviewDialog({
  a,
  interview,
  onClose,
}: {
  a: ApplicationDetail;
  interview?: Interview;
  onClose: () => void;
}) {
  const me = useMe();
  const { data: users } = useUsers();
  const [f, setF] = useState(() => ({
    label: interview?.label ?? (a.interviews.length ? '' : 'Technical'),
    mode: (interview?.mode ?? 'video') as InterviewMode,
    scheduledAt: dateTimeInput(interview?.scheduledAt ?? null),
    durationMins: String(interview?.durationMins ?? 60),
    panel: interview?.panel ?? '',
    location: interview?.location ?? '',
    coordinatorId: String(interview?.coordinatorId ?? me.id),
    candidateConfirmed: interview?.candidateConfirmed ?? false,
    panelConfirmed: interview?.panelConfirmed ?? false,
    status: (interview?.status ?? 'scheduled') as InterviewStatus,
    feedback: interview?.feedback ?? '',
    notes: interview?.notes ?? '',
  }));
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = useAppMutation(
    a,
    () => {
      const body = {
        label: f.label || null,
        mode: f.mode,
        scheduledAt: new Date(f.scheduledAt).toISOString(),
        durationMins: Number(f.durationMins) || 60,
        panel: f.panel || null,
        location: f.location || null,
        coordinatorId: Number(f.coordinatorId),
        candidateConfirmed: f.candidateConfirmed,
        panelConfirmed: f.panelConfirmed,
        notes: f.notes || null,
      };
      return interview
        ? api.patch(`/interviews/${interview.id}`, {
            ...body,
            version: interview.version,
            status: f.status,
            feedback: f.feedback || null,
          })
        : api.post(`/applications/${a.id}/interviews`, body);
    },
    interview ? 'Interview updated' : 'Interview logged',
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={interview ? `Round ${interview.roundNo}` : `Log round ${a.interviews.length + 1}`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!f.scheduledAt}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-10">
        <Field label="Round name">
          <Input
            value={f.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Technical, Managerial, HR…"
          />
        </Field>
        <Field label="Mode">
          <Select value={f.mode} onChange={(e) => set('mode', e.target.value)}>
            {INTERVIEW_MODES.map((m) => (
              <option key={m} value={m}>
                {INTERVIEW_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date & time">
          <Input
            type="datetime-local"
            value={f.scheduledAt}
            onChange={(e) => set('scheduledAt', e.target.value)}
          />
        </Field>
        <Field label="Duration (mins)">
          <Input
            inputMode="numeric"
            value={f.durationMins}
            onChange={(e) => set('durationMins', e.target.value)}
          />
        </Field>
        <Field label="Panel">
          <Input
            value={f.panel}
            onChange={(e) => set('panel', e.target.value)}
            placeholder="Interviewer names"
          />
        </Field>
        <Field label="Coordinator">
          <Select value={f.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)}>
            {users
              ?.filter((u) => u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Venue or meeting link" className="col-span-2">
          <Input value={f.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <div className="col-span-2 flex flex-wrap gap-16">
          <Checkbox
            label="Candidate confirmed"
            checked={f.candidateConfirmed}
            onChange={(v) => set('candidateConfirmed', v)}
          />
          <Checkbox
            label="Panel confirmed"
            checked={f.panelConfirmed}
            onChange={(v) => set('panelConfirmed', v)}
          />
        </div>
        {interview && (
          <>
            <Field label="Status" className="col-span-2">
              <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                {INTERVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {INTERVIEW_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client feedback" className="col-span-2">
              <Textarea value={f.feedback} onChange={(e) => set('feedback', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Notes" className="col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {interview?.status !== f.status &&
        f.status === 'completed' &&
        a.status === 'interviewing' && (
          <p className="mt-10 text-9 text-ink-3">
            The candidate will move to “Feedback pending” until you record the client's decision.
          </p>
        )}
    </Modal>
  );
}

function OfferSection({ a }: { a: ApplicationDetail }) {
  const o = a.offer;
  const [editing, setEditing] = useState(!o && a.canWork);
  const [f, setF] = useState(() => ({
    offeredCtc: toLakhs(o?.offeredCtc),
    offerDate: o?.offerDate ?? '',
    expectedDoj: o?.expectedDoj ?? '',
    actualDoj: o?.actualDoj ?? '',
    designation: o?.designation ?? '',
    notes: o?.notes ?? '',
  }));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useAppMutation(
    a,
    () =>
      api.put(`/applications/${a.id}/offer`, {
        offeredCtc: fromLakhs(f.offeredCtc),
        offerDate: f.offerDate || null,
        expectedDoj: f.expectedDoj || null,
        actualDoj: f.actualDoj || null,
        designation: f.designation || null,
        notes: f.notes || null,
      }),
    'Offer saved',
  );
  if (!editing && o) {
    return (
      <Section
        title="Offer"
        action={
          a.canWork && (
            <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        <KeyValue
          items={[
            ['Offered CTC', formatLpa(o.offeredCtc)],
            ['Designation', o.designation ?? '—'],
            ['Offer date', fmtDate(o.offerDate)],
            ['Expected joining', fmtDate(o.expectedDoj)],
            ['Actual joining', fmtDate(o.actualDoj)],
            ...(o.notes ? ([['Notes', o.notes]] as [ReactNode, ReactNode][]) : []),
          ]}
        />
      </Section>
    );
  }
  if (!a.canWork) return null;
  return (
    <Section title="Offer & salary discussion">
      <div className="grid grid-cols-2 gap-10">
        <Field label="Offered CTC (lakhs p.a.)">
          <Input
            inputMode="decimal"
            value={f.offeredCtc}
            onChange={(e) => set('offeredCtc', e.target.value)}
          />
        </Field>
        <Field label="Designation">
          <Input value={f.designation} onChange={(e) => set('designation', e.target.value)} />
        </Field>
        <Field label="Offer date">
          <Input
            type="date"
            value={f.offerDate}
            onChange={(e) => set('offerDate', e.target.value)}
          />
        </Field>
        <Field label="Expected joining date">
          <Input
            type="date"
            value={f.expectedDoj}
            onChange={(e) => set('expectedDoj', e.target.value)}
          />
        </Field>
        {a.stage === 'joining' && (
          <Field label="Actual joining date">
            <Input
              type="date"
              value={f.actualDoj}
              onChange={(e) => set('actualDoj', e.target.value)}
            />
          </Field>
        )}
        <Field label="Notes" className="col-span-2">
          <Textarea
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Negotiation history, counter-offers…"
          />
        </Field>
      </div>
      <div className="mt-12 flex justify-end gap-8">
        {o && (
          <Button variant="quiet" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}
        >
          Save offer
        </Button>
      </div>
    </Section>
  );
}

function RiskSection({ a }: { a: ApplicationDetail }) {
  const [risk, setRisk] = useState<JoiningRisk | ''>(a.joiningRisk ?? '');
  const [note, setNote] = useState(a.joiningRiskNote ?? '');
  const save = useAppMutation(
    a,
    () =>
      api.post(`/applications/${a.id}/risk`, {
        version: a.version,
        risk: risk || null,
        note: note || null,
      }),
    'Joining risk updated',
  );
  if (!a.canWork) return null;
  return (
    <Section
      title="Joining risk"
      action={<span className="text-9 text-ink-3">Shown on the dashboard</span>}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-10">
        <Select value={risk} onChange={(e) => setRisk(e.target.value as JoiningRisk | '')}>
          <option value="">No risk</option>
          {JOINING_RISKS.map((r) => (
            <option key={r} value={r}>
              {JOINING_RISK_LABELS[r]}
            </option>
          ))}
        </Select>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did the candidate say?"
        />
      </div>
      <div className="mt-10 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          loading={save.isPending}
          disabled={risk === (a.joiningRisk ?? '') && note === (a.joiningRiskNote ?? '')}
          onClick={() => save.mutate(undefined)}
        >
          Save
        </Button>
      </div>
    </Section>
  );
}

function PlacementSection({ a }: { a: ApplicationDetail }) {
  const me = useMe();
  const p = a.placement!;
  const [f, setF] = useState(() => ({
    feeAmount: String(p.feeAmount ?? ''),
    invoiceStatus: (p.invoiceStatus ?? 'to_raise') as InvoiceStatus,
    invoiceNo: p.invoiceNo ?? '',
    invoiceDate: p.invoiceDate ?? '',
    paidOn: p.paidOn ?? '',
    leftOn: p.leftOn ?? '',
  }));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useAppMutation(
    a,
    () =>
      api.patch(`/placements/${p.id}`, {
        version: p.version,
        feeAmount: f.feeAmount === '' ? null : Number(f.feeAmount),
        invoiceStatus: f.invoiceStatus,
        invoiceNo: f.invoiceNo || null,
        invoiceDate: f.invoiceDate || null,
        paidOn: f.paidOn || null,
        leftOn: f.leftOn || null,
      }),
    'Placement updated',
  );
  if (!canSeeFees(me.role)) {
    return (
      <Section title="Placement">
        <KeyValue
          items={[
            ['Joined on', fmtDate(p.joinedOn)],
            ['Replacement guarantee until', fmtDate(p.guaranteeUntil)],
          ]}
        />
      </Section>
    );
  }
  return (
    <Section
      title="Placement & invoice"
      action={
        <span className="text-9 text-ink-3">Guarantee until {fmtDate(p.guaranteeUntil)}</span>
      }
    >
      <div className="grid grid-cols-2 gap-10">
        <Field label="Joined on">
          <Input value={fmtDate(p.joinedOn)} disabled />
        </Field>
        <Field label="Fee (₹)" hint={p.feeAmount != null ? formatInr(p.feeAmount) : undefined}>
          <Input
            inputMode="numeric"
            value={f.feeAmount}
            onChange={(e) => set('feeAmount', e.target.value)}
          />
        </Field>
        <Field label="Invoice status">
          <Select value={f.invoiceStatus} onChange={(e) => set('invoiceStatus', e.target.value)}>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice number">
          <Input value={f.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} />
        </Field>
        <Field label="Invoice date">
          <Input
            type="date"
            value={f.invoiceDate}
            onChange={(e) => set('invoiceDate', e.target.value)}
          />
        </Field>
        <Field label="Paid on">
          <Input type="date" value={f.paidOn} onChange={(e) => set('paidOn', e.target.value)} />
        </Field>
        <Field
          label="Candidate left on"
          hint="Within the guarantee period, a replacement is due"
          className="col-span-2"
        >
          <Input type="date" value={f.leftOn} onChange={(e) => set('leftOn', e.target.value)} />
        </Field>
      </div>
      <div className="mt-12 flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </div>
    </Section>
  );
}

function NotesSection({ a }: { a: ApplicationDetail }) {
  const [body, setBody] = useState('');
  const add = useAppMutation(a, () =>
    api.post(`/candidates/${a.candidateId}/notes`, { body, applicationId: a.id }),
  );
  return (
    <Section title="Notes" action={<FileText className="size-14 text-ink-3" strokeWidth={1.8} />}>
      <div className="flex gap-8">
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note for the team"
          onKeyDown={(e) =>
            e.key === 'Enter' &&
            body.trim() &&
            add.mutate(undefined, { onSuccess: () => setBody('') })
          }
        />
        <Button
          disabled={!body.trim()}
          loading={add.isPending}
          onClick={() => add.mutate(undefined, { onSuccess: () => setBody('') })}
        >
          Add
        </Button>
      </div>
      {a.notes.length > 0 && (
        <ul className="mt-10 space-y-8">
          {a.notes.map((n) => (
            <li key={n.id} className="text-10">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="text-9 text-ink-3">
                {n.authorName} · {fmtDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
