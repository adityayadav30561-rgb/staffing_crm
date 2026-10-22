import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DB = ReturnType<typeof createDb>['db'];
/** A transaction handle or the root db — both expose the same query API. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client };
}

export { schema };
