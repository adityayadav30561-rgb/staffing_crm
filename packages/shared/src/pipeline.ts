// Application stage engine: which stages and statuses exist, which moves are allowed,
// and which data a move requires. The API enforces it; the web app uses it to drive the UI.
import type { LookupKind } from './enums';

export const STAGES = [
  'sourced',
  'screening',
  'submitted',
  'interview',
  'offer',
  'joining',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  sourced: 'Sourced',
  screening: 'Screening',
  submitted: 'Submitted',
  interview: 'Interview',
  offer: 'Offer',
  joining: 'Joining',
};

export const APP_STATUSES = [
  // sourced (doc step 3)
  'contacted',
  'interested',
  'not_interested',
  'not_reachable',
  // screening (doc step 4)
  'screening_pending',
  'screened_ok',
  'internally_rejected',
  // submitted (doc steps 5-6)
  'feedback_pending',
  'client_shortlisted',
  'client_rejected',
  'client_on_hold',
  // interview (doc steps 7-10)
  'interviewing',
  'decision_pending',
  'decision_on_hold',
  'selected',
  'interview_rejected',
  // offer (doc step 11)
  'negotiation',
  'offer_released',
  'offer_accepted',
  'offer_declined',
  // joining (doc step 12)
  'awaiting_doj',
  'joining_deferred',
  'joined',
  'did_not_join',
  // any stage
  'withdrawn',
  'requirement_cancelled',
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const STATUS_LABELS: Record<AppStatus, string> = {
  contacted: 'Contacted',
  interested: 'Interested',
  not_interested: 'Not interested',
  not_reachable: 'Not reachable',
  screening_pending: 'Screening pending',
  screened_ok: 'Screened OK',
  internally_rejected: 'Internally rejected',
  feedback_pending: 'Feedback pending',
  client_shortlisted: 'Client shortlisted',
  client_rejected: 'Client rejected',
  client_on_hold: 'On hold',
  interviewing: 'Interviewing',
  decision_pending: 'Feedback pending',
  decision_on_hold: 'On hold',
  selected: 'Selected',
  interview_rejected: 'Rejected',
  negotiation: 'Salary discussion',
  offer_released: 'Offer released',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  awaiting_doj: 'Awaiting joining',
  joining_deferred: 'Joining deferred',
  joined: 'Joined',
  did_not_join: 'Did not join',
  withdrawn: 'Withdrawn',
  requirement_cancelled: 'Client cancelled requirement',
};

/** Statuses that belong to each stage (besides the any-stage terminal ones). */
export const STAGE_STATUSES: Record<Stage, AppStatus[]> = {
  sourced: ['contacted', 'interested', 'not_interested', 'not_reachable'],
  screening: ['screening_pending', 'screened_ok', 'internally_rejected'],
  submitted: ['feedback_pending', 'client_shortlisted', 'client_rejected', 'client_on_hold'],
  interview: [
    'interviewing',
    'decision_pending',
    'decision_on_hold',
    'selected',
    'interview_rejected',
  ],
  offer: ['negotiation', 'offer_released', 'offer_accepted', 'offer_declined'],
  joining: ['awaiting_doj', 'joining_deferred', 'joined', 'did_not_join'],
};

export const ANY_STAGE_STATUSES: AppStatus[] = ['withdrawn', 'requirement_cancelled'];

/** Status an application lands on when it enters a stage. */
export const STAGE_ENTRY_STATUS: Record<Stage, AppStatus> = {
  sourced: 'contacted',
  screening: 'screening_pending',
  submitted: 'feedback_pending',
  interview: 'interviewing',
  offer: 'negotiation',
  joining: 'awaiting_doj',
};

/** Status that must be reached before the application may move to the next stage. */
export const STAGE_GATE: Partial<Record<Stage, AppStatus>> = {
  sourced: 'interested',
  screening: 'screened_ok',
  submitted: 'client_shortlisted',
  interview: 'selected',
  offer: 'offer_accepted',
};

/** Terminal statuses close the application. `joined` is the only successful one. */
export const CLOSED_STATUSES: AppStatus[] = [
  'not_interested',
  'internally_rejected',
  'client_rejected',
  'interview_rejected',
  'offer_declined',
  'joined',
  'did_not_join',
  'withdrawn',
  'requirement_cancelled',
];

/** Closing statuses that need a reason, and the lookup list the reason comes from. */
export const REASON_KIND_FOR_STATUS: Partial<Record<AppStatus, LookupKind>> = {
  not_interested: 'reason_not_interested',
  internally_rejected: 'reason_internal_reject',
  client_rejected: 'reason_client_reject',
  interview_rejected: 'reason_interview_reject',
  offer_declined: 'reason_offer_declined',
  did_not_join: 'reason_did_not_join',
  withdrawn: 'reason_withdrawn',
};

/** Statuses reached through a client response to a submission (feeds avg. feedback time). */
export const CLIENT_FEEDBACK_STATUSES: AppStatus[] = [
  'client_shortlisted',
  'client_rejected',
  'client_on_hold',
];

export const isClosed = (s: AppStatus) => CLOSED_STATUSES.includes(s);
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

export function stageOfStatus(status: AppStatus): Stage | null {
  for (const stage of STAGES) if (STAGE_STATUSES[stage].includes(status)) return stage;
  return null;
}

export interface ScreeningCard {
  interested: boolean;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticeDays: number | null;
  noticeNegotiable: boolean;
  currentLocation: string;
  willingToRelocate: boolean;
  skillRating: number | null; // 1-5
  remarks: string;
}

/** Fields of the screening card that must be filled before a profile goes to the client. */
export function missingScreeningFields(card: Partial<ScreeningCard> | null | undefined): string[] {
  const missing: string[] = [];
  if (!card)
    return [
      'interested',
      'currentCtc',
      'expectedCtc',
      'noticeDays',
      'currentLocation',
      'skillRating',
      'remarks',
    ];
  if (card.interested !== true) missing.push('interested');
  if (card.currentCtc == null) missing.push('currentCtc');
  if (card.expectedCtc == null) missing.push('expectedCtc');
  if (card.noticeDays == null) missing.push('noticeDays');
  if (!card.currentLocation?.trim()) missing.push('currentLocation');
  if (card.skillRating == null) missing.push('skillRating');
  if (!card.remarks?.trim()) missing.push('remarks');
  return missing;
}

export interface MoveContext {
  screening?: Partial<ScreeningCard> | null;
  /** True when the application has a submission logged (date + channel). */
  hasSubmission?: boolean;
  /** True when an offer record with expected DOJ exists. */
  hasOfferWithDoj?: boolean;
  reasonId?: number | null;
}

export type MoveCheck = { ok: true } | { ok: false; error: string };

/**
 * Validates moving an application from (fromStage, fromStatus) to (toStage, toStatus).
 * Rules:
 *  - within a stage, any status of that stage is allowed;
 *  - forward by exactly one stage, only from that stage's gate status, landing on the entry status;
 *  - backward to any earlier stage (correcting mistakes), landing on that stage's entry status;
 *  - withdrawn / requirement_cancelled are allowed from anywhere;
 *  - closing statuses with a reason list need a reason;
 *  - entering `submitted` needs a complete screening card and a logged submission;
 *  - entering `joining` needs an offer with an expected joining date.
 */
export function checkMove(
  from: { stage: Stage; status: AppStatus },
  to: { stage: Stage; status: AppStatus },
  ctx: MoveContext = {},
): MoveCheck {
  if (from.stage === to.stage && from.status === to.status) {
    return { ok: false, error: 'Nothing to change' };
  }
  const fromIdx = stageIndex(from.stage);
  const toIdx = stageIndex(to.stage);

  if (ANY_STAGE_STATUSES.includes(to.status)) {
    if (to.stage !== from.stage)
      return { ok: false, error: 'Close the application in its current stage' };
  } else if (!STAGE_STATUSES[to.stage].includes(to.status)) {
    return {
      ok: false,
      error: `"${STATUS_LABELS[to.status]}" is not a ${STAGE_LABELS[to.stage]} status`,
    };
  } else if (toIdx === fromIdx + 1) {
    const gate = STAGE_GATE[from.stage];
    if (from.status !== gate) {
      return {
        ok: false,
        error: `Move to ${STAGE_LABELS[to.stage]} only after "${STATUS_LABELS[gate!]}"`,
      };
    }
    if (to.status !== STAGE_ENTRY_STATUS[to.stage]) {
      return {
        ok: false,
        error: `New ${STAGE_LABELS[to.stage]} entries start as "${STATUS_LABELS[STAGE_ENTRY_STATUS[to.stage]]}"`,
      };
    }
  } else if (toIdx > fromIdx + 1) {
    return { ok: false, error: 'Stages cannot be skipped' };
  } else if (toIdx < fromIdx && to.status !== STAGE_ENTRY_STATUS[to.stage]) {
    return {
      ok: false,
      error: `Moving back lands on "${STATUS_LABELS[STAGE_ENTRY_STATUS[to.stage]]}"`,
    };
  }

  if (REASON_KIND_FOR_STATUS[to.status] && !ctx.reasonId) {
    return { ok: false, error: `A reason is required for "${STATUS_LABELS[to.status]}"` };
  }
  if (to.stage === 'submitted' && from.stage === 'screening') {
    const missing = missingScreeningFields(ctx.screening);
    if (missing.length)
      return { ok: false, error: `Complete the screening card first (${missing.join(', ')})` };
    if (!ctx.hasSubmission)
      return { ok: false, error: 'Log the submission (date and channel) first' };
  }
  if (to.stage === 'joining' && from.stage === 'offer' && !ctx.hasOfferWithDoj) {
    return { ok: false, error: 'Record the offer with an expected joining date first' };
  }
  return { ok: true };
}

/** Pill colours (Nirman tokens) for each status group. */
export function statusTone(
  status: AppStatus,
): 'new' | 'neutral' | 'warn' | 'info' | 'good' | 'bad' {
  if (status === 'joined' || status === 'selected' || status === 'offer_accepted') return 'good';
  if (isClosed(status)) return 'bad';
  if (['client_shortlisted', 'screened_ok', 'interested', 'offer_released'].includes(status))
    return 'info';
  if (
    [
      'feedback_pending',
      'decision_pending',
      'client_on_hold',
      'decision_on_hold',
      'joining_deferred',
      'negotiation',
    ].includes(status)
  )
    return 'warn';
  if (status === 'contacted' || status === 'screening_pending') return 'new';
  return 'neutral';
}
