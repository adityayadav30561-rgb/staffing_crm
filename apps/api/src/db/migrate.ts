import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index';

export async function runMigrations(url: string) {
  const { db, client } = createDb(url);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../drizzle in dev; dist -> ../drizzle in the bundled build
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];
  const { existsSync } = await import('node:fs');
  const folder = candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json')));
  if (!folder) throw new Error('Migrations folder not found');
  await migrate(db, { migrationsFolder: folder });
  await client.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await runMigrations(url);
  console.log('Migrations applied');
}
