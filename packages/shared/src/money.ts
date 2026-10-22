import type { FeeType } from './enums';

/** Placement fee in rupees: a percentage of the annual offered CTC, or a fixed amount. */
export function calculateFee(
  feeType: FeeType,
  feeValue: number,
  offeredCtc: number | null,
): number {
  if (feeType === 'fixed') return Math.round(feeValue);
  if (!offeredCtc) return 0;
  return Math.round((offeredCtc * feeValue) / 100);
}

/** ₹ formatting in the Indian style: 2400000 -> "₹24L", 85000 -> "₹85K", 1.2Cr. */
export function formatInrShort(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(n / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(n / 1e3)}K`;
  return `₹${n}`;
}

export function formatInr(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

/** CTC in lakhs per annum, e.g. 1250000 -> "12.5 LPA". */
export function formatLpa(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${trim(n / 1e5)} LPA`;
}

function trim(v: number) {
  return Number(v.toFixed(v >= 10 ? 1 : 2)).toString();
}
