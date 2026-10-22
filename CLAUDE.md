# Recruitment CRM — read this first

Internal CRM for a 2–5 person recruitment team (permanent placements, India). The code for every planned feature exists; the remaining work is deploying, piloting and later features.

## Source-of-truth files (keep them short; update them, don't duplicate them)

| File                 | Holds                                                     | Update when                 |
| -------------------- | --------------------------------------------------------- | --------------------------- |
| `docs/STATUS.md`     | Current phase, checklist, next actions, short session log | End of every session        |
| `docs/PLAN.md`       | Agreed process decisions and architecture                 | A business decision changes |
| `docs/DEPLOY.md`     | Free hosting setup, env vars, user accounts               | Hosting changes             |
| `docs/USER_GUIDE.md` | How the team uses the CRM                                 | A visible behaviour changes |

**Session routine:** read `docs/STATUS.md`, then only the files the current task touches (use the code map below; don't scan the whole repo). Before ending, update `docs/STATUS.md` (tick items, add one log line) and commit.

## Code map

- `packages/shared/src/pipeline.ts`: stage engine (stages, statuses, allowed moves). `schemas.ts`: zod request bodies. `enums.ts`, `import-fields.ts`, `normalize.ts`, `money.ts`, `dates.ts`.
- `apps/api/src/db/schema.ts`: all tables (Drizzle). Migrations in `apps/api/drizzle/` (generate with `pnpm db:generate`).
- `apps/api/src/routes/*.ts`: one file per area (clients, requirements, candidates, applications = pipeline/interviews/offers, tasks, placements, reports, import, public = files/referral/search, admin, auth, users).
- `apps/api/src/lib/`: `pipeline.ts` (apply a move and its side effects), `lock.ts` (optimistic locking), `audit.ts`, `access.ts` (who may work a requirement), `storage.ts`, `duplicates.ts`, `sql.ts` (`outer()` for correlated subqueries; always use it).
- `apps/api/src/automation/rules.ts`: auto-task rules (idempotent sweep).
- `apps/web/src/pages/*`, `features/ApplicationDrawer.tsx` (where a candidate × requirement is worked), `components/ui.tsx` (Nirman components), `tailwind.config.js` (design tokens; spacing is in px).

## Commands

`pnpm dev` · `pnpm test` (needs Postgres DB `crm_test`) · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm build`.
In a cloud session, start Postgres first: `service postgresql start`. If it's missing, create user `crm`/`crm` and databases `crm`, `crm_test`, `crm_e2e`. Chromium for Playwright: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Rules

- Every write goes through `updateVersioned` (or writes an audit row) and logs an activity when the team should see it.
- Stage changes only via `applyMove` (API) / `checkMove` (shared). Never update `applications.stage/status` directly.
- Recruiters never see fees (`canSeeFees`). Coordination with clients and candidates happens outside the CRM; the CRM logs it.
- UI follows `docs/design/` (forest/mint action colour, paper neutrals, pills, hairlines). Keep TypeScript at 6.x (lint tooling doesn't support 7).
- Run lint, typecheck and tests before pushing. Never commit secrets.
