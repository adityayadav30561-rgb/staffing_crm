import { loadConfig } from './config';
import { buildApp } from './app';
import { runMigrations } from './db/migrate';

const cfg = loadConfig();
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(cfg.databaseUrl);
const app = await buildApp(cfg, { logger: true });
app.automation.start(cfg.automationIntervalMs);
await app.listen({ port: cfg.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
