import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { LOOKUP_KIND_LABELS, LOOKUP_KINDS, ROLES, type LookupKind, type Role, type Settings } from '@crm/shared';
import { api } from '../lib/api';
import { useLookups, useSettings } from '../lib/queries';
import { ago } from '../lib/format';
import type { User } from '../lib/types';
import { Avatar, Button, Card, Checkbox, Field, Input, Loading, Modal, PageHeader, Pill, Select, Table, Tabs, Td, Th } from '../components/ui';
import { useToast } from '../components/toast';

export function SettingsPage() {
  const [tab, setTab] = useState<'users' | 'options' | 'automation'>('users');
  return (
    <>
      <PageHeader title="Settings" subtitle="Admin only" />
      <div className="mb-14">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'users', label: 'Users & roles' },
            { value: 'options', label: 'Sources & reasons' },
            { value: 'automation', label: 'Reminders & defaults' },
          ]}
        />
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'options' && <OptionsTab />}
      {tab === 'automation' && <AutomationTab />}
    </>
  );
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, plus users and settings',
  manager: 'All records, assignment, deletes, fees, reports for the team',
  recruiter: 'Works on requirements they own or are assigned to; no fees or deletes',
};

function UsersTab() {
  const { data, isLoading } = useQuery({ queryKey: ['users', 'admin'], queryFn: () => api.get<User[]>('/users') });
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  if (isLoading) return <Loading />;
  return (
    <>
      <div className="mb-10 flex justify-end">
        <Button variant="primary" icon={<Plus className="size-14" />} onClick={() => setEdit('new')}>Add user</Button>
      </div>
      <Table>
        <thead>
          <tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th /></tr>
        </thead>
        <tbody>
          {data?.map((u) => (
            <tr key={u.id}>
              <Td><span className="flex items-center gap-8"><Avatar name={u.name} size={24} />{u.name}</span></Td>
              <Td className="text-ink-2">{u.email}</Td>
              <Td><Pill tone={u.role === 'admin' ? 'dark' : u.role === 'manager' ? 'info' : 'neutral'}>{u.role}</Pill></Td>
              <Td>{u.active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Deactivated</Pill>}</Td>
              <Td className="text-10 text-ink-3">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</Td>
              <Td className="text-right"><Button size="sm" variant="quiet" onClick={() => setEdit(u)}>Edit</Button></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-12 grid gap-6 text-10 text-ink-3">
        {ROLES.map((r) => <p key={r}><b className="capitalize text-ink-2">{r}:</b> {ROLE_HELP[r]}</p>)}
      </div>
      {edit && <UserDialog user={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function UserDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: (user?.role ?? 'recruiter') as Role, password: '', active: user?.active ?? true });
  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { name: f.name, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) })
        : api.post('/users', { name: f.name, email: f.email, role: f.role, password: f.password }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast(user ? 'User updated' : 'User added — share the password with them securely');
      onClose();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Edit ${user.name}` : 'Add user'}
      width={460}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={f.name.length < 2 || (!user && (!f.email || f.password.length < 10))} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="space-y-12">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work email"><Input type="email" value={f.email} disabled={!!user} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label={user ? 'Reset password (optional)' : 'Initial password'} hint="At least 10 characters. Changing it signs the user out everywhere.">
          <Input type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        {user && <Checkbox label="Active (can sign in)" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      </div>
    </Modal>
  );
}

function OptionsTab() {
  const { data } = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<LookupKind>('source');
  const [label, setLabel] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['lookups'] });
  const add = useMutation({
    mutationFn: () => api.post('/lookups', { kind, label, sort: (data ?? []).filter((l) => l.kind === kind).length }),
    onSuccess: () => {
      setLabel('');
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: number; active: boolean }) => api.patch(`/lookups/${id}`, { active }), onSuccess: refresh });
  const items = (data ?? []).filter((l) => l.kind === kind);
  return (
    <div className="grid gap-12 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-2">
        {LOOKUP_KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`block w-full rounded-full px-12 py-7 text-left text-11 ${kind === k ? 'bg-forest text-mint' : 'text-ink-2 hover:bg-paper-2'}`}>
            {LOOKUP_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <Card title={LOOKUP_KIND_LABELS[kind]} action={<span className="text-9 text-ink-3">Deactivated options stay on old records</span>}>
        <ul className="space-y-6">
          {items.map((l) => (
            <li key={l.id} className="flex items-center gap-8 text-11">
              <span className={l.active ? '' : 'text-ink-3 line-through'}>{l.label}</span>
              <Button size="sm" variant="quiet" className="ml-auto" onClick={() => toggle.mutate({ id: l.id, active: !l.active })}>{l.active ? 'Deactivate' : 'Activate'}</Button>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex gap-8">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New option" onKeyDown={(e) => e.key === 'Enter' && label.trim() && add.mutate()} />
          <Button disabled={!label.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      </Card>
    </div>
  );
}

const RULES: { key: keyof Settings['rules']; label: string; help: string }[] = [
  { key: 'chase_feedback', label: 'Chase client feedback', help: 'Task for the submitter after the client’s “chase after N working days” setting' },
  { key: 'escalate_feedback', label: 'Escalate missing feedback', help: 'Task for the requirement owner when feedback is still pending' },
  { key: 'interview_outcome', label: 'Interview outcome overdue', help: 'Task for the coordinator when no outcome is logged after the interview' },
  { key: 'notice_checkin', label: 'Notice-period check-ins', help: 'Regular check-in tasks while a selected candidate serves notice' },
  { key: 'confirm_joining', label: 'Confirm joining', help: 'Task on the expected joining date' },
  { key: 'guarantee_expiry', label: 'Replacement guarantee ending', help: 'Task for the owner before the guarantee period ends' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AutomationTab() {
  const { data } = useSettings();
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put('/settings', s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Settings saved');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ created: number; closed: number }>('/automation/run'),
    onSuccess: (r) => toast(`Reminders checked: ${r.created} created, ${r.closed} closed`),
  });
  if (!s) return <Loading />;
  const num = (k: keyof Settings, v: string) => setS({ ...s, [k]: Number(v) });
  return (
    <div className="grid gap-12 xl:grid-cols-2">
      <Card title="Automatic reminders">
        <ul className="space-y-10">
          {RULES.map((r) => (
            <li key={r.key}>
              <Checkbox label={<span className="font-medium">{r.label}</span>} checked={s.rules[r.key]} onChange={(v) => setS({ ...s, rules: { ...s.rules, [r.key]: v } })} />
              <p className="ml-22 text-9 text-ink-3">{r.help}</p>
            </li>
          ))}
        </ul>
        <div className="mt-14">
          <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>Run checks now</Button>
        </div>
      </Card>
      <Card title="Timings">
        <div className="grid grid-cols-2 gap-10">
          <Field label="Escalate feedback after (working days)"><Input inputMode="numeric" value={s.feedbackEscalationDays} onChange={(e) => num('feedbackEscalationDays', e.target.value)} /></Field>
          <Field label="Interview outcome grace (hours)"><Input inputMode="numeric" value={s.interviewOutcomeGraceHours} onChange={(e) => num('interviewOutcomeGraceHours', e.target.value)} /></Field>
          <Field label="Notice check-in every (days)"><Input inputMode="numeric" value={s.noticeCheckinIntervalDays} onChange={(e) => num('noticeCheckinIntervalDays', e.target.value)} /></Field>
          <Field label="Daily check-ins in the last (days)"><Input inputMode="numeric" value={s.noticeDailyWindowDays} onChange={(e) => num('noticeDailyWindowDays', e.target.value)} /></Field>
          <Field label="Guarantee reminder (days before)"><Input inputMode="numeric" value={s.guaranteeReminderDays} onChange={(e) => num('guaranteeReminderDays', e.target.value)} /></Field>
          <Field label="Same-client duplicate warning (days)" hint="0 turns the warning off"><Input inputMode="numeric" value={s.clientDuplicateWindowDays} onChange={(e) => num('clientDuplicateWindowDays', e.target.value)} /></Field>
          <div className="col-span-2">
            <p className="label">Non-working days (skipped when counting working days)</p>
            <div className="flex flex-wrap gap-12">
              {DAYS.map((d, i) => (
                <Checkbox key={d} label={d} checked={s.offDays.includes(i)} onChange={(v) => setS({ ...s, offDays: v ? [...s.offDays, i] : s.offDays.filter((x) => x !== i) })} />
              ))}
            </div>
          </div>
        </div>
      </Card>
      <div className="xl:col-span-2 flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
      </div>
    </div>
  );
}
