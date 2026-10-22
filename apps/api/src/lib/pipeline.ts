// Server side of the stage engine: applies a validated move and its side effects
// (placement, requirement fill check, activity, audit, notifications) in one transaction.
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  addDays,
  calculateFee,
  checkMove,
  CLIENT_FEEDBACK_STATUSES,
  isClosed,
  isoDate,
  REASON_KIND_FOR_STATUS,
  STAGE_LABELS,
  STATUS_LABELS,
  type AppStatus,
  type Stage,
} from '@crm/shared';
import type { Tx } from '../db';
import {
  applications,
  candidateNotes,
  candidates,
  clients,
  lookups,
  offers,
  placements,
  requirementAssignees,
  requirements,
} from '../db/schema';
import type { SessionUser } from '../app';
import { badRequest } from './errors';
import { createdChanges, logActivity, writeAudit } from './audit';
import { updateVersioned } from './lock';
import { notify } from './notify';

type AppRow = typeof applications.$inferSelect;

export interface MoveInput {
  stage: Stage;
  status: AppStatus;
  reasonId?: number | null;
  note?: string | null;
}

export async function applyMove(
  tx: Tx,
  user: SessionUser,
  before: AppRow,
  version: number,
  to: MoveInput,
): Promise<AppRow> {
  const [offer] = await tx.select().from(offers).where(eq(offers.applicationId, before.id));
  const check = checkMove(
    { stage: before.stage, status: before.status },
    { stage: to.stage, status: to.status },
    {
      screening: before.screening,
      hasSubmission: !!before.submittedAt,
      hasOfferWithDoj: !!offer?.expectedDoj,
      reasonId: to.reasonId,
    },
  );
  if (!check.ok) throw badRequest(check.error, 'INVALID_MOVE');

  const reasonKind = REASON_KIND_FOR_STATUS[to.status];
  let reasonLabel: string | null = null;
  if (reasonKind) {
    const [r] = await tx.select().from(lookups).where(eq(lookups.id, to.reasonId!));
    if (!r || r.kind !== reasonKind) throw badRequest('Pick a reason from the list');
    reasonLabel = r.label;
  }

  if (before.status === 'joined' && to.status !== 'joined') await removePlacement(tx, before.id);

  const closed = isClosed(to.status);
  const values: Partial<AppRow> = {
    stage: to.stage,
    status: to.status,
    reasonId: reasonKind ? to.reasonId! : null,
    closedAt: closed ? new Date() : null,
  };
  if (to.stage !== before.stage) values.stageChangedAt = new Date();
  if (CLIENT_FEEDBACK_STATUSES.includes(to.status) && !before.feedbackAt) values.feedbackAt = new Date();
  if (closed) {
    values.joiningRisk = null;
    values.joiningRiskNote = null;
  }
  const row = await updateVersioned<AppRow>(tx, applications, 'application', before.id, version, values, user.id);

  const ctx = await appContext(tx, row);
  const label = STATUS_LABELS[to.status];
  const stageNote = to.stage !== before.stage ? ` (moved to ${STAGE_LABELS[to.stage]})` : '';
  await logActivity(tx, {
    actorId: user.id,
    verb: 'app.status',
    summary: `${ctx.candidateName}: ${label}${reasonLabel ? ` — ${reasonLabel}` : ''}${stageNote} · ${ctx.requirementTitle}`,
    payload: { fromStage: before.stage, fromStatus: before.status, toStage: to.stage, toStatus: to.status, reason: reasonLabel },
    candidateId: row.candidateId,
    requirementId: row.requirementId,
    clientId: ctx.clientId,
    applicationId: row.id,
  });
  if (to.note) {
    await tx.insert(candidateNotes).values({ candidateId: row.candidateId, applicationId: row.id, body: to.note, authorId: user.id });
  }

  const team = await requirementTeam(tx, row.requirementId);
  const link = `/requirements/${row.requirementId}?app=${row.id}`;
  if (to.status === 'selected' || to.status === 'offer_accepted') {
    await notify(tx, team, { title: `${ctx.candidateName} — ${label}`, body: ctx.requirementTitle, link }, user.id);
  }
  if (to.status === 'joined') {
    await createPlacement(tx, user, row, offer ?? null);
    await notify(tx, team, { title: `${ctx.candidateName} joined`, body: ctx.requirementTitle, link }, user.id);
  }
  await syncRequirementFill(tx, user, row.requirementId, to.status === 'joined');
  return row;
}

export async function appContext(tx: Tx, app: AppRow) {
  const [r] = await tx
    .select({
      candidateName: candidates.name,
      requirementTitle: requirements.title,
      clientId: requirements.clientId,
      clientName: clients.name,
      ownerId: requirements.ownerId,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(requirements, eq(requirements.id, applications.requirementId))
    .innerJoin(clients, eq(clients.id, requirements.clientId))
    .where(eq(applications.id, app.id));
  return r;
}

/** Owner plus assigned recruiters of a requirement. */
export async function requirementTeam(tx: Tx, requirementId: number): Promise<number[]> {
  const [r] = await tx.select({ ownerId: requirements.ownerId }).from(requirements).where(eq(requirements.id, requirementId));
  const a = await tx
    .select({ userId: requirementAssignees.userId })
    .from(requirementAssignees)
    .where(eq(requirementAssignees.requirementId, requirementId));
  return [r.ownerId, ...a.map((x) => x.userId)];
}

async function createPlacement(tx: Tx, user: SessionUser, app: AppRow, offer: typeof offers.$inferSelect | null) {
  const [c] = await tx
    .select({ feeType: clients.feeType, feeValue: clients.feeValue, replacementDays: clients.replacementDays })
    .from(requirements)
    .innerJoin(clients, eq(clients.id, requirements.clientId))
    .where(eq(requirements.id, app.requirementId));
  const joinedOn = offer?.actualDoj ?? isoDate(new Date());
  if (offer && !offer.actualDoj) {
    await tx.update(offers).set({ actualDoj: joinedOn, updatedAt: new Date() }).where(eq(offers.id, offer.id));
  }
  const guaranteeUntil = isoDate(addDays(new Date(`${joinedOn}T00:00:00`), c.replacementDays));
  const [p] = await tx
    .insert(placements)
    .values({
      applicationId: app.id,
      joinedOn,
      feeAmount: calculateFee(c.feeType, c.feeValue, offer?.offeredCtc ?? null),
      guaranteeUntil,
      updatedBy: user.id,
    })
    .onConflictDoNothing()
    .returning();
  if (p) await writeAudit(tx, user.id, 'placement', p.id, 'create', createdChanges(p));
}

async function removePlacement(tx: Tx, applicationId: number) {
  const [p] = await tx.select().from(placements).where(eq(placements.applicationId, applicationId));
  if (!p) return;
  if (p.invoiceStatus !== 'to_raise') {
    throw badRequest('An invoice was already raised for this placement. Record the exit on the placement instead.');
  }
  await tx.delete(placements).where(eq(placements.id, p.id));
}

/**
 * Keeps the requirement in step with its joinings: when every opening is filled, asks the team
 * to close it; when a joining is undone on a Filled requirement, reopens it.
 */
export async function syncRequirementFill(tx: Tx, user: SessionUser, requirementId: number, justJoined = false) {
  const [r] = await tx.select().from(requirements).where(eq(requirements.id, requirementId));
  const [{ joined }] = await tx
    .select({ joined: sql<number>`count(*)::int` })
    .from(applications)
    .where(and(eq(applications.requirementId, requirementId), eq(applications.status, 'joined')));
  if (justJoined && r.status === 'open' && joined >= r.openings) {
    await notify(tx, await requirementTeam(tx, requirementId), {
      title: `All ${r.openings} position${r.openings > 1 ? 's' : ''} filled — ${r.title}`,
      body: 'Confirm closure with the client and mark the requirement Filled.',
      link: `/requirements/${requirementId}`,
    });
  }
  if (r.status === 'filled' && joined < r.openings) {
    await tx
      .update(requirements)
      .set({ status: 'open', closedAt: null, version: sql`${requirements.version} + 1`, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(requirements.id, requirementId));
    await writeAudit(tx, user.id, 'requirement', requirementId, 'update', { status: ['filled', 'open'] });
    await logActivity(tx, {
      actorId: user.id,
      verb: 'requirement.reopened',
      summary: `${r.title} reopened: ${joined} of ${r.openings} filled`,
      requirementId,
      clientId: r.clientId,
    });
  }
}

/** "Client cancelled requirement": closes every open application on it. */
export async function cancelOpenApplications(tx: Tx, user: SessionUser, requirementId: number) {
  const open = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.requirementId, requirementId), isNull(applications.closedAt)));
  for (const a of open) {
    await tx
      .update(applications)
      .set({
        status: 'requirement_cancelled',
        closedAt: new Date(),
        joiningRisk: null,
        updatedBy: user.id,
        updatedAt: new Date(),
        version: sql`${applications.version} + 1`,
      })
      .where(eq(applications.id, a.id));
    await writeAudit(tx, user.id, 'application', a.id, 'update', { status: [a.status, 'requirement_cancelled'] });
  }
  return open.length;
}
