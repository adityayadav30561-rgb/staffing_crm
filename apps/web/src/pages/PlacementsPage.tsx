import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, IndianRupee } from 'lucide-react';
import { INVOICE_STATUS_LABELS, INVOICE_STATUSES, type InvoiceStatus } from '@crm/shared';
import { api, download, qs } from '../lib/api';
import { fmtDate, formatInr, formatInrShort, formatLpa } from '../lib/format';
import {
  Button,
  Empty,
  Kpi,
  Loading,
  PageHeader,
  Pill,
  Table,
  Tabs,
  Td,
  Th,
  type Tone,
} from '../components/ui';
import { useToast } from '../components/toast';
import { useAppDrawer } from '../features/ApplicationDrawer';

interface PlacementRow {
  id: number;
  applicationId: number;
  joinedOn: string;
  feeAmount: number;
  guaranteeUntil: string;
  invoiceStatus: InvoiceStatus;
  invoiceNo: string | null;
  invoiceDate: string | null;
  paidOn: string | null;
  leftOn: string | null;
  candidateId: number;
  candidateName: string;
  requirementId: number;
  requirementTitle: string;
  clientId: number;
  clientName: string;
  offeredCtc: number | null;
  submittedByName: string | null;
}

const tone: Record<InvoiceStatus, Tone> = { to_raise: 'warn', raised: 'info', paid: 'good' };

export function PlacementsPage() {
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const toast = useToast();
  const drawer = useAppDrawer();
  const { data, isLoading } = useQuery({
    queryKey: ['placements', status],
    queryFn: () => api.get<PlacementRow[]>(`/placements${qs({ invoiceStatus: status })}`),
  });
  const { data: all } = useQuery({
    queryKey: ['placements', ''],
    queryFn: () => api.get<PlacementRow[]>('/placements'),
  });
  const sum = (s: InvoiceStatus) =>
    (all ?? []).filter((p) => p.invoiceStatus === s).reduce((n, p) => n + p.feeAmount, 0);
  const today = new Date();
  return (
    <>
      <PageHeader
        title="Placements & invoices"
        subtitle="Fees are calculated from each client's terms when a candidate joins"
        actions={
          <Button
            icon={<Download className="size-14" />}
            onClick={() =>
              void download(
                `/placements${qs({ invoiceStatus: status, format: 'xlsx' })}`,
                'placements.xlsx',
              ).catch((e) => toast(e.message, 'error'))
            }
          >
            Export
          </Button>
        }
      />
      <div className="mb-14 grid grid-cols-2 gap-10 xl:grid-cols-4">
        <Kpi
          tint="marigold"
          label="Invoices to raise"
          value={formatInrShort(sum('to_raise'))}
          note={`${(all ?? []).filter((p) => p.invoiceStatus === 'to_raise').length} placements`}
        />
        <Kpi tint="cobalt" label="Raised, awaiting payment" value={formatInrShort(sum('raised'))} />
        <Kpi tint="mint" label="Paid" value={formatInrShort(sum('paid'))} />
        <Kpi
          tint="coral"
          label="In replacement guarantee"
          value={(all ?? []).filter((p) => !p.leftOn && new Date(p.guaranteeUntil) >= today).length}
          note={`${(all ?? []).filter((p) => p.leftOn && p.leftOn <= p.guaranteeUntil).length} replacement${(all ?? []).filter((p) => p.leftOn && p.leftOn <= p.guaranteeUntil).length === 1 ? '' : 's'} due`}
        />
      </div>
      <div className="mb-12">
        <Tabs
          value={status}
          onChange={setStatus}
          items={[
            { value: '' as const, label: 'All' },
            ...INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
          ]}
        />
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty icon={<IndianRupee className="size-18" />} title="No placements yet">
          A placement is created automatically when a candidate is marked Joined.
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Client · position</Th>
              <Th>Joined</Th>
              <Th className="text-right">Offered CTC</Th>
              <Th className="text-right">Fee</Th>
              <Th>Invoice</Th>
              <Th>Guarantee</Th>
              <Th>Recruiter</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => {
              const inGuarantee = !p.leftOn && new Date(p.guaranteeUntil) >= today;
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-paper/60"
                  onClick={() => drawer.open(p.applicationId)}
                >
                  <Td>
                    <Link
                      to={`/candidates/${p.candidateId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {p.candidateName}
                    </Link>
                  </Td>
                  <Td>
                    {p.clientName}
                    <span className="block text-9 text-ink-3">{p.requirementTitle}</span>
                  </Td>
                  <Td className="tnum">{fmtDate(p.joinedOn)}</Td>
                  <Td className="tnum text-right">{formatLpa(p.offeredCtc)}</Td>
                  <Td className="tnum text-right font-medium">{formatInr(p.feeAmount)}</Td>
                  <Td>
                    <Pill tone={tone[p.invoiceStatus]}>
                      {INVOICE_STATUS_LABELS[p.invoiceStatus]}
                    </Pill>
                    {p.invoiceNo && (
                      <span className="block text-9 text-ink-3">
                        {p.invoiceNo}
                        {p.paidOn ? ` · paid ${fmtDate(p.paidOn)}` : ''}
                      </span>
                    )}
                  </Td>
                  <Td
                    className={clsx(
                      'text-10',
                      p.leftOn
                        ? 'font-medium text-signal-red'
                        : inGuarantee
                          ? 'text-ink'
                          : 'text-ink-3',
                    )}
                  >
                    {p.leftOn
                      ? `Left ${fmtDate(p.leftOn)}${p.leftOn <= p.guaranteeUntil ? ' — replacement due' : ''}`
                      : `${inGuarantee ? 'Until' : 'Ended'} ${fmtDate(p.guaranteeUntil)}`}
                  </Td>
                  <Td className="text-10 text-ink-2">{p.submittedByName ?? '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
