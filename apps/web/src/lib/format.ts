export { formatInr, formatInrShort, formatLpa } from '@crm/shared';

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

const toDate = (v: string | Date) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));

export const fmtDate = (v?: string | Date | null) => (v ? dateFmt.format(toDate(v)) : '—');
export const fmtShort = (v?: string | Date | null) => (v ? shortFmt.format(toDate(v)) : '—');
export const fmtTime = (v?: string | Date | null) => (v ? timeFmt.format(toDate(v)).toLowerCase() : '');
export const fmtDateTime = (v?: string | Date | null) => (v ? `${fmtShort(v)}, ${fmtTime(v)}` : '—');

/** "2h ago", "Yesterday", "5d ago", or a date. */
export function ago(v?: string | Date | null) {
  if (!v) return '—';
  const d = toDate(v);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtShort(d);
}

/** Whole days since a date (for ages like "submitted 3d"). */
export const daysSince = (v?: string | Date | null) =>
  v ? Math.floor((Date.now() - toDate(v).getTime()) / 86_400_000) : 0;

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** yyyy-mm-dd for <input type="date">. */
export const dateInput = (v?: string | Date | null) => {
  if (!v) return '';
  const d = toDate(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** yyyy-mm-ddThh:mm for <input type="datetime-local">. */
export const dateTimeInput = (v?: string | Date | null) => {
  if (!v) return '';
  const d = toDate(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dateInput(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Rupees per annum <-> lakhs for form inputs. */
export const toLakhs = (n?: number | null) => (n == null ? '' : String(Math.round((n / 1e5) * 100) / 100));
export const fromLakhs = (s: string) => (s.trim() === '' ? null : Math.round(parseFloat(s) * 1e5));
