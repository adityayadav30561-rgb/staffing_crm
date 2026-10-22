// Resets the end-to-end database: drop everything, migrate, default lookups, the test team.
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate';
import { seedDefaults } from '../src/db/seed';
import { createDb } from '../src/db/index';
import { users } from '../src/db/schema';
import { hashPassword, randomToken } from '../src/lib/auth';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm_e2e';
const sql = postgres(url, { onnotice: () => {} });
await sql`drop schema if exists public cascade`;
await sql`drop schema if exists drizzle cascade`;
await sql`create schema public`;
await sql.end();
await runMigrations(url);
const { db, client } = createDb(url);
await seedDefaults(db);
const pw = await hashPassword('Password@123');
await db.insert(users).values([
  {
    name: 'Asha Admin',
    email: 'admin@e2e.crm',
    role: 'admin',
    passwordHash: pw,
    referralCode: randomToken(9),
  },
  {
    name: 'Manoj Manager',
    email: 'manager@e2e.crm',
    role: 'manager',
    passwordHash: pw,
    referralCode: randomToken(9),
  },
  {
    name: 'Riya Recruiter',
    email: 'riya@e2e.crm',
    role: 'recruiter',
    passwordHash: pw,
    referralCode: randomToken(9),
  },
  {
    name: 'Rohan Recruiter',
    email: 'rohan@e2e.crm',
    role: 'recruiter',
    passwordHash: pw,
    referralCode: randomToken(9),
  },
]);
await client.end();
console.log('e2e database ready');
