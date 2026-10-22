import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { normalizeEmail, normalizePhone, normalizeText } from '@crm/shared';
import type { Tx } from '../db';
import { candidates, users } from '../db/schema';

export interface DuplicateQuery {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  currentCompany?: string | null;
  excludeId?: number;
}

export interface DuplicateMatch {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  currentCompany: string | null;
  sourcedByName: string | null;
  createdAt: Date;
  reasons: ('phone' | 'email' | 'name_company')[];
}

/**
 * Possible duplicates of a candidate: same phone, same email, or a similar name at the same company.
 * Matching only warns — recruiters may still create the record (agreed in the process walkthrough).
 */
export async function findDuplicates(tx: Tx, q: DuplicateQuery): Promise<DuplicateMatch[]> {
  const phone = normalizePhone(q.phone);
  const email = normalizeEmail(q.email);
  const name = normalizeText(q.name);
  const company = normalizeText(q.currentCompany);
  const ors: SQL[] = [];
  if (phone) ors.push(eq(candidates.phoneE164, phone));
  if (email) ors.push(eq(candidates.emailNorm, email));
  if (name.length >= 3 && company.length >= 2) {
    ors.push(
      sql`(similarity(lower(${candidates.name}), ${name}) > 0.6 and lower(regexp_replace(coalesce(${candidates.currentCompany}, ''), '[^[:alnum:][:space:]]', ' ', 'g')) like ${'%' + company + '%'})`,
    );
  }
  if (!ors.length) return [];
  const rows = await tx
    .select({
      id: candidates.id,
      name: candidates.name,
      phone: candidates.phone,
      phoneE164: candidates.phoneE164,
      email: candidates.email,
      emailNorm: candidates.emailNorm,
      currentCompany: candidates.currentCompany,
      createdAt: candidates.createdAt,
      sourcedByName: users.name,
    })
    .from(candidates)
    .leftJoin(users, eq(users.id, candidates.sourcedBy))
    .where(and(or(...ors), q.excludeId ? ne(candidates.id, q.excludeId) : undefined))
    .limit(10);
  return rows.map((r) => {
    const reasons: DuplicateMatch['reasons'] = [];
    if (phone && r.phoneE164 === phone) reasons.push('phone');
    if (email && r.emailNorm === email) reasons.push('email');
    if (!reasons.length) reasons.push('name_company');
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      currentCompany: r.currentCompany,
      sourcedByName: r.sourcedByName,
      createdAt: r.createdAt,
      reasons,
    };
  });
}
