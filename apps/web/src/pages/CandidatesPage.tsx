import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileUp, Plus, Upload, Users } from 'lucide-react';
import { isManager, splitSkills } from '@crm/shared';
import { api, ApiError, download, qs } from '../lib/api';
import { useMe } from '../lib/auth';
import { useLookup, useUsers } from '../lib/queries';
import { ago, formatLpa, fromLakhs, toLakhs } from '../lib/format';
import type { Candidate, DuplicateMatch } from '../lib/types';
import { Avatar, Button, Empty, Field, Input, Loading, Modal, PageHeader, Pill, Select, Table, Td, Textarea, Th } from '../components/ui';
import { useToast } from '../components/toast';

interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: Candidate[];
}

export function CandidatesPage() {
  const me = useMe();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', skill: '', location: '', expMin: '', expMax: '', noticeMax: '', source: '', sourcedBy: '' });
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const sources = useLookup('source');
  const { data: users } = useUsers();
  useEffect(() => {
    if (params.get('new') === '1') {
      setNewOpen(true);
      setParams((p) => {
        p.delete('new');
        return p;
      });
    }
  }, [params, setParams]);
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(filters);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);
  const { data, isLoading } = useQuery({
    queryKey: ['candidates', debounced, page],
    queryFn: () => api.get<Page>(`/candidates${qs({ ...debounced, page, pageSize: 50 })}`),
    placeholderData: (prev) => prev,
  });
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <>
      <PageHeader
        title="Candidates"
        subtitle={data ? `${data.total.toLocaleString('en-IN')} in the shared database` : undefined}
        actions={
          <>
            {isManager(me.role) && (
              <Button icon={<Download className="size-14" strokeWidth={1.8} />} onClick={() => void download(`/candidates/export${qs(debounced)}`, 'candidates.xlsx').catch((e) => toast(e.message, 'error'))}>
                Export
              </Button>
            )}
            <Link to="/import">
              <Button icon={<Upload className="size-14" strokeWidth={1.8} />}>Import Excel</Button>
            </Link>
            <Button variant="primary" icon={<Plus className="size-14" strokeWidth={1.8} />} onClick={() => setNewOpen(true)}>
              Add candidate
            </Button>
          </>
        }
      />
      <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4 xl:grid-cols-8">
        <Input className="col-span-2" placeholder="Search name, phone, email, company, skill" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        <Input placeholder="Skills (comma)" value={filters.skill} onChange={(e) => set('skill', e.target.value)} />
        <Input placeholder="Location" value={filters.location} onChange={(e) => set('location', e.target.value)} />
        <div className="flex gap-4">
          <Input placeholder="Exp from" inputMode="decimal" value={filters.expMin} onChange={(e) => set('expMin', e.target.value)} />
          <Input placeholder="to" inputMode="decimal" value={filters.expMax} onChange={(e) => set('expMax', e.target.value)} />
        </div>
        <Select value={filters.noticeMax} onChange={(e) => set('noticeMax', e.target.value)}>
          <option value="">Any notice</option>
          <option value="0">Immediate</option>
          <option value="15">≤ 15 days</option>
          <option value="30">≤ 30 days</option>
          <option value="60">≤ 60 days</option>
        </Select>
        <Select value={filters.source} onChange={(e) => set('source', e.target.value)}>
          <option value="">Any source</option>
          {sources.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
        </Select>
        <Select value={filters.sourcedBy} onChange={(e) => set('sourcedBy', e.target.value)}>
          <option value="">Anyone</option>
          {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty icon={<Users className="size-18" />} title="No candidates found">Add candidates one by one, or import your existing Excel tracker.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Current</Th>
                <Th className="text-right">Exp</Th>
                <Th className="text-right">CTC → expected</Th>
                <Th className="text-right">Notice</Th>
                <Th>Location</Th>
                <Th>Skills</Th>
                <Th>Source</Th>
                <Th>Active</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="hover:bg-paper/60">
                  <Td>
                    <Link to={`/candidates/${c.id}`} className="flex items-center gap-8">
                      <Avatar name={c.name} size={24} />
                      <span className="leading-tight">
                        <span className="block font-medium hover:underline">{c.name}</span>
                        <span className="block text-9 text-ink-3">{c.phone ?? c.email ?? '—'}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="max-w-[220px]">
                    <span className="block truncate">{c.currentCompany ?? '—'}</span>
                    <span className="block truncate text-9 text-ink-3">{c.currentTitle}</span>
                  </Td>
                  <Td className="tnum text-right">{c.totalExp ?? '—'}</Td>
                  <Td className="tnum whitespace-nowrap text-right text-10">{formatLpa(c.currentCtc)} → {formatLpa(c.expectedCtc)}</Td>
                  <Td className="tnum text-right">{c.noticeDays != null ? `${c.noticeDays}d` : '—'}</Td>
                  <Td className="text-ink-2">{c.location ?? '—'}</Td>
                  <Td className="max-w-[220px] truncate text-10 text-ink-2">{c.skills.join(', ')}</Td>
                  <Td className="text-10 text-ink-2">{c.source ?? '—'}</Td>
                  <Td>{c.activeApps ? <Pill tone="info">{c.activeApps} active</Pill> : <span className="text-9 text-ink-3">—</span>}</Td>
                  <Td className="text-10 text-ink-3">{ago(c.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {pages > 1 && (
            <div className="mt-12 flex items-center justify-end gap-8 text-10">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="tnum text-ink-3">Page {page} of {pages}</span>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
      {newOpen && <CandidateDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

/** Quick add / edit. While typing phone, email or name + company, possible duplicates show up. */
export function CandidateDialog({ candidate, onClose }: { candidate?: Candidate; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sources = useLookup('source');
  const [f, setF] = useState(() => ({
    name: candidate?.name ?? '',
    phone: candidate?.phone ?? '',
    altPhone: candidate?.altPhone ?? '',
    email: candidate?.email ?? '',
    currentCompany: candidate?.currentCompany ?? '',
    currentTitle: candidate?.currentTitle ?? '',
    totalExp: candidate?.totalExp?.toString() ?? '',
    currentCtc: toLakhs(candidate?.currentCtc),
    expectedCtc: toLakhs(candidate?.expectedCtc),
    noticeDays: candidate?.noticeDays?.toString() ?? '',
    location: candidate?.location ?? '',
    preferredLocations: candidate?.preferredLocations ?? '',
    skills: candidate?.skills.join(', ') ?? '',
    qualification: candidate?.qualification ?? '',
    source: candidate?.source ?? '',
    linkedinUrl: candidate?.linkedinUrl ?? '',
    notes: candidate?.notes ?? '',
  }));
  const [resume, setResume] = useState<File | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const [dupKey, setDupKey] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDupKey(JSON.stringify([f.phone, f.email, f.name, f.currentCompany])), 400);
    return () => clearTimeout(t);
  }, [f.phone, f.email, f.name, f.currentCompany]);
  const { data: dupes } = useQuery({
    queryKey: ['dupes', dupKey, candidate?.id],
    queryFn: () => {
      const [phone, email, name, currentCompany] = JSON.parse(dupKey) as string[];
      return api.get<DuplicateMatch[]>(`/candidates/duplicates${qs({ phone, email, name, currentCompany, excludeId: candidate?.id })}`);
    },
    enabled: !!dupKey && (f.phone.length >= 8 || f.email.includes('@') || (f.name.length >= 3 && f.currentCompany.length >= 2)),
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        phone: f.phone,
        altPhone: f.altPhone,
        email: f.email,
        currentCompany: f.currentCompany,
        currentTitle: f.currentTitle,
        totalExp: f.totalExp === '' ? null : Number(f.totalExp),
        currentCtc: fromLakhs(f.currentCtc),
        expectedCtc: fromLakhs(f.expectedCtc),
        noticeDays: f.noticeDays === '' ? null : Number(f.noticeDays),
        location: f.location,
        preferredLocations: f.preferredLocations,
        skills: splitSkills(f.skills),
        qualification: f.qualification,
        source: f.source,
        linkedinUrl: f.linkedinUrl,
        notes: f.notes,
      };
      const c = candidate
        ? await api.patch<Candidate>(`/candidates/${candidate.id}`, { ...body, version: candidate.version })
        : await api.post<Candidate>('/candidates', body);
      if (resume) {
        const fd = new FormData();
        fd.append('file', resume);
        await api.post(`/candidates/${c.id}/resumes`, fd).catch((e) => toast(`Saved, but the resume failed: ${e.message}`, 'error'));
      }
      return c;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: ['candidate'] });
      toast(candidate ? 'Profile updated' : 'Candidate added');
      onClose();
      if (!candidate) navigate(`/candidates/${c.id}`);
    },
    onError: (e) => {
      toast((e as Error).message, 'error');
      if (e instanceof ApiError && e.code === 'STALE') void qc.invalidateQueries({ queryKey: ['candidate'] });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={candidate ? `Edit ${candidate.name}` : 'Add candidate'}
      width={720}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>
            {dupes?.length && !candidate ? 'Save anyway' : 'Save'}
          </Button>
        </>
      }
    >
      {!!dupes?.length && (
        <div className="mb-12 rounded-md bg-brass-soft px-12 py-10 text-10 text-brass-text">
          <p className="flex items-center gap-6 font-medium"><AlertTriangle className="size-14" /> Possible duplicate{dupes.length > 1 ? 's' : ''} — check before adding</p>
          <ul className="mt-6 space-y-4">
            {dupes.map((d) => (
              <li key={d.id}>
                <Link to={`/candidates/${d.id}`} target="_blank" className="font-medium underline">{d.name}</Link>{' '}
                {[d.phone, d.email, d.currentCompany].filter(Boolean).join(' · ')} — same {d.reasons.map((r) => (r === 'name_company' ? 'name & company' : r)).join(' and ')}
                {d.sourcedByName ? `, added by ${d.sourcedByName} ${ago(d.createdAt)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-6 gap-10">
        <Field label="Full name" className="col-span-3"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Mobile" className="col-span-3"><Input inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98765 43210" /></Field>
        <Field label="Email" className="col-span-3"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Alternate phone" className="col-span-3"><Input inputMode="tel" value={f.altPhone} onChange={(e) => set('altPhone', e.target.value)} /></Field>
        <Field label="Current company" className="col-span-3"><Input value={f.currentCompany} onChange={(e) => set('currentCompany', e.target.value)} /></Field>
        <Field label="Designation" className="col-span-3"><Input value={f.currentTitle} onChange={(e) => set('currentTitle', e.target.value)} /></Field>
        <Field label="Experience (yrs)" className="col-span-2"><Input inputMode="decimal" value={f.totalExp} onChange={(e) => set('totalExp', e.target.value)} /></Field>
        <Field label="Current CTC (LPA)" className="col-span-2"><Input inputMode="decimal" value={f.currentCtc} onChange={(e) => set('currentCtc', e.target.value)} /></Field>
        <Field label="Expected CTC (LPA)" className="col-span-2"><Input inputMode="decimal" value={f.expectedCtc} onChange={(e) => set('expectedCtc', e.target.value)} /></Field>
        <Field label="Notice (days)" className="col-span-2"><Input inputMode="numeric" value={f.noticeDays} onChange={(e) => set('noticeDays', e.target.value)} /></Field>
        <Field label="Current location" className="col-span-2"><Input value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Preferred locations" className="col-span-2"><Input value={f.preferredLocations} onChange={(e) => set('preferredLocations', e.target.value)} /></Field>
        <Field label="Skills" hint="Separate with commas" className="col-span-6"><Input value={f.skills} onChange={(e) => set('skills', e.target.value)} /></Field>
        <Field label="Source" className="col-span-2">
          <Select value={f.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">—</option>
            {sources.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            {f.source && !sources.some((s) => s.label === f.source) && <option value={f.source}>{f.source}</option>}
          </Select>
        </Field>
        <Field label="Qualification" className="col-span-2"><Input value={f.qualification} onChange={(e) => set('qualification', e.target.value)} /></Field>
        <Field label="LinkedIn URL" className="col-span-2"><Input value={f.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} /></Field>
        {!candidate && (
          <Field label="Resume" className="col-span-6" hint="PDF or Word, up to 10 MB">
            <label className="flex cursor-pointer items-center gap-8 rounded-md px-12 py-10 text-10 text-ink-2 ring-1 ring-dashed ring-ink/20 hover:bg-paper">
              <FileUp className="size-16" strokeWidth={1.8} />
              {resume ? resume.name : 'Choose a file'}
              <input type="file" className="hidden" accept=".pdf,.doc,.docx,.rtf,.txt" onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
        )}
        <Field label="Notes" className="col-span-6"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
