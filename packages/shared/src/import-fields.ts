// Candidate fields the Excel/CSV import can fill, with header aliases for auto-mapping.
export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const CANDIDATE_IMPORT_FIELDS: ImportField[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'candidate name', 'candidate', 'full name'],
  },
  {
    key: 'phone',
    label: 'Phone',
    aliases: [
      'phone',
      'mobile',
      'mobile no',
      'contact',
      'contact no',
      'phone number',
      'mobile number',
    ],
  },
  {
    key: 'altPhone',
    label: 'Alternate phone',
    aliases: ['alternate phone', 'alt phone', 'alternate mobile', 'other phone'],
  },
  {
    key: 'email',
    label: 'Email',
    aliases: ['email', 'email id', 'mail', 'e-mail', 'email address'],
  },
  {
    key: 'currentCompany',
    label: 'Current company',
    aliases: ['current company', 'company', 'current employer', 'employer', 'organization'],
  },
  {
    key: 'currentTitle',
    label: 'Current designation',
    aliases: ['designation', 'current designation', 'title', 'role', 'current role'],
  },
  {
    key: 'totalExp',
    label: 'Total experience (yrs)',
    aliases: [
      'experience',
      'total experience',
      'exp',
      'total exp',
      'yrs of exp',
      'experience (yrs)',
    ],
  },
  {
    key: 'currentCtc',
    label: 'Current CTC',
    aliases: ['ctc', 'current ctc', 'cctc', 'current salary'],
  },
  {
    key: 'expectedCtc',
    label: 'Expected CTC',
    aliases: ['expected ctc', 'ectc', 'expected salary'],
  },
  {
    key: 'noticeDays',
    label: 'Notice period (days)',
    aliases: ['notice period', 'notice', 'np', 'notice period (days)'],
  },
  { key: 'location', label: 'Current location', aliases: ['location', 'current location', 'city'] },
  {
    key: 'preferredLocations',
    label: 'Preferred locations',
    aliases: ['preferred location', 'preferred locations'],
  },
  { key: 'skills', label: 'Skills', aliases: ['skills', 'key skills', 'skill set', 'technology'] },
  {
    key: 'qualification',
    label: 'Qualification',
    aliases: ['qualification', 'education', 'degree'],
  },
  { key: 'source', label: 'Source', aliases: ['source', 'sourced from', 'portal'] },
  {
    key: 'linkedinUrl',
    label: 'LinkedIn URL',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile'],
  },
  {
    key: 'sourcedBy',
    label: 'Recruiter (sourced by)',
    aliases: ['recruiter', 'sourced by', 'recruiter name', 'owner', 'added by'],
  },
  {
    key: 'addedOn',
    label: 'Added on (date)',
    aliases: ['date', 'added on', 'sourced date', 'created on', 'sourcing date'],
  },
  {
    key: 'notes',
    label: 'Remarks',
    aliases: ['remarks', 'notes', 'comments', 'comment', 'feedback'],
  },
];

/** Suggests a mapping CRM field -> sheet header by comparing normalised header names. */
export function suggestMapping(headers: string[]): Record<string, string> {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9()]+/g, ' ')
      .trim();
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of CANDIDATE_IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.aliases.includes(norm(h)));
    if (hit) {
      mapping[f.key] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/**
 * Parses a CTC cell into rupees per annum. Accepts "1200000", "12 LPA", "12L", "12.5 lakhs",
 * "1.2 Cr"; bare numbers below 200 are read as lakhs (how most trackers write CTC).
 */
export function parseCtc(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw < 200 ? Math.round(raw * 1e5) : Math.round(raw);
  const s = String(raw).toLowerCase().replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  if (/cr/.test(s)) return Math.round(n * 1e7);
  if (/l|lpa|lac|lakh/.test(s)) return Math.round(n * 1e5);
  if (/k/.test(s)) return Math.round(n * 1e3);
  return n < 200 ? Math.round(n * 1e5) : Math.round(n);
}

/** Parses "30", "30 days", "2 months", "Immediate", "1 month" into days. */
export function parseNoticeDays(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Math.round(raw);
  const s = String(raw).toLowerCase().trim();
  if (/immediate|serving/.test(s)) return 0;
  const m = s.match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (/month/.test(s)) return Math.round(n * 30);
  if (/week/.test(s)) return Math.round(n * 7);
  return Math.round(n);
}

/** Parses "5", "5 yrs", "5.5 years", "5y 6m" into years. */
export function parseExperience(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const s = String(raw).toLowerCase();
  const y = s.match(/([\d.]+)\s*(y|yr|yrs|year|years)?/);
  if (!y) return null;
  let years = parseFloat(y[1]);
  const mo = s.match(/([\d.]+)\s*(m|mo|month|months)\b/);
  if (mo && y.index !== mo.index) years += parseFloat(mo[1]) / 12;
  return Math.round(years * 10) / 10;
}
