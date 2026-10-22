// Domain vocabulary. Status lists follow the team's process doc (docs/process/Staffing_2.docx).

export const ROLES = ['admin', 'manager', 'recruiter'] as const;
export type Role = (typeof ROLES)[number];

export const REQUIREMENT_STATUSES = [
  'draft',
  'open',
  'on_hold',
  'filled',
  'closed',
  'cancelled',
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  closed: 'Closed',
  cancelled: 'Client cancelled',
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const FEE_TYPES = ['percent', 'fixed'] as const;
export type FeeType = (typeof FEE_TYPES)[number];

export const INTERVIEW_MODES = ['video', 'in_person', 'phone'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  video: 'Video',
  in_person: 'In person',
  phone: 'Phone',
};

// Doc step 9
export const INTERVIEW_STATUSES = [
  'scheduled',
  'completed',
  'cancelled',
  'candidate_no_show',
  'panel_no_show',
  'rescheduled',
  'pending',
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];
export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  candidate_no_show: 'Candidate no-show',
  panel_no_show: 'Panel no-show',
  rescheduled: 'Rescheduled',
  pending: 'Outcome pending',
};
/** Interview statuses that still wait for an outcome to be logged. */
export const INTERVIEW_AWAITING_OUTCOME: InterviewStatus[] = [
  'scheduled',
  'rescheduled',
  'pending',
];

export const INVOICE_STATUSES = ['to_raise', 'raised', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  to_raise: 'To raise',
  raised: 'Raised',
  paid: 'Paid',
};

export const SUBMISSION_CHANNELS = ['email', 'whatsapp', 'portal', 'other'] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];

export const JOINING_RISKS = ['counter_offer', 'other_offer', 'no_response', 'other'] as const;
export type JoiningRisk = (typeof JOINING_RISKS)[number];
export const JOINING_RISK_LABELS: Record<JoiningRisk, string> = {
  counter_offer: 'Counter-offer',
  other_offer: 'Other offer',
  no_response: 'Not responding',
  other: 'Other',
};

export const LOOKUP_KINDS = [
  'source',
  'platform',
  'reason_not_interested',
  'reason_internal_reject',
  'reason_client_reject',
  'reason_interview_reject',
  'reason_offer_declined',
  'reason_did_not_join',
  'reason_withdrawn',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
export const LOOKUP_KIND_LABELS: Record<LookupKind, string> = {
  source: 'Candidate sources',
  platform: 'Job posting platforms',
  reason_not_interested: 'Not interested reasons',
  reason_internal_reject: 'Internal rejection reasons',
  reason_client_reject: 'Client rejection reasons',
  reason_interview_reject: 'Interview rejection reasons',
  reason_offer_declined: 'Offer declined reasons',
  reason_did_not_join: 'Did not join reasons',
  reason_withdrawn: 'Withdrawn reasons',
};

export const TASK_RULES = [
  'manual',
  'assignment',
  'chase_feedback',
  'escalate_feedback',
  'interview_outcome',
  'notice_checkin',
  'confirm_joining',
  'guarantee_expiry',
] as const;
export type TaskRule = (typeof TASK_RULES)[number];
