# Recruitment CRM — Final Plan

## Context

A 2–5 person recruitment team (permanent placements) currently runs hiring on Excel. We are building an internal, login-only web app (about 500 candidates to start, no hard limit). All recruiters share one live dataset. Several recruiters can work the same requirement without double-submitting. Follow-ups (client feedback, interviews, notice periods) become automatic tasks instead of living in people's heads.

The process comes from **Staffing_2.docx** (12 steps, with their status lists used verbatim). The UI follows the **Nirman design system** (tokens.css/json, design-system.html, crm-screens.html), re-skinned from a sales CRM to recruitment.

The repo `staffing_crm` is empty. Work happens on branch `claude/recruitment-crm-design-jcl6q8`.

Guiding rule from the walkthrough: **coordination with clients and candidates happens outside the CRM (email, WhatsApp, phone); the CRM is the shared log, the tracker and the reminder engine.** The CRM sends no outbound email or WhatsApp in v1.

---

## Decisions from the process walkthrough

| Doc step                  | Decision                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Basics                    | Permanent placement. Cloud-hosted, employee login only, no public sign-up. PostgreSQL. Roles: **Admin / Manager / Recruiter**.                                                                                                                                                                                                                                                 |
| Client setup              | Company record plus **multiple contacts** (HR SPOC, hiring managers). Each requirement links to a contact. Fee terms on the client: % of CTC or fixed amount, replacement period in days, feedback-chase days (default 2).                                                                                                                                                     |
| 1. Requirement received   | **Manual form** (title, positions, experience range, skills, budget, location, JD text or file, target date, priority). AI pre-fill from the JD comes in a later phase. Status **Draft → Open** via a toggle once confirmed with the client by phone. Then On Hold / Filled / Closed / Client Cancelled.                                                                       |
| Assignment                | **Any recruiter can create a requirement and becomes its owner.** The manager or owner assigns more recruiters. Assignees get an in-app notification and a task.                                                                                                                                                                                                               |
| 2. Job posting            | **Posting log only**, per requirement: platform, date posted, link, refresh/expiry date.                                                                                                                                                                                                                                                                                       |
| 3. Sourcing               | **Quick-add form plus resume upload**, **bulk Excel/CSV import** (column mapping, duplicate preview, dry run) and an **employee referral link** (source = "Referral – name"). AI resume parsing comes later.                                                                                                                                                                   |
| Duplicates                | **Candidate duplicates only warn**: matches on phone, email, or name + company are shown, and the recruiter may still create the record. **Shared candidate pool**, with "Sourced by" shown on the candidate and "Submitted by" on each application for credit. **Hard block** on the same candidate twice in the same requirement.                                            |
| 4. Screening              | **Mandatory screening card before Submit**: interested, current CTC, expected CTC, notice period (and whether it's negotiable), location or willing to relocate, skill rating, remarks.                                                                                                                                                                                        |
| 5. Submission             | **Recruiter sends outside the CRM, then clicks "Mark submitted"** (date, channel, resume version). **Export summary table** (copy or XLSX) for the client email. Original resume, no masking. **Warning if the same candidate went to the same client in the last 90 days**, showing the earlier outcome.                                                                      |
| 6. Client feedback        | Feedback Pending / Client Shortlisted / Client Rejected (with reason) / On Hold. **Auto "Chase feedback" task after N working days** (set per client, default 2). Escalates to the requirement owner at 5 days.                                                                                                                                                                |
| 7–8. Scheduling & line-up | **Logged only**: round, mode, date and time, panel, coordinator, "candidate confirmed" and "panel confirmed" checkboxes. Interviews appear on the team calendar and in timelines.                                                                                                                                                                                              |
| 9. Interview status       | Completed / Cancelled / Candidate No-Show / Panel No-Show / Rescheduled / Pending. **If no outcome is recorded 2 hours after the slot: red flag plus "Update outcome" task.**                                                                                                                                                                                                  |
| 10. Decision              | Selected / Rejected / On Hold / Feedback Pending / **Next Round**, which creates a new numbered round (unlimited, with an optional label).                                                                                                                                                                                                                                     |
| 11. Offer                 | Offered CTC, offer date, expected joining date, status (Negotiation / Released / Accepted / Declined).                                                                                                                                                                                                                                                                         |
| 12. Joining               | **Weekly check-in tasks until the joining date, daily for the last 3 days. "Joining risk" flag** (counter-offer, other offer, no response) shown on the dashboard. Final status: Joined / Offer Declined / Did Not Join / Joining Deferred. The client-cancelled option closes all open applications at once. The CRM suggests closing the requirement when filled = openings. |
| Post-joining              | **Fee calculated on Joined. Replacement-guarantee countdown. Invoice status**: To raise → Raised → Paid (invoices themselves are made in Tally or similar). Fees are hidden from recruiters.                                                                                                                                                                                   |
| Reports (day one)         | Recruiter productivity · Requirement status / funnel · Client report · Drop-off reasons.                                                                                                                                                                                                                                                                                       |

---

## Navigation (Nirman sidebar)

- **Main:** Dashboard · My Tasks (count badge) · Calendar
- **Recruitment:** Clients · Requirements (list + per-requirement kanban) · Candidates · Pipeline (all applications, filterable by stage; replaces separate Submissions/Interviews/Offers/Joining pages)
- **Management:** Reports · Placements & Invoices (Manager+) · Activity & Audit (Manager+)
- **Settings (Admin):** Users & Roles · Rejection/drop reasons · Sources · Defaults · Import

Detail pages use the list + right detail panel (320px) layout from crm-screens.html. Notes, screening, submissions, interviews and timeline sit inside the candidate and application panels, not on separate pages.

## Data model (PostgreSQL)

`users` (role, active) · `clients` (fee_type, fee_value, replacement_days, feedback_chase_days) · `client_contacts` · `requirements` (client_id, contact_id, owner_id, status, openings, filled_count derived, exp_min/max, budget_min/max, skills[], location, jd_text, jd_file, priority, target_date, version) · `requirement_assignees` (requirement_id, user_id) · `job_postings` · `candidates` (name, phone_e164, email, current_company, title, total_exp, current_ctc, expected_ctc, notice_days, location, skills[], source, referred_by, sourced_by, version) · `resumes` (candidate_id, storage_key, version, uploaded_by) · `applications` (**UNIQUE(candidate_id, requirement_id)**, stage, sub_status, screening jsonb, submitted_at/by, resume_id, reject_reason_id, joining_risk, version) · `interviews` (application_id, round_no, label, mode, scheduled_at, panel, coordinator_id, candidate_confirmed, panel_confirmed, status, feedback) · `offers` (application_id, offered_ctc, offer_date, expected_doj, actual_doj, status) · `placements` (application_id, fee_amount, guarantee_until, invoice_status, invoice_no, paid_at) · `tasks` (type, assignee_id, due_at, related entity, auto_rule, done_at) · `notifications` · `activities` (business timeline, actor, entity, verb, payload) · `audit_logs` (field-level before/after) · `reasons` (configurable) · `settings`.

Indexes: trigram indexes on candidate name/company for search; indexes on phone_e164 and email, used for duplicate warnings but not unique.

## Architecture

- **Monorepo** (pnpm workspaces): `apps/web` (React + Vite + TS, Tailwind with Nirman tokens, shadcn/ui restyled, TanStack Query + Router, react-hook-form), `apps/api` (Node + TS + Fastify, Drizzle ORM, zod), `packages/shared` (zod schemas, the stage/status enums, transition rules, so the same validation runs on both sides).
- **Stage engine** in `packages/shared/pipeline.ts`: allowed transitions and required fields per transition (e.g. Submit needs the screening card). The API applies each stage move as one transaction: update the application, write the activity, write the audit row, create or close auto-tasks.
- **Auto-tasks** run as **pg-boss** jobs (Postgres-backed, no Redis): chase feedback, interview outcome overdue, notice check-ins, guarantee expiry. Rules can be switched off in Settings.
- **Concurrency:** a `version` column with optimistic locking. A conflicting save returns 409 and the UI shows "X changed this 2 min ago — reload / compare".
- **Auth:** email + password (argon2), httpOnly secure session cookie stored in Postgres, CSRF token, login rate-limit. Admin creates users, no sign-up. Google Workspace SSO optional later.
- **Files:** S3-compatible private bucket (Cloudflare R2 or S3); resumes are served through short-lived signed URLs after a permission check.
- **Hosting:** one Node service serving the API and the built SPA (Render, Railway or Fly), Postgres on Neon or Supabase (point-in-time recovery), plus a nightly `pg_dump` to the bucket. Exact providers are confirmed at Phase 7.

---

## Phased implementation (each phase is shippable and tested before the next)

**Phase 0 — Foundation.** Monorepo, lint/format/typecheck, CI (GitHub Actions), Docker Compose Postgres for local dev, Drizzle migrations, seed script with Indian sample data. Nirman tokens in the Tailwind config; app shell with sidebar, top bar, search, detail panel; base components (Button, Pill/StatusChip, KPI tile, Table, Avatar, Task row, Drawer, Form fields, Toast).
_Accept:_ `pnpm dev` runs; the shell matches crm-screens.html visually; CI is green.

**Phase 1 — Auth, users, roles, audit core.** Login/logout, sessions, Admin user management, role guard middleware, `activities` and `audit_logs` writers, optimistic-lock helper.
_Accept:_ the three roles see the correct menus and API 403s; every write produces an audit row.

**Phase 2 — Clients & Requirements.** Client CRUD with contacts and fee terms. Requirement form, Draft/Open/On Hold/Filled/Closed/Cancelled, owner and assignees, posting log, requirement list with filters, in-app notifications for assignment.
_Accept:_ create client → requirement → assign two recruiters; both see it, and the timeline shows who did what.

**Phase 3 — Candidates & Import.** Quick-add with live duplicate warning, resume upload/versioning (signed URLs), candidate list with search and filters, candidate profile (details, resumes, notes, timeline, applications). **Excel/CSV import wizard** (upload → map columns → validate → duplicate preview → commit, with an error report XLSX) plus candidate export. Referral link page.
_Accept:_ the HR team's current tracker imports cleanly in a dry run; duplicates are flagged; 500 rows import in under 10 seconds.

**Phase 4 — Pipeline core (doc steps 3–6).** Map candidates to a requirement (application, with the hard-unique guard), stage engine, screening card, "Mark submitted" plus the same-client 90-day warning, summary-table export, client feedback statuses with reasons, requirement kanban (drag between stages, with transition validation), global Pipeline view.
_Accept:_ two recruiters can't create the same application; Submit is blocked without screening; the warning fires on a same-client resubmit; concurrent edits produce a 409, not silent overwrites.

**Phase 5 — Interviews, Offers, Joining, Placements (doc steps 7–12).** Interview rounds, line-up checkboxes, outcome statuses, Next Round, team Calendar (week/month). Offer record, joining statuses, joining-risk flag, filled-count update and close suggestion, client-cancel bulk close. Placement fee calculation, guarantee countdown, invoice status (Manager+).
_Accept:_ full happy path, from requirement to Joined, updates filled count and creates the placement; Did Not Join reopens the slot.

**Phase 6 — Tasks, automation, Dashboard, Reports.** My Tasks (manual plus auto), pg-boss rules (chase feedback, outcome overdue, notice check-ins, guarantee expiry), notification bell. Role-aware dashboard (KPI tiles: open positions, submissions this week, interviews today, joinings due; my tasks; awaiting feedback; joining risks). The four reports, with date range and recruiter filters, exported to XLSX.
_Accept:_ time-travel tests prove each auto-task fires on schedule and closes when the condition clears; report numbers match seeded fixtures.

**Phase 7 — Hardening & go-live.** Security pass (rate limits, headers, file-type checks, permission tests), backups and a restore drill, error tracking (Sentry), deploy to the chosen cloud, the real Excel migration, a short user guide.

**Later:** AI JD pre-fill and resume parsing, email/WhatsApp sending from the CRM, Google/Outlook calendar sync, shared-mailbox intake, resume masking or branded cover page, Google SSO, contract-staffing module.

## Verification

- **Unit (Vitest):** stage-transition rules, duplicate matching and phone normalisation, fee calculation, auto-task scheduling rules.
- **API integration (Vitest + test Postgres):** unique-application constraint, 409 on stale version, role permissions per endpoint, audit rows on writes.
- **E2E (Playwright, pre-installed Chromium):** login as each role; Phase 4 flow with two recruiter sessions racing to submit the same candidate; the full requirement → Joined journey; import wizard with a sample XLSX.
- **Visual check:** screenshots of the Dashboard, Requirements, Candidates and Pipeline screens compared against crm-screens.html for tokens and spacing.
- CI runs lint, typecheck, unit, integration and E2E on every push.

---

## Implementation status (22 Oct 2026)

Phases 0–6 are built and tested on branch `claude/recruitment-crm-design-jcl6q8`. Phase 7 is partly done: security basics, Docker/CI and the user guide are in place; choosing hosting, the real Excel migration and a restore drill still need your input.

Where the build differs from the plan, and why:

| Plan              | Built                                                                                                                 | Why                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss job queue | In-process sweep every 5 min, plus a quick re-run after relevant changes; idempotent via a unique `auto_key` on tasks | The rules are conditions ("still pending after N days"), not one-off jobs. A sweep also closes tasks when the condition clears. No extra moving part. |
| shadcn/ui         | Small hand-built components in `apps/web/src/components/ui.tsx`                                                       | The Nirman look (pills, hairlines, tints) needed restyling anyway; fewer dependencies.                                                                |
| TanStack Router   | React Router 7                                                                                                        | Simpler for this size of app.                                                                                                                         |
| TypeScript latest | Pinned to TypeScript 6                                                                                                | typescript-eslint does not support TS 7 yet.                                                                                                          |

Still open, decided later with the team:

- Hosting provider (Render / Railway / Fly + Neon or Supabase + R2) and a restore drill.
- Import of the real Excel tracker (dry run first).
- "Later" items: AI JD/resume parsing, email/WhatsApp sending, calendar sync, mailbox intake, resume masking, Google SSO, contract staffing.

Verification today: 21 shared unit tests, 17 API integration tests (including two recruiters racing to submit the same candidate, stale-edit protection, and every auto-task rule with simulated dates) and 3 Playwright end-to-end flows all pass; lint, format and type checks are clean.
