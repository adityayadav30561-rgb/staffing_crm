// Request bodies shared by the API (validation) and the web app (forms).
import { z } from 'zod';
import {
  FEE_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
  INVOICE_STATUSES,
  JOINING_RISKS,
  LOOKUP_KINDS,
  PRIORITIES,
  REQUIREMENT_STATUSES,
  ROLES,
  SUBMISSION_CHANNELS,
} from './enums';
import { APP_STATUSES, STAGES } from './pipeline';

const optText = z
  .string()
  .trim()
  .max(5000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optInt = z.coerce.number().int().min(0).optional().nullable();
const optNum = z.coerce.number().min(0).optional().nullable();
const optDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || !Number.isNaN(Date.parse(v)), 'Invalid date');
export const version = z.coerce.number().int().min(1);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  password: z.string().min(10, 'At least 10 characters'),
});
export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10, 'At least 10 characters').optional(),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'At least 10 characters'),
});

export const clientSchema = z.object({
  name: z.string().trim().min(2).max(200),
  industry: optText,
  website: optText,
  city: optText,
  address: optText,
  gstin: optText,
  notes: optText,
  feeType: z.enum(FEE_TYPES).default('percent'),
  feeValue: z.coerce.number().min(0).default(8.33),
  replacementDays: z.coerce.number().int().min(0).max(365).default(90),
  feedbackChaseDays: z.coerce.number().int().min(1).max(30).default(2),
  active: z.boolean().default(true),
});
export const clientUpdateSchema = clientSchema.partial().extend({ version });

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  designation: optText,
  email: optText,
  phone: optText,
  isPrimary: z.boolean().default(false),
});

export const requirementSchema = z.object({
  clientId: z.coerce.number().int(),
  contactId: z.coerce.number().int().optional().nullable(),
  title: z.string().trim().min(2).max(200),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  expMin: optNum,
  expMax: optNum,
  budgetMin: optInt,
  budgetMax: optInt,
  skills: z.array(z.string().trim().min(1)).default([]),
  location: optText,
  workMode: z.enum(['onsite', 'hybrid', 'remote']).optional().nullable(),
  jdText: optText,
  priority: z.enum(PRIORITIES).default('normal'),
  targetDate: optDate,
  notes: optText,
});
export const requirementUpdateSchema = requirementSchema
  .partial()
  .extend({ version, status: z.enum(REQUIREMENT_STATUSES).optional() });
export const requirementStatusSchema = z.object({
  version,
  status: z.enum(REQUIREMENT_STATUSES),
  note: optText,
});
export const assigneesSchema = z.object({ userIds: z.array(z.number().int()) });

export const postingSchema = z.object({
  platform: z.string().trim().min(1).max(80),
  postedOn: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  url: optText,
  expiresOn: optDate,
  notes: optText,
});

export const candidateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: optText,
  altPhone: optText,
  email: optText,
  currentCompany: optText,
  currentTitle: optText,
  totalExp: optNum,
  currentCtc: optInt,
  expectedCtc: optInt,
  noticeDays: optInt,
  location: optText,
  preferredLocations: optText,
  skills: z.array(z.string().trim().min(1)).default([]),
  qualification: optText,
  source: optText,
  linkedinUrl: optText,
  notes: optText,
  dob: optDate,
});
export const candidateUpdateSchema = candidateSchema.partial().extend({ version });

export const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const screeningSchema = z.object({
  interested: z.boolean(),
  currentCtc: optInt,
  expectedCtc: optInt,
  noticeDays: optInt,
  noticeNegotiable: z.boolean().default(false),
  currentLocation: z.string().trim().max(200).default(''),
  willingToRelocate: z.boolean().default(false),
  skillRating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  remarks: z.string().trim().max(5000).default(''),
});

export const applicationCreateSchema = z.object({
  candidateId: z.coerce.number().int(),
  requirementId: z.coerce.number().int(),
  stage: z.enum(['sourced', 'screening']).default('sourced'),
  /** Set after the recruiter has seen the same-client warning. */
  acknowledgeClientDuplicate: z.boolean().default(false),
});

export const submissionSchema = z.object({
  submittedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  channel: z.enum(SUBMISSION_CHANNELS),
  resumeId: z.coerce.number().int().optional().nullable(),
  note: optText,
  acknowledgeClientDuplicate: z.boolean().default(false),
});

export const moveSchema = z.object({
  version,
  stage: z.enum(STAGES),
  status: z.enum(APP_STATUSES),
  reasonId: z.coerce.number().int().optional().nullable(),
  note: optText,
});

export const joiningRiskSchema = z.object({
  version,
  risk: z.enum(JOINING_RISKS).nullable(),
  note: optText,
});

export const interviewSchema = z.object({
  label: optText,
  mode: z.enum(INTERVIEW_MODES).default('video'),
  scheduledAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  durationMins: z.coerce.number().int().min(5).max(600).default(60),
  panel: optText,
  location: optText,
  coordinatorId: z.coerce.number().int().optional().nullable(),
  candidateConfirmed: z.boolean().default(false),
  panelConfirmed: z.boolean().default(false),
  notes: optText,
});
export const interviewUpdateSchema = interviewSchema.partial().extend({
  version,
  status: z.enum(INTERVIEW_STATUSES).optional(),
  feedback: optText,
});

export const offerSchema = z.object({
  offeredCtc: optInt,
  offerDate: optDate,
  expectedDoj: optDate,
  actualDoj: optDate,
  designation: optText,
  notes: optText,
});

export const placementUpdateSchema = z.object({
  version,
  feeAmount: optInt,
  invoiceStatus: z.enum(INVOICE_STATUSES).optional(),
  invoiceNo: optText,
  invoiceDate: optDate,
  paidOn: optDate,
  leftOn: optDate,
  notes: optText,
});

export const taskSchema = z.object({
  title: z.string().trim().min(2).max(300),
  dueAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  assigneeId: z.coerce.number().int().optional(),
  candidateId: z.coerce.number().int().optional().nullable(),
  requirementId: z.coerce.number().int().optional().nullable(),
  applicationId: z.coerce.number().int().optional().nullable(),
  notes: optText,
});

export const lookupSchema = z.object({
  kind: z.enum(LOOKUP_KINDS),
  label: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
});

export const settingsSchema = z.object({
  offDays: z.array(z.number().int().min(0).max(6)).default([0]),
  clientDuplicateWindowDays: z.coerce.number().int().min(0).max(730).default(90),
  feedbackEscalationDays: z.coerce.number().int().min(1).max(30).default(5),
  interviewOutcomeGraceHours: z.coerce.number().int().min(0).max(72).default(2),
  noticeCheckinIntervalDays: z.coerce.number().int().min(1).max(30).default(7),
  noticeDailyWindowDays: z.coerce.number().int().min(0).max(14).default(3),
  guaranteeReminderDays: z.coerce.number().int().min(0).max(60).default(7),
  rules: z
    .object({
      chase_feedback: z.boolean().default(true),
      escalate_feedback: z.boolean().default(true),
      interview_outcome: z.boolean().default(true),
      notice_checkin: z.boolean().default(true),
      confirm_joining: z.boolean().default(true),
      guarantee_expiry: z.boolean().default(true),
    })
    .default({}),
});
export type Settings = z.infer<typeof settingsSchema>;

export const referralSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(6).max(30),
  email: optText,
  currentCompany: optText,
  currentTitle: optText,
  totalExp: optNum,
  location: optText,
  skills: z.string().trim().max(1000).optional().default(''),
  message: optText,
  // honeypot: real users leave it empty
  website: z.string().max(0).optional().default(''),
});

export const importMappingSchema = z.object({
  mapping: z.record(z.string(), z.string()), // CRM field -> sheet column header
  defaultSource: optText,
});
export const importCommitSchema = importMappingSchema.extend({
  /** Row numbers (1-based data rows) to import even though they look like duplicates. */
  includeDuplicates: z.array(z.number().int()).default([]),
});

export type ClientInput = z.infer<typeof clientSchema>;
export type RequirementInput = z.infer<typeof requirementSchema>;
export type CandidateInput = z.infer<typeof candidateSchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
