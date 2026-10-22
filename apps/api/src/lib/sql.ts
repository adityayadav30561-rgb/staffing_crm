import { sql } from 'drizzle-orm';

/**
 * Table-qualified column for correlated subqueries. Drizzle leaves out the table name when a
 * query reads a single table, so `${requirements.id}` inside a subquery would bind to the
 * subquery's own `id`. Spell the outer column out instead.
 */
export const outer = (table: string, column: string) => sql.raw(`"${table}"."${column}"`);
