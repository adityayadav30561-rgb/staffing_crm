// Shapes returned by the API (kept loose where the UI only reads a few fields).
import type {
  AppStatus,
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
  FeeType,
} from '@crm/shared';

export interface User {
  id: number;
  name: string;
  email?: string;
  role: Role;
  active: boolean;
  referralCode?: string;
  lastLoginAt?: string | null;
}

export interface TimelineItem {
  id: number;
  summary: string;
  verb: string;
  createdAt: string;
  actorName: string | null;
}

export interface Contact {
  id: number;
  clientId: number;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface Client {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  city: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  feeType?: FeeType;
  feeValue?: number;
  replacementDays: number;
  feedbackChaseDays: number;
  active: boolean;
  version: number;
  openRequirements?: number;
  openPositions?: number;
}

export interface Requirement {
  id: number;
  code: string;
  clientId: number;
  contactId: number | null;
  ownerId: number;
  title: string;
  status: RequirementStatus;
  openings: number;
  expMin: number | null;
  expMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  skills: string[];
  location: string | null;
  workMode: 'onsite' | 'hybrid' | 'remote' | null;
  jdText: string | null;
  jdFileName: string | null;
  priority: Priority;
  targetDate: string | null;
  notes: string | null;
  openedAt: string | null;
  createdAt: string;
  version: number;
  clientName?: string;
  ownerName?: string;
  filled: number;
  assignees: { id: number; name: string }[];
  stageCounts: Record<Stage, number>;
  lastActivityAt?: string | null;
}

export interface Posting {
  id: number;
  platform: string;
  postedOn: string;
  url: string | null;
  expiresOn: string | null;
  notes: string | null;
  postedByName: string | null;
}

export interface RequirementDetail extends Requirement {
  client: Client;
  contact: Contact | null;
  owner: { id: number; name: string };
  postings: Posting[];
  timeline: TimelineItem[];
  canWork: boolean;
  canAssign: boolean;
  jdFileUrl: string | null;
}

export interface Candidate {
  id: number;
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  totalExp: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticeDays: number | null;
  location: string | null;
  preferredLocations: string | null;
  skills: string[];
  qualification: string | null;
  source: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  dob: string | null;
  sourcedByName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  activeApps?: number;
}

export interface Resume {
  id: number;
  fileName: string;
  versionNo: number;
  sizeBytes: number;
  createdAt: string;
  uploadedByName?: string | null;
}

export interface Note {
  id: number;
  body: string;
  createdAt: string;
  authorName: string | null;
}

export interface CandidateApplication {
  id: number;
  stage: Stage;
  status: AppStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  closedAt: string | null;
  updatedAt: string;
  requirementId: number;
  requirementTitle: string;
  requirementCode: string;
  clientId: number;
  clientName: string;
}

export interface CandidateDetail extends Candidate {
  resumes: Resume[];
  applications: CandidateApplication[];
  noteEntries: Note[];
  timeline: TimelineItem[];
}

export interface DuplicateMatch {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  currentCompany: string | null;
  sourcedByName: string | null;
  createdAt: string;
  reasons: ('phone' | 'email' | 'name_company')[];
}

export interface ApplicationRow {
  id: number;
  candidateId: number;
  requirementId: number;
  stage: Stage;
  status: AppStatus;
  screening: ScreeningCard | null;
  submittedAt: string | null;
  closedAt: string | null;
  joiningRisk: JoiningRisk | null;
  joiningRiskNote: string | null;
  updatedAt: string;
  stageChangedAt: string;
  version: number;
  candidateName: string;
  candidatePhone: string | null;
  candidateCompany: string | null;
  candidateTitle: string | null;
  totalExp: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticeDays: number | null;
  requirementTitle: string;
  requirementCode: string;
  clientId: number;
  clientName: string;
  submittedByName: string | null;
  addedByName: string | null;
  nextInterviewAt: string | null;
  roundCount: number;
  expectedDoj: string | null;
  reasonLabel: string | null;
}

export interface Interview {
  id: number;
  applicationId: number;
  roundNo: number;
  label: string | null;
  mode: InterviewMode;
  scheduledAt: string;
  durationMins: number;
  panel: string | null;
  location: string | null;
  coordinatorId: number | null;
  coordinatorName?: string | null;
  candidateConfirmed: boolean;
  panelConfirmed: boolean;
  status: InterviewStatus;
  feedback: string | null;
  notes: string | null;
  version: number;
}

export interface Offer {
  id: number;
  offeredCtc: number | null;
  offerDate: string | null;
  expectedDoj: string | null;
  actualDoj: string | null;
  designation: string | null;
  notes: string | null;
}

export interface Placement {
  id: number;
  applicationId: number;
  joinedOn: string;
  feeAmount?: number;
  guaranteeUntil: string;
  invoiceStatus?: InvoiceStatus;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  paidOn?: string | null;
  leftOn?: string | null;
  notes?: string | null;
  version?: number;
}

export interface ApplicationDetail {
  id: number;
  candidateId: number;
  requirementId: number;
  stage: Stage;
  status: AppStatus;
  screening: ScreeningCard | null;
  screenedAt: string | null;
  screenedByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  submissionChannel: SubmissionChannel | null;
  submissionNote: string | null;
  resumeId: number | null;
  feedbackAt: string | null;
  reasonLabel: string | null;
  closedAt: string | null;
  joiningRisk: JoiningRisk | null;
  joiningRiskNote: string | null;
  addedByName: string | null;
  createdAt: string;
  version: number;
  candidate: Candidate;
  requirement: {
    id: number;
    code: string;
    title: string;
    status: RequirementStatus;
    ownerId: number;
    clientId: number;
    clientName: string;
    budgetMin: number | null;
    budgetMax: number | null;
  };
  interviews: Interview[];
  offer: Offer | null;
  placement: Placement | null;
  resumes: Resume[];
  notes: Note[];
  timeline: TimelineItem[];
  canWork: boolean;
  missingScreening: string[];
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  rule: TaskRule;
  assigneeId: number;
  assigneeName: string;
  dueAt: string;
  doneAt: string | null;
  autoClosed: boolean;
  candidateId: number | null;
  candidateName: string | null;
  requirementId: number | null;
  requirementTitle: string | null;
  applicationId: number | null;
}

export interface Lookup {
  id: number;
  kind: LookupKind;
  label: string;
  active: boolean;
  sort: number;
}

export interface Notification {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
