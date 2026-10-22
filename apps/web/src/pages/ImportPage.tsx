// Excel/CSV migration wizard: upload -> map columns -> check (dry run) -> import -> download skipped rows.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, download } from '../lib/api';
import { useLookup } from '../lib/queries';
import { formatLpa } from '../lib/format';
import {
  Button,
  Card,
  Checkbox,
  ErrorNote,
  Field,
  PageHeader,
  Pill,
  Select,
  Table,
  Tabs,
  Td,
  Th,
} from '../components/ui';
import { useToast } from '../components/toast';

interface Upload {
  jobId: number;
  fileName: string;
  headers: string[];
  rowCount: number;
  sample: Record<string, unknown>[];
  suggestedMapping: Record<string, string>;
  fields: { key: string; label: string; required: boolean }[];
}
interface CheckRow {
  row: number;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  exp: number | null;
  currentCtc: number | null;
  noticeDays: number | null;
  errors: string[];
  warnings: string[];
  duplicates: { id: number; name: string; reasons: string[] }[];
  inFileDuplicateOf: number | null;
}
interface Check {
  total: number;
  ready: number;
  errors: number;
  duplicates: number;
  warnings: number;
  rows: CheckRow[];
}

export function ImportPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const sources = useLookup('source');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultSource, setDefaultSource] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [include, setInclude] = useState<number[]>([]);
  const [filter, setFilter] = useState<'all' | 'ready' | 'duplicates' | 'errors'>('all');
  const [result, setResult] = useState<{ created: number; skippedCount: number } | null>(null);

  const send = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post<Upload>('/import/candidates', fd);
    },
    onSuccess: (u) => {
      setUpload(u);
      setMapping(u.suggestedMapping);
      setCheck(null);
      setResult(null);
    },
  });
  const validate = useMutation({
    mutationFn: () =>
      api.post<Check>(`/import/${upload!.jobId}/validate`, {
        mapping,
        defaultSource: defaultSource || null,
      }),
    onSuccess: (c) => {
      setCheck(c);
      setInclude([]);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const commit = useMutation({
    mutationFn: () =>
      api.post<{ created: number; skippedCount: number }>(`/import/${upload!.jobId}/commit`, {
        mapping,
        defaultSource: defaultSource || null,
        includeDuplicates: include,
      }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      toast(`${r.created} candidates imported`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const step = result ? 4 : check ? 3 : upload ? 2 : 1;
  const rows = (check?.rows ?? []).filter((r) =>
    filter === 'all'
      ? true
      : filter === 'errors'
        ? r.errors.length > 0
        : filter === 'duplicates'
          ? !r.errors.length && (r.duplicates.length > 0 || !!r.inFileDuplicateOf)
          : !r.errors.length && !r.duplicates.length && !r.inFileDuplicateOf,
  );

  return (
    <>
      <PageHeader
        title="Import candidates"
        subtitle={
          <Link to="/candidates" className="hover:underline">
            Candidates
          </Link>
        }
      />
      <ol className="mb-16 flex flex-wrap gap-8 text-10">
        {['Upload file', 'Match columns', 'Check rows', 'Done'].map((s, i) => (
          <li
            key={s}
            className={clsx(
              'flex items-center gap-6 rounded-full px-12 py-5',
              step === i + 1
                ? 'bg-forest text-mint'
                : step > i + 1
                  ? 'bg-mint-soft text-forest'
                  : 'bg-paper-2 text-ink-3',
            )}
          >
            <span className="tnum font-semibold">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <label className="flex cursor-pointer flex-col items-center gap-8 rounded-lg px-24 py-40 text-center ring-1 ring-dashed ring-ink/20 hover:bg-paper">
            <FileSpreadsheet className="size-32 text-forest-2" strokeWidth={1.5} />
            <span className="text-12 font-medium">
              {send.isPending ? 'Reading file…' : 'Choose your Excel (.xlsx) or CSV file'}
            </span>
            <span className="max-w-[460px] text-10 text-ink-3">
              The first sheet is read. Keep one candidate per row with a header row (Name, Mobile,
              Email, Company, Experience, CTC, Notice period, Skills…). Nothing is saved until you
              confirm.
            </span>
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.csv"
              onChange={(e) => e.target.files?.[0] && send.mutate(e.target.files[0])}
            />
          </label>
          <div className="mt-10">
            <ErrorNote error={send.error} />
          </div>
        </Card>
      )}

      {upload && step === 2 && (
        <Card title={`${upload.fileName} · ${upload.rowCount} rows`}>
          <p className="mb-12 text-10 text-ink-2">
            Match each CRM field to a column in your sheet. We guessed what we could.
          </p>
          <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
            {upload.fields.map((f) => (
              <Field
                key={f.key}
                label={
                  <>
                    {f.label}
                    {f.required && <span className="text-signal-red"> *</span>}
                  </>
                }
              >
                <Select
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                >
                  <option value="">— not in my sheet —</option>
                  {upload.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Source for rows without one">
              <Select value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)}>
                <option value="">—</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <h3 className="mb-6 mt-16 text-10 font-semibold text-ink-2">First rows of your file</h3>
          <div className="overflow-x-auto">
            <table className="text-9">
              <thead>
                <tr>
                  {upload.headers.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border-b hairline px-8 py-4 text-left text-ink-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upload.sample.map((r, i) => (
                  <tr key={i}>
                    {upload.headers.map((h) => (
                      <td key={h} className="whitespace-nowrap border-b hairline px-8 py-4">
                        {String(r[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-14 flex justify-between">
            <Button variant="quiet" onClick={() => setUpload(null)}>
              Choose another file
            </Button>
            <Button
              variant="primary"
              disabled={!mapping.name}
              loading={validate.isPending}
              onClick={() => validate.mutate()}
            >
              Check rows
            </Button>
          </div>
        </Card>
      )}

      {check && step === 3 && (
        <>
          <div className="mb-12 grid grid-cols-2 gap-10 md:grid-cols-4">
            <Summary label="Ready to import" value={check.ready} tone="mint" />
            <Summary
              label="Possible duplicates"
              value={check.duplicates}
              tone="marigold"
              note="Skipped unless you tick them"
            />
            <Summary label="Errors" value={check.errors} tone="coral" note="Will be skipped" />
            <Summary
              label="With warnings"
              value={check.warnings}
              tone="cobalt"
              note="Imported; check the details"
            />
          </div>
          <div className="mb-10 flex flex-wrap items-center gap-8">
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { value: 'all', label: 'All', count: check.total },
                { value: 'ready', label: 'Ready', count: check.ready },
                { value: 'duplicates', label: 'Duplicates', count: check.duplicates },
                { value: 'errors', label: 'Errors', count: check.errors },
              ]}
            />
            <span className="ml-auto flex gap-8">
              <Button variant="quiet" onClick={() => setCheck(null)}>
                Back to columns
              </Button>
              <Button
                variant="primary"
                icon={<Upload className="size-14" />}
                loading={commit.isPending}
                disabled={check.ready + include.length === 0}
                onClick={() => commit.mutate()}
              >
                Import {check.ready + include.length} candidates
              </Button>
            </span>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Email</Th>
                <Th>Company</Th>
                <Th className="text-right">Exp</Th>
                <Th className="text-right">CTC</Th>
                <Th>Check</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r) => {
                const dup = !r.errors.length && (r.duplicates.length > 0 || !!r.inFileDuplicateOf);
                return (
                  <tr
                    key={r.row}
                    className={clsx(
                      r.errors.length && 'bg-coral-soft/40',
                      dup && 'bg-brass-soft/40',
                    )}
                  >
                    <Td className="tnum text-ink-3">{r.row + 1}</Td>
                    <Td className="font-medium">
                      {r.name || <span className="text-signal-red">missing</span>}
                    </Td>
                    <Td className="text-10">{r.phone ?? '—'}</Td>
                    <Td className="text-10">{r.email ?? '—'}</Td>
                    <Td className="text-10">{r.company ?? '—'}</Td>
                    <Td className="tnum text-right">{r.exp ?? '—'}</Td>
                    <Td className="tnum text-right text-10">{formatLpa(r.currentCtc)}</Td>
                    <Td className="text-10">
                      {r.errors.map((e) => (
                        <p key={e} className="text-signal-red">
                          {e}
                        </p>
                      ))}
                      {r.inFileDuplicateOf && (
                        <p className="text-brass-text">
                          Same phone/email as row {r.inFileDuplicateOf + 1}
                        </p>
                      )}
                      {r.duplicates.map((d) => (
                        <p key={d.id} className="text-brass-text">
                          Matches{' '}
                          <Link to={`/candidates/${d.id}`} target="_blank" className="underline">
                            {d.name}
                          </Link>{' '}
                          ({d.reasons.join(', ')})
                        </p>
                      ))}
                      {dup && (
                        <Checkbox
                          label="Import anyway"
                          checked={include.includes(r.row)}
                          onChange={(v) =>
                            setInclude((s) => (v ? [...s, r.row] : s.filter((x) => x !== r.row)))
                          }
                        />
                      )}
                      {r.warnings.map((w) => (
                        <p key={w} className="text-ink-3">
                          {w}
                        </p>
                      ))}
                      {!r.errors.length && !dup && !r.warnings.length && (
                        <Pill tone="good">OK</Pill>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      {result && (
        <Card>
          <div className="flex flex-col items-center gap-8 py-24 text-center">
            <CheckCircle2 className="size-32 text-moss" strokeWidth={1.5} />
            <p className="title text-16">{result.created} candidates imported</p>
            {result.skippedCount > 0 && (
              <>
                <p className="flex items-center gap-6 text-10 text-ink-2">
                  <AlertTriangle className="size-14 text-brass" />
                  {result.skippedCount} rows were skipped.
                </p>
                <Button
                  icon={<Download className="size-14" />}
                  onClick={() =>
                    void download(`/import/${upload!.jobId}/errors`, 'not-imported.xlsx')
                  }
                >
                  Download skipped rows
                </Button>
              </>
            )}
            <div className="mt-8 flex gap-8">
              <Button
                onClick={() => {
                  setUpload(null);
                  setCheck(null);
                  setResult(null);
                }}
              >
                Import another file
              </Button>
              <Link to="/candidates">
                <Button variant="primary">Go to candidates</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Summary({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: number;
  tone: 'mint' | 'marigold' | 'coral' | 'cobalt';
  note?: string;
}) {
  const bg = {
    mint: 'bg-mint-soft',
    marigold: 'bg-marigold-soft',
    coral: 'bg-coral-soft',
    cobalt: 'bg-cobalt-soft',
  }[tone];
  return (
    <div className={clsx('rounded-lg p-14', bg)}>
      <p className="text-10 text-ink-2">{label}</p>
      <p className="mock-display tnum mt-4 text-24">{value}</p>
      {note && <p className="mt-4 text-9 text-ink-3">{note}</p>}
    </div>
  );
}
