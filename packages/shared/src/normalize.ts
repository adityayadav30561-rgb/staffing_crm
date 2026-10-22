import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalises an Indian-by-default phone number to E.164 (+919876543210). Returns null if invalid. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, 'IN');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Lower-case, collapse spaces, strip punctuation — for loose name/company comparison. */
export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits "React, Node.js;  AWS" into ['React', 'Node.js', 'AWS'] without duplicates. */
export function splitSkills(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? '').split(/[,;|\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}
