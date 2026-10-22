import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlarmClock,
  Bell,
  Briefcase,
  CalendarClock,
  Check,
  ClipboardCheck,
  Phone,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { isManager, type TaskRule } from '@crm/shared';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { useUsers } from '../lib/queries';
import { dateTimeInput, fmtDateTime } from '../lib/format';
import type { Task } from '../lib/types';
import {
  Button,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Tabs,
  Textarea,
} from '../components/ui';
import { useToast } from '../components/toast';
import { useAppDrawer } from '../features/ApplicationDrawer';

const RULE_STYLE: Record<TaskRule, { icon: typeof Bell; cls: string; label: string }> = {
  manual: { icon: ClipboardCheck, cls: 'bg-paper-2 text-ink-2', label: 'Task' },
  assignment: { icon: Briefcase, cls: 'bg-cobalt-soft text-cobalt', label: 'New assignment' },
  chase_feedback: {
    icon: AlarmClock,
    cls: 'bg-marigold-soft text-[#7a5200]',
    label: 'Chase feedback',
  },
  escalate_feedback: {
    icon: AlarmClock,
    cls: 'bg-coral-soft text-coral-2',
    label: 'Feedback overdue',
  },
  interview_outcome: {
    icon: CalendarClock,
    cls: 'bg-coral-soft text-coral-2',
    label: 'Interview outcome',
  },
  notice_checkin: { icon: Phone, cls: 'bg-mint-soft text-forest', label: 'Notice check-in' },
  confirm_joining: { icon: Check, cls: 'bg-mint-soft text-forest', label: 'Confirm joining' },
  guarantee_expiry: { icon: ShieldCheck, cls: 'bg-lilac-soft text-[#5b45a8]', label: 'Guarantee' },
};

export function TaskRow({
  task,
  compact,
  onChange,
}: {
  task: Task;
  compact?: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const drawer = useAppDrawer();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.patch(`/tasks/${task.id}`, { done: !task.doneAt }),
    onSuccess: () => {
      onChange();
      void qc.invalidateQueries({ queryKey: ['counts'] });
      if (!task.doneAt) toast('Done');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const style = RULE_STYLE[task.rule];
  const Icon = style.icon;
  const overdue = !task.doneAt && new Date(task.dueAt) < new Date();
  return (
    <li
      className={clsx(
        'flex items-center gap-10 rounded-md bg-surface ring-1 ring-ink/[0.08]',
        compact ? 'px-10 py-7' : 'px-12 py-9',
      )}
    >
      <button
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
        title={task.doneAt ? 'Reopen' : 'Mark done'}
        className={clsx(
          'grid size-18 shrink-0 place-items-center rounded-sm ring-1 transition',
          task.doneAt ? 'bg-forest text-mint ring-forest' : 'ring-ink/20 hover:bg-mint-soft',
        )}
      >
        {task.doneAt && <Check className="size-12" strokeWidth={2.4} />}
      </button>
      <span
        className={clsx('grid size-24 shrink-0 place-items-center rounded-md', style.cls)}
        title={style.label}
      >
        <Icon className="size-12" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p
          className={clsx(
            'text-10 font-medium',
            task.doneAt && 'text-ink-3 line-through',
            compact ? 'line-clamp-2' : '',
          )}
        >
          {task.title}
        </p>
        {!compact && (
          <p className="mt-2 flex flex-wrap gap-x-8 text-9 text-ink-3">
            {task.candidateId && (
              <Link className="hover:underline" to={`/candidates/${task.candidateId}`}>
                {task.candidateName}
              </Link>
            )}
            {task.requirementId && (
              <Link className="hover:underline" to={`/requirements/${task.requirementId}`}>
                {task.requirementTitle}
              </Link>
            )}
            {task.notes && <span>{task.notes}</span>}
            {task.autoClosed && <span>closed automatically</span>}
          </p>
        )}
      </div>
      {task.applicationId && (
        <Button size="sm" variant="quiet" onClick={() => drawer.open(task.applicationId!)}>
          Open
        </Button>
      )}
      <span
        className={clsx(
          'shrink-0 text-right text-9 tnum leading-tight',
          overdue ? 'font-medium text-signal-red' : 'text-ink-3',
        )}
      >
        {overdue && <span className="block">Overdue</span>}
        {fmtDateTime(task.dueAt)}
      </span>
    </li>
  );
}

export function TasksPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [assigneeId, setAssigneeId] = useState('');
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const { data: users } = useUsers();
  const qc = useQueryClient();
  useEffect(() => {
    if (params.get('new') === '1') {
      setNewOpen(true);
      setParams((p) => {
        p.delete('new');
        return p;
      });
    }
  }, [params, setParams]);
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', tab, scope, assigneeId],
    queryFn: () =>
      api.get<Task[]>(
        `/tasks?status=${tab}&scope=${scope}${assigneeId ? `&assigneeId=${assigneeId}` : ''}`,
      ),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tasks'] });
  const groups = groupTasks(data ?? [], tab);

  return (
    <>
      <PageHeader
        title={scope === 'mine' ? 'My tasks' : 'Team tasks'}
        subtitle="Follow-ups you add, plus reminders the CRM creates from the pipeline"
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-14" strokeWidth={1.8} />}
            onClick={() => setNewOpen(true)}
          >
            New task
          </Button>
        }
      />
      <div className="mb-14 flex flex-wrap items-center gap-10">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'open', label: 'To do' },
            { value: 'done', label: 'Done' },
          ]}
        />
        {isManager(me.role) && (
          <>
            <Tabs
              value={scope}
              onChange={setScope}
              items={[
                { value: 'mine', label: 'Mine' },
                { value: 'all', label: 'Everyone' },
              ]}
            />
            {scope === 'all' && (
              <Select
                className="w-[200px]"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">All recruiters</option>
                {users?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty
          icon={<Check className="size-18" />}
          title={tab === 'open' ? 'Nothing to do' : 'No completed tasks yet'}
        >
          Reminders appear here when feedback is pending, interviews need an outcome, or selected
          candidates are serving notice.
        </Empty>
      ) : (
        <div className="space-y-18">
          {groups.map(([label, items]) => (
            <section key={label}>
              <h2
                className={clsx(
                  'mb-8 text-10 font-semibold uppercase tracking-[0.06em]',
                  label === 'Overdue' ? 'text-signal-red' : 'text-ink-3',
                )}
              >
                {label} <span className="tnum font-normal">· {items.length}</span>
              </h2>
              <ul className="space-y-6">
                {items.map((t) => (
                  <TaskRow key={t.id} task={t} onChange={refresh} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {newOpen && <NewTaskDialog onClose={() => setNewOpen(false)} onSaved={refresh} />}
    </>
  );
}

function groupTasks(tasks: Task[], tab: 'open' | 'done'): [string, Task[]][] {
  if (tab === 'done') return [['Completed', tasks]];
  const now = new Date();
  const eod = new Date();
  eod.setHours(23, 59, 59, 999);
  const eow = new Date(eod.getTime() + 6 * 86_400_000);
  const g: Record<string, Task[]> = { Overdue: [], Today: [], 'This week': [], Later: [] };
  for (const t of tasks) {
    const d = new Date(t.dueAt);
    if (d < now) g.Overdue.push(t);
    else if (d <= eod) g.Today.push(t);
    else if (d <= eow) g['This week'].push(t);
    else g.Later.push(t);
  }
  return Object.entries(g).filter(([, v]) => v.length);
}

export function NewTaskDialog({
  onClose,
  onSaved,
  defaults,
}: {
  onClose: () => void;
  onSaved?: () => void;
  defaults?: {
    candidateId?: number;
    requirementId?: number;
    applicationId?: number;
    title?: string;
  };
}) {
  const me = useMe();
  const { data: users } = useUsers();
  const toast = useToast();
  const qc = useQueryClient();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [dueAt, setDueAt] = useState(dateTimeInput(tomorrow));
  const [assigneeId, setAssigneeId] = useState(String(me.id));
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title,
        dueAt: new Date(dueAt).toISOString(),
        assigneeId: Number(assigneeId),
        notes: notes || null,
        candidateId: defaults?.candidateId ?? null,
        requirementId: defaults?.requirementId ?? null,
        applicationId: defaults?.applicationId ?? null,
      }),
    onSuccess: () => {
      toast('Task added');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['counts'] });
      onSaved?.();
      onClose();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      width={460}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={title.trim().length < 2 || !dueAt}
            onClick={() => save.mutate()}
          >
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-12">
        <Field label="What needs doing?">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Call Amit about notice period buyout"
          />
        </Field>
        <div className="grid grid-cols-2 gap-10">
          <Field label="Due">
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Assign to">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {users
                ?.filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
