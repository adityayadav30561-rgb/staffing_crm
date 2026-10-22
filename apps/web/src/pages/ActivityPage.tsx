import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useUsers } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import { Button, Loading, PageHeader, Select, Table, Tabs, Td, Th } from '../components/ui';

interface ActivityRow {
  id: number;
  verb: string;
  summary: string;
  createdAt: string;
  actorName: string | null;
  candidateId: number | null;
  requirementId: number | null;
  applicationId: number | null;
}
interface AuditRow {
  id: number;
  entity: string;
  entityId: number;
  action: 'create' | 'update' | 'delete';
  changes: Record<string, [unknown, unknown]> | null;
  createdAt: string;
  actorName: string | null;
}

const ENTITIES = ['candidate', 'application', 'requirement', 'client', 'client_contact', 'interview', 'offer', 'placement', 'task', 'user', 'lookup', 'settings', 'resume', 'job_posting'];

export function ActivityPage() {
  const [tab, setTab] = useState<'activity' | 'audit'>('activity');
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const { data: users } = useUsers();
  return (
    <>
      <PageHeader title="Activity & audit" subtitle="Who did what, and every field that changed" />
      <div className="mb-12 flex flex-wrap items-center gap-8">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'activity', label: 'Team activity' }, { value: 'audit', label: 'Audit history' }]} />
        <Select className="w-[200px]" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Everyone</option>
          {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        {tab === 'audit' && (
          <Select className="w-[200px]" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All records</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}
          </Select>
        )}
      </div>
      {tab === 'activity' ? <ActivityFeed userId={userId} /> : <AuditFeed userId={userId} entity={entity} />}
    </>
  );
}

function ActivityFeed({ userId }: { userId: string }) {
  const q = useInfiniteQuery({
    queryKey: ['activities', userId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.get<ActivityRow[]>(`/activities${qs({ userId, before: pageParam })}`),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id - 1 : undefined),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flat() ?? [];
  return (
    <>
      <Table>
        <thead>
          <tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="tnum whitespace-nowrap text-10 text-ink-3">{fmtDateTime(r.createdAt)}</Td>
              <Td className="whitespace-nowrap text-10">{r.actorName ?? 'System'}</Td>
              <Td className="text-10">{r.summary}</Td>
              <Td className="whitespace-nowrap text-right text-10">
                {r.candidateId && <Link className="link mr-8" to={`/candidates/${r.candidateId}`}>Candidate</Link>}
                {r.requirementId && <Link className="link" to={`/requirements/${r.requirementId}${r.applicationId ? `?app=${r.applicationId}` : ''}`}>Requirement</Link>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {q.hasNextPage && <div className="mt-12 text-center"><Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button></div>}
    </>
  );
}

function AuditFeed({ userId, entity }: { userId: string; entity: string }) {
  const q = useInfiniteQuery({
    queryKey: ['audit', userId, entity],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.get<AuditRow[]>(`/audit${qs({ userId, entity, before: pageParam })}`),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id - 1 : undefined),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flat() ?? [];
  const show = (v: unknown) => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <>
      <Table>
        <thead>
          <tr><Th>When</Th><Th>Who</Th><Th>Record</Th><Th>Change</Th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td className="tnum whitespace-nowrap text-10 text-ink-3">{fmtDateTime(r.createdAt)}</Td>
              <Td className="whitespace-nowrap text-10">{r.actorName ?? 'System'}</Td>
              <Td className="whitespace-nowrap text-10">{r.entity.replace('_', ' ')} #{r.entityId} <span className="text-ink-3">· {r.action}</span></Td>
              <Td className="text-10">
                {r.changes && Object.keys(r.changes).length ? (
                  <ul className="space-y-2">
                    {Object.entries(r.changes).slice(0, 12).map(([k, [a, b]]) => (
                      <li key={k} className="break-all">
                        <span className="text-ink-3">{k}:</span> {r.action === 'update' ? <><span className="text-coral-2 line-through">{show(a)}</span> → </> : null}
                        <span className="text-forest">{show(b)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {q.hasNextPage && <div className="mt-12 text-center"><Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button></div>}
    </>
  );
}
