import { activities, auditLogs } from '../db/schema';
import type { Tx } from '../db';

const IGNORED = new Set(['updatedAt', 'createdAt', 'version', 'updatedBy', 'passwordHash']);

/** Field-level diff of `after` against `before`, for the keys present in `after`. */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(after)) {
    if (IGNORED.has(k) || v === undefined) continue;
    const prev = before ? before[k] : null;
    if (!sameValue(prev, v)) changes[k] = [prev ?? null, v ?? null];
  }
  return changes;
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  }
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  // numeric columns may come back as numbers while input is a string, or vice versa
  if (a != null && b != null && String(a) === String(b)) return true;
  return a === b;
}

export async function writeAudit(
  tx: Tx,
  actorId: number | null,
  entity: string,
  entityId: number,
  action: 'create' | 'update' | 'delete',
  changes: Record<string, [unknown, unknown]> | null,
) {
  if (action === 'update' && changes && Object.keys(changes).length === 0) return;
  await tx.insert(auditLogs).values({ actorId, entity, entityId, action, changes });
}

/** Audit for a newly created row: every non-empty field as [null, value]. */
export function createdChanges(row: Record<string, unknown>) {
  return diff(null, Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== '')));
}

export interface ActivityInput {
  actorId: number | null;
  verb: string;
  summary: string;
  payload?: Record<string, unknown>;
  clientId?: number | null;
  requirementId?: number | null;
  candidateId?: number | null;
  applicationId?: number | null;
}

export async function logActivity(tx: Tx, a: ActivityInput) {
  await tx.insert(activities).values({
    actorId: a.actorId,
    verb: a.verb,
    summary: a.summary,
    payload: a.payload ?? null,
    clientId: a.clientId ?? null,
    requirementId: a.requirementId ?? null,
    candidateId: a.candidateId ?? null,
    applicationId: a.applicationId ?? null,
  });
}
