import type { FastifyInstance } from 'fastify';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { INVOICE_STATUS_LABELS, placementUpdateSchema, type InvoiceStatus } from '@crm/shared';
import { applications, candidates, clients, offers, placements, requirements, users } from '../db/schema';
import { requireRole } from '../app';
import { logActivity } from '../lib/audit';
import { updateVersioned } from '../lib/lock';
import { sendXlsx, toXlsx } from '../lib/xlsx';

type PlacementRow = typeof placements.$inferSelect;

export async function placementRoutes(app: FastifyInstance) {
  const list = async (q: { invoiceStatus?: string; clientId?: string }) => {
    const conds: SQL[] = [];
    if (q.invoiceStatus) conds.push(eq(placements.invoiceStatus, q.invoiceStatus as InvoiceStatus));
    if (q.clientId) conds.push(eq(clients.id, Number(q.clientId)));
    const rows = await app.db
      .select({
        p: placements,
        candidateId: candidates.id,
        candidateName: candidates.name,
        requirementId: requirements.id,
        requirementTitle: requirements.title,
        clientId: clients.id,
        clientName: clients.name,
        offeredCtc: offers.offeredCtc,
        submittedByName: users.name,
      })
      .from(placements)
      .innerJoin(applications, eq(applications.id, placements.applicationId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(requirements, eq(requirements.id, applications.requirementId))
      .innerJoin(clients, eq(clients.id, requirements.clientId))
      .leftJoin(offers, eq(offers.applicationId, applications.id))
      .leftJoin(users, eq(users.id, applications.submittedBy))
      .where(and(...conds))
      .orderBy(desc(placements.joinedOn));
    return rows.map(({ p, ...rest }) => ({ ...p, ...rest }));
  };

  app.get<{ Querystring: { invoiceStatus?: string; clientId?: string; format?: string } }>('/api/placements', async (req, reply) => {
    requireRole(req, 'manager');
    const rows = await list(req.query);
    if (req.query.format !== 'xlsx') return rows;
    const buf = await toXlsx('Placements', [
      { header: 'Candidate', value: (r) => r.candidateName, width: 22 },
      { header: 'Client', value: (r) => r.clientName, width: 22 },
      { header: 'Position', value: (r) => r.requirementTitle, width: 24 },
      { header: 'Joined on', value: (r) => r.joinedOn },
      { header: 'Offered CTC', value: (r) => r.offeredCtc },
      { header: 'Fee', value: (r) => r.feeAmount },
      { header: 'Guarantee until', value: (r) => r.guaranteeUntil },
      { header: 'Invoice status', value: (r) => INVOICE_STATUS_LABELS[r.invoiceStatus] },
      { header: 'Invoice no', value: (r) => r.invoiceNo },
      { header: 'Invoice date', value: (r) => r.invoiceDate },
      { header: 'Paid on', value: (r) => r.paidOn },
      { header: 'Left on', value: (r) => r.leftOn },
      { header: 'Recruiter', value: (r) => r.submittedByName },
    ], rows);
    return sendXlsx(reply, 'placements.xlsx', buf);
  });

  app.patch<{ Params: { id: string } }>('/api/placements/:id', async (req) => {
    const u = requireRole(req, 'manager');
    const id = Number(req.params.id);
    const { version, ...body } = placementUpdateSchema.parse(req.body);
    return app.db.transaction(async (tx) => {
      const row = await updateVersioned<PlacementRow>(tx, placements, 'placement', id, version, body, u.id);
      const [ctx] = await tx
        .select({ candidateId: applications.candidateId, requirementId: applications.requirementId, clientId: requirements.clientId, name: candidates.name })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .innerJoin(requirements, eq(requirements.id, applications.requirementId))
        .where(eq(applications.id, row.applicationId));
      const bits: string[] = [];
      if (body.invoiceStatus) bits.push(`invoice ${INVOICE_STATUS_LABELS[body.invoiceStatus].toLowerCase()}`);
      if (body.leftOn) {
        bits.push(`left on ${body.leftOn}${body.leftOn <= row.guaranteeUntil ? ' — within guarantee, replacement due' : ''}`);
      }
      if (bits.length) {
        await logActivity(tx, {
          actorId: u.id,
          verb: 'placement.updated',
          summary: `Placement of ${ctx.name}: ${bits.join(', ')}`,
          candidateId: ctx.candidateId,
          requirementId: ctx.requirementId,
          clientId: ctx.clientId,
          applicationId: row.applicationId,
        });
      }
      app.automation.kick();
      return row;
    });
  });
}
