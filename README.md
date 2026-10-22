# Recruitment CRM

Internal CRM for a small recruitment team (2–5 people). It replaces the Excel tracker: everyone works on one shared database, several recruiters can work the same requirement without double-submitting, and follow-ups (client feedback, interview outcomes, notice-period check-ins) become automatic tasks.

The workflow follows the team's process document (`docs/process/Staffing_2.docx`). The decisions behind it are in [`docs/PLAN.md`](docs/PLAN.md). The UI uses the Nirman design system (`docs/design/`).

## What it does

| Process step (doc)      | In the CRM                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Requirement received | Requirement form under a client (title, positions, experience, skills, budget, location, JD text/file, target date). Starts as **Draft**; marked **Open** once confirmed with the client. Owner plus assigned recruiters, who are notified.                               |
| 2. Job posting          | Posting log per requirement: platform, date, link, refresh/expiry date.                                                                                                                                                                                                   |
| 3. Sourcing             | Shared candidate database. Quick add with live **duplicate warnings** (phone, email, name + company), resume versions, Excel/CSV import, and an employee **referral link**.                                                                                               |
| 4. Screening            | A mandatory **screening card** (interest, CTC, expected CTC, notice, location, rating, remarks) before a profile can go to the client.                                                                                                                                    |
| 5. Submission           | Recruiters send profiles from their own email or WhatsApp, then **log** the submission in the CRM. A copy-ready summary table / Excel helps. The same person can never be on one requirement twice; there's a warning if the client already got them in the last 90 days. |
| 6. Client feedback      | Shortlisted / Rejected (with reason) / On hold / Feedback pending. Automatic **chase task** after the client's N working days, escalated to the owner later.                                                                                                              |
| 7–9. Interviews         | Coordination happens outside the CRM; rounds are logged (time, panel, coordinator, candidate/panel confirmed, outcome). Team calendar. **Outcome overdue** task 2 h after the slot.                                                                                       |
| 10. Decision            | Selected / Rejected / On hold / Feedback pending / Next round (unlimited numbered rounds).                                                                                                                                                                                |
| 11. Offer               | Offered CTC, offer date, expected joining date, salary discussion → released → accepted / declined.                                                                                                                                                                       |
| 12. Joining             | Weekly **notice-period check-ins**, daily in the last 3 days, a **joining-risk** flag on the dashboard. Joined / Did not join / Deferred. The requirement prompts closure when all positions are filled.                                                                  |
| After joining           | Placement with **fee** from the client's terms, **replacement-guarantee** countdown, invoice status (to raise → raised → paid). Managers only.                                                                                                                            |
| Reports                 | Recruiter productivity, requirement status, client report, drop-off reasons. All exportable to Excel.                                                                                                                                                                     |

Roles: **Admin** (users, settings) · **Manager** (everything, assignment, deletes, fees) · **Recruiter** (works requirements they own or are assigned to; no fees or deletes). Every write is audit-logged at field level, and concurrent edits are caught (optimistic locking: "Riya changed this after you opened it").

## Stack

- `apps/web`: React 19 + Vite + TypeScript, Tailwind (Nirman tokens), TanStack Query, React Router, Lucide icons
- `apps/api`: Node + Fastify + TypeScript, Drizzle ORM, PostgreSQL 16, cookie sessions (argon2 passwords, CSRF token), S3-compatible or local file storage, ExcelJS
- `packages/shared`: the stage engine, statuses, validation schemas and parsers, shared by both apps
- Tests: Vitest (unit and API integration against Postgres) and Playwright (end to end)

## Local development

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or `docker compose up -d db`).

```bash
pnpm install
cp .env.example .env                 # adjust DATABASE_URL if needed
pnpm db:migrate
pnpm --filter @crm/api exec tsx --env-file=../../.env src/db/seed.ts --demo   # sample data
pnpm dev                             # API on :3001, web on :5173
```

Sign in at http://localhost:5173 as `admin@crm.local` / `ChangeMe@123` (set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding to change this). With `--demo`, the sample team uses password `Password@123`: `anjali@demo.crm` (manager), `ravi@`, `sana@`, `mohit@demo.crm` (recruiters).

| Command                                              | What it does                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test`                                          | Unit tests + API integration tests (needs `TEST_DATABASE_URL`, default `crm_test`) |
| `pnpm test:e2e`                                      | Playwright end-to-end tests (creates and resets `crm_e2e`)                         |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                                      |
| `pnpm build`                                         | Builds the web app and bundles the API into `apps/api/dist`                        |
| `pnpm db:generate`                                   | New migration after changing `apps/api/src/db/schema.ts`                           |

## Deploying (cloud, team-only login)

The production build is a single Node process: `node apps/api/dist/main.js` serves the API and the built web app, and runs migrations on start. A `Dockerfile` is included (not yet built or tested in CI).

1. **Database:** managed PostgreSQL 16 with point-in-time recovery (e.g. Neon, Supabase, AWS RDS). Set `DATABASE_URL`.
2. **Files:** a private S3-compatible bucket (Cloudflare R2 or S3). Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Resumes are only reachable through 5-minute signed links issued after login.
3. **App:** any Node host (Render, Railway, Fly.io) behind HTTPS. Set `NODE_ENV=production`, `SESSION_SECRET` (32+ random characters), `TZ=Asia/Kolkata`.
4. **First admin:** run `node apps/api/dist/seed.js` once with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The admin then adds the team under Settings → Users. There is no public sign-up.
5. **Backups:** rely on the provider's point-in-time recovery, plus a nightly `pg_dump` to the bucket.

## Migrating from Excel

Candidates → Import Excel. Upload the tracker (.xlsx or .csv), check the auto-matched columns (Name, Mobile, Email, Company, Experience, CTC, Notice, Skills, Recruiter, Date…), review the dry run (duplicates and errors are flagged, nothing is saved yet), then import. Skipped rows can be downloaded as a spreadsheet, fixed and re-imported.

## Repository layout

```
apps/api       Fastify API (routes/, lib/ for audit, locking, pipeline, storage; automation/ for reminders)
apps/web       React app (pages/, features/ApplicationDrawer.tsx is where each candidate × requirement is worked)
packages/shared  Stage engine, enums, zod schemas, parsers
e2e            Playwright tests
docs           Plan, process doc, design system, user guide
```
