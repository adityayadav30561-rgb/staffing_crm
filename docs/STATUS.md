# Status

**Current phase:** P1 — Go live on free hosting
**Branch:** `claude/recruitment-crm-design-jcl6q8` (merge to `main` before deploying; Render deploys `main`)

## Phases

| Phase | Goal                                                                                                      | State                               |
| ----- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P0    | Build everything in `docs/PLAN.md` (all modules, tests, CI)                                               | ✅ Done (22 Oct 2026)               |
| P1    | Go live: accounts, deploy, first admin, team logins, smoke test                                           | ⏳ Waiting on owner (see checklist) |
| P2    | Pilot: import the real Excel tracker, enter clients, team uses it for 1–2 weeks, collect feedback         | Not started                         |
| P3    | Fixes from pilot feedback + hardening: nightly backup to the bucket, error monitoring, restore drill      | Not started                         |
| P4+   | "Later" features, one per phase: AI JD pre-fill, AI resume parsing, email/WhatsApp sending, calendar sync | Not started                         |

## P1 checklist

Owner (before the session; see `docs/DEPLOY.md`):

- [ ] Neon account and project; copy the connection string
- [ ] File storage bucket (Backblaze B2 or Cloudflare R2); bucket name, endpoint, region, key ID, secret
- [ ] Render account connected to GitHub
- [ ] cron-job.org account (keep-alive ping)
- [ ] Team list: name, work email, role (admin/manager/recruiter) for each person
- [ ] Sample of the real Excel tracker (for P2)
- [ ] Merge the branch to `main` (ask Claude to open the PR)

Claude (in the session):

- [ ] Open a PR to `main` and confirm CI is green
- [ ] Walk the owner through the Render Blueprint and env vars
- [ ] Smoke-test the live URL: login, create a client/requirement, upload a resume, check reminders run
- [ ] Record the live URL and anything non-obvious in `docs/DEPLOY.md`

## Known gaps / decisions pending

- Dockerfile is untested (no Docker in the dev environment); Render uses the native Node build instead.
- On Render's free plan the app sleeps after 15 min idle; the cron-job.org ping keeps it awake. Reminders are date-based, so after a sleep they catch up rather than get lost.
- Neon free tier keeps only a short restore history, so P3 adds a nightly `pg_dump` backup.

## Session log (newest first, one line each)

- 22 Oct 2026: P0 complete. Process walkthrough → plan → full build (API, web, tests). Added boot-time seeding of the first admin and default lists, path-style S3 option, `render.yaml`, these docs.
