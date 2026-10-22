import { and, eq } from 'drizzle-orm';
import { canWorkRequirement } from '@crm/shared';
import type { Tx } from '../db';
import { applications, requirementAssignees, requirements } from '../db/schema';
import type { SessionUser } from '../app';
import { forbidden, notFound } from './errors';

export async function requirementAccess(tx: Tx, requirementId: number, user: SessionUser) {
  const [req] = await tx.select().from(requirements).where(eq(requirements.id, requirementId));
  if (!req) throw notFound('Requirement');
  const [a] = await tx
    .select()
    .from(requirementAssignees)
    .where(
      and(
        eq(requirementAssignees.requirementId, requirementId),
        eq(requirementAssignees.userId, user.id),
      ),
    );
  const isOwner = req.ownerId === user.id;
  const isAssignee = !!a;
  return {
    requirement: req,
    isOwner,
    isAssignee,
    canWork: canWorkRequirement(user.role, isOwner, isAssignee),
  };
}

/** Only the owner, assigned recruiters and managers may work a requirement's pipeline. */
export async function assertCanWork(tx: Tx, requirementId: number, user: SessionUser) {
  const acc = await requirementAccess(tx, requirementId, user);
  if (!acc.canWork) throw forbidden('Only the owner, assigned recruiters or a manager can do this');
  return acc;
}

export async function loadApplication(tx: Tx, applicationId: number) {
  const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId));
  if (!app) throw notFound('Application');
  return app;
}
