import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from 'drizzle-orm/pg-core';
import type {
  AppStatus,
  FeeType,
  InterviewMode,
  InterviewStatus,
  InvoiceStatus,
  JoiningRisk,
  LookupKind,
  Priority,
  RequirementStatus,
  Role,
  ScreeningCard,
  Stage,
  SubmissionChannel,
  TaskRule,
} from '@crm/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const created = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
/** Optimistic-lock version, bumped on every update. */
const versioned = { version: integer('version').notNull().default(1) };

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull().default('recruiter'),
  active: boolean('active').notNull().default(true),
  referralCode: text('referral_code').notNull().unique(),
  lastLoginAt: ts('last_login_at'),
  ...created,
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry'),
  website: text('website'),
  city: text('city'),
  address: text('address'),
  gstin: text('gstin'),
  notes: text('notes'),
  feeType: text('fee_type').$type<FeeType>().notNull().default('percent'),
  feeValue: numeric('fee_value', { precision: 12, scale: 2, mode: 'number' })
    .notNull()
    .default(8.33),
  replacementDays: integer('replacement_days').notNull().default(90),
  feedbackChaseDays: integer('feedback_chase_days').notNull().default(2),
  active: boolean('active').notNull().default(true),
  createdBy: integer('created_by').references(() => users.id),
  updatedBy: integer('updated_by').references(() => users.id),
  ...versioned,
  ...created,
});

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    designation: text('designation'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...created,
  },
  (t) => [index('client_contacts_client_idx').on(t.clientId)],
);

export const requirements = pgTable(
  'requirements',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(), // REQ-0001
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    contactId: integer('contact_id').references(() => clientContacts.id, { onDelete: 'set null' }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    status: text('status').$type<RequirementStatus>().notNull().default('draft'),
    openings: integer('openings').notNull().default(1),
    expMin: numeric('exp_min', { precision: 4, scale: 1, mode: 'number' }),
    expMax: numeric('exp_max', { precision: 4, scale: 1, mode: 'number' }),
    budgetMin: money('budget_min'),
    budgetMax: money('budget_max'),
    skills: text('skills')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    location: text('location'),
    workMode: text('work_mode').$type<'onsite' | 'hybrid' | 'remote'>(),
    jdText: text('jd_text'),
    jdFileKey: text('jd_file_key'),
    jdFileName: text('jd_file_name'),
    priority: text('priority').$type<Priority>().notNull().default('normal'),
    targetDate: date('target_date', { mode: 'string' }),
    notes: text('notes'),
    openedAt: ts('opened_at'),
    closedAt: ts('closed_at'),
    createdBy: integer('created_by').references(() => users.id),
    updatedBy: integer('updated_by').references(() => users.id),
    ...versioned,
    ...created,
  },
  (t) => [
    index('requirements_client_idx').on(t.clientId),
    index('requirements_status_idx').on(t.status),
  ],
);

export const requirementAssignees = pgTable(
  'requirement_assignees',
  {
    requirementId: integer('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    assignedBy: integer('assigned_by').references(() => users.id),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('requirement_assignees_pk').on(t.requirementId, t.userId)],
);

export const jobPostings = pgTable('job_postings', {
  id: serial('id').primaryKey(),
  requirementId: integer('requirement_id')
    .notNull()
    .references(() => requirements.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  postedOn: date('posted_on', { mode: 'string' }).notNull(),
  url: text('url'),
  expiresOn: date('expires_on', { mode: 'string' }),
  notes: text('notes'),
  postedBy: integer('posted_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const candidates = pgTable(
  'candidates',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone'), // as typed
    phoneE164: text('phone_e164'),
    altPhone: text('alt_phone'),
    email: text('email'),
    emailNorm: text('email_norm'),
    currentCompany: text('current_company'),
    currentTitle: text('current_title'),
    totalExp: numeric('total_exp', { precision: 4, scale: 1, mode: 'number' }),
    currentCtc: money('current_ctc'),
    expectedCtc: money('expected_ctc'),
    noticeDays: integer('notice_days'),
    location: text('location'),
    preferredLocations: text('preferred_locations'),
    skills: text('skills')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    qualification: text('qualification'),
    source: text('source'),
    referredBy: integer('referred_by').references(() => users.id),
    linkedinUrl: text('linkedin_url'),
    dob: date('dob', { mode: 'string' }),
    notes: text('notes'),
    sourcedBy: integer('sourced_by').references(() => users.id),
    updatedBy: integer('updated_by').references(() => users.id),
    importJobId: integer('import_job_id'),
    ...versioned,
    ...created,
  },
  (t) => [
    index('candidates_phone_idx').on(t.phoneE164),
    index('candidates_email_idx').on(t.emailNorm),
    index('candidates_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
    index('candidates_company_trgm').using('gin', sql`${t.currentCompany} gin_trgm_ops`),
  ],
);

export const resumes = pgTable(
  'resumes',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    versionNo: integer('version_no').notNull(),
    uploadedBy: integer('uploaded_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('resumes_candidate_idx').on(t.candidateId)],
);

export const candidateNotes = pgTable(
  'candidate_notes',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    applicationId: integer('application_id'),
    body: text('body').notNull(),
    authorId: integer('author_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('candidate_notes_candidate_idx').on(t.candidateId)],
);

export const applications = pgTable(
  'applications',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    requirementId: integer('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    stage: text('stage').$type<Stage>().notNull().default('sourced'),
    status: text('status').$type<AppStatus>().notNull().default('contacted'),
    screening: jsonb('screening').$type<ScreeningCard>(),
    screenedBy: integer('screened_by').references(() => users.id),
    screenedAt: ts('screened_at'),
    submittedAt: ts('submitted_at'),
    submittedBy: integer('submitted_by').references(() => users.id),
    submissionChannel: text('submission_channel').$type<SubmissionChannel>(),
    submissionNote: text('submission_note'),
    resumeId: integer('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    feedbackAt: ts('feedback_at'),
    reasonId: integer('reason_id').references(() => lookups.id),
    closedAt: ts('closed_at'),
    joiningRisk: text('joining_risk').$type<JoiningRisk>(),
    joiningRiskNote: text('joining_risk_note'),
    addedBy: integer('added_by').references(() => users.id),
    updatedBy: integer('updated_by').references(() => users.id),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    ...versioned,
    ...created,
  },
  (t) => [
    // Doc step 5: the same person can never be on one requirement twice.
    uniqueIndex('applications_candidate_requirement_uq').on(t.candidateId, t.requirementId),
    index('applications_requirement_idx').on(t.requirementId),
    index('applications_status_idx').on(t.status),
  ],
);

export const interviews = pgTable(
  'interviews',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    roundNo: integer('round_no').notNull(),
    label: text('label'),
    mode: text('mode').$type<InterviewMode>().notNull().default('video'),
    scheduledAt: ts('scheduled_at').notNull(),
    durationMins: integer('duration_mins').notNull().default(60),
    panel: text('panel'),
    location: text('location'),
    coordinatorId: integer('coordinator_id').references(() => users.id),
    candidateConfirmed: boolean('candidate_confirmed').notNull().default(false),
    panelConfirmed: boolean('panel_confirmed').notNull().default(false),
    status: text('status').$type<InterviewStatus>().notNull().default('scheduled'),
    feedback: text('feedback'),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    updatedBy: integer('updated_by').references(() => users.id),
    ...versioned,
    ...created,
  },
  (t) => [
    uniqueIndex('interviews_app_round_uq').on(t.applicationId, t.roundNo),
    index('interviews_scheduled_idx').on(t.scheduledAt),
  ],
);

export const offers = pgTable('offers', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id')
    .notNull()
    .unique()
    .references(() => applications.id, { onDelete: 'cascade' }),
  offeredCtc: money('offered_ctc'),
  offerDate: date('offer_date', { mode: 'string' }),
  expectedDoj: date('expected_doj', { mode: 'string' }),
  actualDoj: date('actual_doj', { mode: 'string' }),
  designation: text('designation'),
  notes: text('notes'),
  updatedBy: integer('updated_by').references(() => users.id),
  ...created,
});

export const placements = pgTable('placements', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id')
    .notNull()
    .unique()
    .references(() => applications.id, { onDelete: 'cascade' }),
  joinedOn: date('joined_on', { mode: 'string' }).notNull(),
  feeAmount: money('fee_amount').notNull().default(0),
  guaranteeUntil: date('guarantee_until', { mode: 'string' }).notNull(),
  invoiceStatus: text('invoice_status').$type<InvoiceStatus>().notNull().default('to_raise'),
  invoiceNo: text('invoice_no'),
  invoiceDate: date('invoice_date', { mode: 'string' }),
  paidOn: date('paid_on', { mode: 'string' }),
  leftOn: date('left_on', { mode: 'string' }),
  notes: text('notes'),
  updatedBy: integer('updated_by').references(() => users.id),
  ...versioned,
  ...created,
});

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes'),
    rule: text('rule').$type<TaskRule>().notNull().default('manual'),
    /** Idempotency key for auto-created tasks, e.g. "chase_feedback:42". */
    autoKey: text('auto_key').unique(),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => users.id),
    dueAt: ts('due_at').notNull(),
    doneAt: ts('done_at'),
    doneBy: integer('done_by').references(() => users.id),
    /** Auto tasks are closed by the system when their condition clears. */
    autoClosed: boolean('auto_closed').notNull().default(false),
    candidateId: integer('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }),
    requirementId: integer('requirement_id').references(() => requirements.id, {
      onDelete: 'cascade',
    }),
    applicationId: integer('application_id').references(() => applications.id, {
      onDelete: 'cascade',
    }),
    interviewId: integer('interview_id').references(() => interviews.id, { onDelete: 'cascade' }),
    placementId: integer('placement_id').references(() => placements.id, { onDelete: 'cascade' }),
    createdBy: integer('created_by').references(() => users.id),
    ...created,
  },
  (t) => [
    index('tasks_assignee_open_idx').on(t.assigneeId, t.doneAt),
    index('tasks_rule_idx').on(t.rule),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt)],
);

/** Business timeline: who did what, shown on records and used for productivity reports. */
export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id),
    verb: text('verb').notNull(), // e.g. app.status, candidate.created
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    clientId: integer('client_id'),
    requirementId: integer('requirement_id'),
    candidateId: integer('candidate_id'),
    applicationId: integer('application_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('activities_candidate_idx').on(t.candidateId, t.createdAt),
    index('activities_requirement_idx').on(t.requirementId, t.createdAt),
    index('activities_client_idx').on(t.clientId, t.createdAt),
    index('activities_verb_idx').on(t.verb, t.createdAt),
  ],
);

/** Field-level change log for every write. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id),
    entity: text('entity').notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action').$type<'create' | 'update' | 'delete'>().notNull(),
    changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const lookups = pgTable(
  'lookups',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').$type<LookupKind>().notNull(),
    label: text('label').notNull(),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('lookups_kind_label_uq').on(t.kind, t.label)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const importJobs = pgTable('import_jobs', {
  id: serial('id').primaryKey(),
  fileName: text('file_name').notNull(),
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
  status: text('status').$type<'uploaded' | 'committed'>().notNull().default('uploaded'),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});
