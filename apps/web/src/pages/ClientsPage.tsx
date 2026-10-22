import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Mail, Pencil, Phone, Plus, Star, Trash2 } from 'lucide-react';
import { canSeeFees, REQUIREMENT_STATUS_LABELS, type FeeType, type RequirementStatus } from '@crm/shared';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { fmtDate } from '../lib/format';
import type { Client, Contact, TimelineItem } from '../lib/types';
import { Button, Card, Checkbox, Empty, Field, Input, KeyValue, Loading, Modal, PageHeader, Pill, Select, Table, Td, Textarea, Th, Timeline, ErrorNote } from '../components/ui';
import { useToast } from '../components/toast';
import { requirementTone } from './RequirementsPage';

export function ClientsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [active, setActive] = useState('true');
  const [newOpen, setNewOpen] = useState(false);
  const me = useMe();
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
    queryKey: ['clients', q, active],
    queryFn: () => api.get<Client[]>(`/clients?q=${encodeURIComponent(q)}&active=${active}`),
  });
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={data ? `${data.length} client${data.length === 1 ? '' : 's'}` : undefined}
        actions={
          <Button variant="primary" icon={<Plus className="size-14" strokeWidth={1.8} />} onClick={() => setNewOpen(true)}>
            New client
          </Button>
        }
      />
      <div className="mb-12 flex flex-wrap gap-8">
        <Input className="max-w-[320px]" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-[160px]" value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
          <option value="all">All</option>
        </Select>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty icon={<Building2 className="size-18" />} title="No clients yet">Add the companies you recruit for. Requirements are created under a client.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Industry</Th>
              <Th>City</Th>
              <Th className="text-right">Open requirements</Th>
              <Th className="text-right">Open positions</Th>
              {canSeeFees(me.role) && <Th>Fee</Th>}
              <Th>Guarantee</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-paper/60">
                <Td>
                  <Link to={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  {!c.active && <Pill className="ml-6">Inactive</Pill>}
                </Td>
                <Td className="text-ink-2">{c.industry ?? '—'}</Td>
                <Td className="text-ink-2">{c.city ?? '—'}</Td>
                <Td className="tnum text-right">{c.openRequirements}</Td>
                <Td className="tnum text-right">{c.openPositions}</Td>
                {canSeeFees(me.role) && <Td className="tnum">{feeLabel(c)}</Td>}
                <Td className="tnum text-ink-2">{c.replacementDays} days</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {newOpen && <ClientDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

const feeLabel = (c: Client) => (c.feeType === 'fixed' ? `₹${Number(c.feeValue).toLocaleString('en-IN')} fixed` : `${c.feeValue}% of CTC`);

function ClientDialog({ client, onClose }: { client?: Client; onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState(() => ({
    name: client?.name ?? '',
    industry: client?.industry ?? '',
    city: client?.city ?? '',
    website: client?.website ?? '',
    address: client?.address ?? '',
    gstin: client?.gstin ?? '',
    notes: client?.notes ?? '',
    feeType: (client?.feeType ?? 'percent') as FeeType,
    feeValue: String(client?.feeValue ?? 8.33),
    replacementDays: String(client?.replacementDays ?? 90),
    feedbackChaseDays: String(client?.feedbackChaseDays ?? 2),
    active: client?.active ?? true,
  }));
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name,
        industry: f.industry,
        city: f.city,
        website: f.website,
        address: f.address,
        gstin: f.gstin,
        notes: f.notes,
        replacementDays: Number(f.replacementDays),
        feedbackChaseDays: Number(f.feedbackChaseDays),
        active: f.active,
      };
      if (canSeeFees(me.role)) Object.assign(body, { feeType: f.feeType, feeValue: Number(f.feeValue) });
      return client ? api.patch<Client>(`/clients/${client.id}`, { ...body, version: client.version }) : api.post<Client>('/clients', body);
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['client'] });
      toast(client ? 'Client updated' : 'Client added');
      onClose();
      if (!client) navigate(`/clients/${c.id}`);
    },
    onError: (e) => {
      toast((e as Error).message, 'error');
      if (e instanceof ApiError && e.code === 'STALE') void qc.invalidateQueries({ queryKey: ['client'] });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={client ? 'Edit client' : 'New client'}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-10">
        <Field label="Company name" className="col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Industry"><Input value={f.industry} onChange={(e) => set('industry', e.target.value)} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Website"><Input value={f.website} onChange={(e) => set('website', e.target.value)} /></Field>
        <Field label="GSTIN"><Input value={f.gstin} onChange={(e) => set('gstin', e.target.value)} /></Field>
        <Field label="Address" className="col-span-2"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        {canSeeFees(me.role) && (
          <>
            <Field label="Fee type">
              <Select value={f.feeType} onChange={(e) => set('feeType', e.target.value)}>
                <option value="percent">% of annual CTC</option>
                <option value="fixed">Fixed amount (₹)</option>
              </Select>
            </Field>
            <Field label={f.feeType === 'percent' ? 'Fee %' : 'Fee (₹)'}><Input inputMode="decimal" value={f.feeValue} onChange={(e) => set('feeValue', e.target.value)} /></Field>
          </>
        )}
        <Field label="Replacement guarantee (days)"><Input inputMode="numeric" value={f.replacementDays} onChange={(e) => set('replacementDays', e.target.value)} /></Field>
        <Field label="Chase feedback after (working days)" hint="A reminder task is created for the recruiter"><Input inputMode="numeric" value={f.feedbackChaseDays} onChange={(e) => set('feedbackChaseDays', e.target.value)} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Agreement terms, preferences, process notes…" /></Field>
        {client && <Checkbox label="Active client" checked={f.active} onChange={(v) => set('active', v)} />}
      </div>
    </Modal>
  );
}

interface ClientDetail extends Client {
  contacts: Contact[];
  requirements: { id: number; code: string; title: string; status: RequirementStatus; openings: number; filled: number; active: number; ownerName: string; createdAt: string }[];
  timeline: TimelineItem[];
}

export function ClientDetailPage() {
  const id = Number(useParams().id);
  const me = useMe();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const [edit, setEdit] = useState(false);
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  if (isLoading) return <Loading />;
  if (error || !c) return <ErrorNote error={error} />;
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<Link to="/clients" className="hover:underline">Clients</Link>}
        actions={
          <>
            <Button icon={<Pencil className="size-14" strokeWidth={1.8} />} onClick={() => setEdit(true)}>Edit</Button>
            <Link to={`/requirements?new=1&clientId=${c.id}`}>
              <Button variant="primary" icon={<Plus className="size-14" strokeWidth={1.8} />}>New requirement</Button>
            </Link>
          </>
        }
      />
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-12">
          <Card title="Requirements">
            {!c.requirements.length ? (
              <p className="text-10 text-ink-3">No requirements yet.</p>
            ) : (
              <table className="w-full text-11">
                <tbody>
                  {c.requirements.map((r) => (
                    <tr key={r.id} className="border-b hairline last:border-0">
                      <td className="py-8 pr-8 text-9 text-ink-3">{r.code}</td>
                      <td className="py-8"><Link to={`/requirements/${r.id}`} className="font-medium hover:underline">{r.title}</Link></td>
                      <td className="py-8"><Pill tone={requirementTone(r.status)}>{REQUIREMENT_STATUS_LABELS[r.status]}</Pill></td>
                      <td className="tnum py-8 text-right text-10 text-ink-2">{r.filled}/{r.openings} filled</td>
                      <td className="tnum py-8 text-right text-10 text-ink-2">{r.active} active</td>
                      <td className="py-8 text-right text-10 text-ink-3">{r.ownerName} · {fmtDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Activity"><Timeline items={c.timeline} /></Card>
        </div>
        <div className="space-y-12">
          <Card title="Details">
            <KeyValue
              items={[
                ['Industry', c.industry],
                ['City', c.city],
                ['Website', c.website ? <a className="link" href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a> : null],
                ['GSTIN', c.gstin],
                ['Address', c.address],
                ...(canSeeFees(me.role) ? ([['Fee', feeLabel(c)]] as [string, string][]) : []),
                ['Replacement guarantee', `${c.replacementDays} days`],
                ['Chase feedback after', `${c.feedbackChaseDays} working days`],
                ['Notes', c.notes],
              ]}
            />
          </Card>
          <Card title="Contacts" action={<Button size="sm" variant="quiet" icon={<Plus className="size-12" />} onClick={() => setContact('new')}>Add</Button>}>
            {!c.contacts.length && <p className="text-10 text-ink-3">Add the HR SPOC and hiring managers.</p>}
            <ul className="space-y-10">
              {c.contacts.map((ct) => (
                <li key={ct.id} className="flex items-start gap-8">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-4 text-11 font-medium">
                      {ct.name} {ct.isPrimary && <Star className="size-12 fill-marigold text-marigold" />}
                    </p>
                    <p className="text-9 text-ink-3">{ct.designation}</p>
                    <p className="mt-2 flex flex-wrap gap-x-10 text-10">
                      {ct.phone && <a className="link inline-flex items-center gap-4" href={`tel:${ct.phone}`}><Phone className="size-12" />{ct.phone}</a>}
                      {ct.email && <a className="link inline-flex items-center gap-4" href={`mailto:${ct.email}`}><Mail className="size-12" />{ct.email}</a>}
                    </p>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => setContact(ct)}>Edit</Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {edit && <ClientDialog client={c} onClose={() => setEdit(false)} />}
      {contact && <ContactDialog clientId={c.id} contact={contact === 'new' ? undefined : contact} onClose={() => setContact(null)} />}
    </>
  );
}

function ContactDialog({ clientId, contact, onClose }: { clientId: number; contact?: Contact; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: contact?.name ?? '',
    designation: contact?.designation ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    isPrimary: contact?.isPrimary ?? false,
  });
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['client', clientId] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (contact ? api.patch(`/clients/${clientId}/contacts/${contact.id}`, f) : api.post(`/clients/${clientId}/contacts`, f)),
    onSuccess: () => {
      toast('Contact saved');
      done();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/clients/${clientId}/contacts/${contact!.id}`),
    onSuccess: done,
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? 'Edit contact' : 'New contact'}
      width={460}
      footer={
        <>
          {contact && (
            <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-14" />} loading={del.isPending} onClick={() => confirm('Remove this contact?') && del.mutate()}>
              Remove
            </Button>
          )}
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-10">
        <Field label="Name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Designation"><Input value={f.designation} onChange={(e) => set('designation', e.target.value)} placeholder="HR Manager" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Checkbox label="Primary contact" checked={f.isPrimary} onChange={(v) => set('isPrimary', v)} />
      </div>
    </Modal>
  );
}
