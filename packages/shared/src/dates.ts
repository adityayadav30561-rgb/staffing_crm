const DAY = 86_400_000;

/** Adds working days, skipping the given weekday numbers (0 = Sunday). Time of day is kept. */
export function addWorkingDays(from: Date, days: number, offDays: number[] = [0]): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setTime(d.getTime() + DAY);
    if (!offDays.includes(d.getDay())) added++;
  }
  return d;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY);
}

/** Whole days from a to b (b - a), by calendar date. */
export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY);
}

/** yyyy-mm-dd in local time. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
