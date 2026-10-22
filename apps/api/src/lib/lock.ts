import { and, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../db';
import { users } from '../db/schema';
import { conflict, notFound } from './errors';
import { diff, writeAudit } from './audit';

type VersionedTable = PgTable & {
  id: any;
  version: any;
  updatedAt: any;
};

/**
 * Optimistic-lock update: applies `values` only if the row is still at `version`.
 * Otherwise throws 409 with who changed it and when, so the UI can offer reload/compare.
 * Writes a field-level audit row. Returns the updated row.
 */
export async function updateVersioned<T extends Record<string, unknown>>(
  tx: Tx,
  table: VersionedTable,
  entity: string,
  id: number,
  version: number,
  values: Record<string, unknown>,
  actorId: number,
): Promise<T> {
  const [before] = (await tx
    .select()
    .from(table as any)
    .where(eq(table.id, id))) as T[];
  if (!before) throw notFound(entity);
  if (before.version !== version) throw await staleError(tx, entity, before);
  const hasUpdatedBy = 'updatedBy' in (table as any);
  const [row] = (await tx
    .update(table as any)
    .set({
      ...values,
      ...(hasUpdatedBy ? { updatedBy: actorId } : {}),
      version: sql`${table.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(table.id, id), eq(table.version, version)))
    .returning()) as T[];
  if (!row) {
    const [current] = (await tx
      .select()
      .from(table as any)
      .where(eq(table.id, id))) as T[];
    throw await staleError(tx, entity, current ?? before);
  }
  await writeAudit(tx, actorId, entity, id, 'update', diff(before, values));
  return row;
}

async function staleError(tx: Tx, entity: string, current: Record<string, unknown>) {
  let by: string | null = null;
  if (typeof current.updatedBy === 'number') {
    const [u] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, current.updatedBy));
    by = u?.name ?? null;
  }
  return conflict(
    `${by ?? 'Someone'} changed this ${entity} after you opened it. Reload to see their changes.`,
    'STALE',
    { current, updatedBy: by, updatedAt: current.updatedAt },
  );
}
