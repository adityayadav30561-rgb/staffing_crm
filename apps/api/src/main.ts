import { loadConfig } from './config';
import { buildApp } from './app';
import { runMigrations } from './db/migrate';
import { seedDefaults } from './db/seed';

const cfg = loadConfig();
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(cfg.databaseUrl);
const app = await buildApp(cfg, { logger: true });
// Default dropdown lists, and the first admin from env vars (free hosts have no shell to run a seed).
// Both are idempotent: nothing is overwritten once it exists.
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
await seedDefaults(
  app.db,
  adminEmail && adminPassword
    ? { name: process.env.SEED_ADMIN_NAME ?? 'Admin', email: adminEmail, password: adminPassword }
    : undefined,
);
app.automation.start(cfg.automationIntervalMs);
await app.listen({ port: cfg.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
