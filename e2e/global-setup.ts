import { execSync } from 'node:child_process';

/** Fresh database for every end-to-end run (see apps/api/scripts/e2e-reset.ts). */
export default function globalSetup() {
  execSync('pnpm --filter @crm/api exec tsx scripts/e2e-reset.ts', { stdio: 'inherit' });
}
