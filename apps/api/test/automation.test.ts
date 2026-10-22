import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { addWorkingDays } from '@crm/shared';
import { applications, tasks } from '../src/db/schema';
import { runRules } from '../src/automation/rules';
import {
  login,
  newCandidate,
  openRequirement,
  screenedApplication,
  setupApp,
  type Agent,
} from './helpers';

let app: FastifyInstance;
let manager: Agent;

beforeAll(async () => {
  app = await setupApp();
  manager = await login(app, 'manager@test.crm');
});
afterAll(async () => {
  await app?.close();
});

const openTasks = (applicationId: number, rule: string) =>
  app.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.applicationId, applicationId),
        eq(tasks.rule, rule as never),
        isNull(tasks.doneAt),
      ),
    );

async function submitted(submittedAt: Date) {
  const { requirementId } = await openRequirement(manager);
  const cand = await newCandidate(manager);
  const a = await screenedApplication(manager, cand.id, requirementId);
  const s = await manager.post(`/api/applications/${a.id}/submit`, {
    version: a.version,
    submittedAt: submittedAt.toISOString(),
    channel: 'email',
  });
  return s.body;
}

describe('feedback rules (doc step 6)', () => {
  it('chases after the client’s working days, escalates later, and closes when feedback arrives', async () => {
    const sentAt = new Date('2026-10-23T11:00:00'); // Friday
    const a = await submitted(sentAt);

    await runRules(app.db, new Date('2026-10-24T12:00:00')); // Sat: 1 working day
    expect(await openTasks(a.id, 'chase_feedback')).toHaveLength(0);

    await runRules(app.db, new Date('2026-10-26T12:00:00')); // Mon: 2 working days (Sunday skipped)
    const chase = await openTasks(a.id, 'chase_feedback');
    expect(chase).toHaveLength(1);
    expect(chase[0].assigneeId).toBe(manager.id);
    expect(chase[0].dueAt.getTime()).toBe(addWorkingDays(sentAt, 2, [0]).getTime());

    // Idempotent
    await runRules(app.db, new Date('2026-10-26T13:00:00'));
    expect(await openTasks(a.id, 'chase_feedback')).toHaveLength(1);

    await runRules(app.db, new Date('2026-10-30T12:00:00')); // 5 working days
    expect(await openTasks(a.id, 'escalate_feedback')).toHaveLength(1);

    const cur = (await manager.get(`/api/applications/${a.id}`)).body;
    await manager.post(`/api/applications/${a.id}/move`, {
      version: cur.version,
      stage: 'submitted',
      status: 'client_shortlisted',
    });
    const res = await runRules(app.db, new Date('2026-10-30T13:00:00'));
    expect(res.closed).toBeGreaterThanOrEqual(2);
    expect(await openTasks(a.id, 'chase_feedback')).toHaveLength(0);
    expect(await openTasks(a.id, 'escalate_feedback')).toHaveLength(0);
  });
});

describe('interview outcome rule (doc step 9)', () => {
  it('asks the coordinator for the outcome two hours after the slot', async () => {
    const a = await submitted(new Date());
    const cur = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'submitted',
        status: 'client_shortlisted',
      })
    ).body;
    await manager.post(`/api/applications/${a.id}/move`, {
      version: cur.version,
      stage: 'interview',
      status: 'interviewing',
    });
    const slot = new Date(Date.now() + 3_600_000);
    const iv = (
      await manager.post(`/api/applications/${a.id}/interviews`, {
        scheduledAt: slot.toISOString(),
      })
    ).body;

    await runRules(app.db, new Date(slot.getTime() + 60 * 60_000));
    expect(await openTasks(a.id, 'interview_outcome')).toHaveLength(0);
    await runRules(app.db, new Date(slot.getTime() + 2 * 3_600_000 + 60_000));
    expect(await openTasks(a.id, 'interview_outcome')).toHaveLength(1);

    // Rescheduling clears the old reminder
    const moved = new Date(slot.getTime() + 3 * 86_400_000);
    await manager.patch(`/api/interviews/${iv.id}`, {
      version: iv.version,
      scheduledAt: moved.toISOString(),
    });
    await runRules(app.db, new Date(slot.getTime() + 3 * 3_600_000));
    expect(await openTasks(a.id, 'interview_outcome')).toHaveLength(0);
  });
});

describe('notice period rules (doc steps 11-12)', () => {
  it('checks in weekly, daily near the joining date, and confirms on the day', async () => {
    const a = await submitted(new Date());
    let v = a.version;
    const move = async (stage: string, status: string) => {
      const r = await manager.post(`/api/applications/${a.id}/move`, { version: v, stage, status });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      v = r.body.version;
    };
    await move('submitted', 'client_shortlisted');
    await move('interview', 'interviewing');
    await move('interview', 'selected');
    await move('offer', 'negotiation');
    await manager.put(`/api/applications/${a.id}/offer`, {
      offeredCtc: 1500000,
      expectedDoj: '2026-12-01',
    });
    await move('offer', 'offer_accepted');
    await move('joining', 'awaiting_doj');

    const day1 = new Date('2026-11-01T09:00:00');
    await runRules(app.db, day1);
    const [first] = await openTasks(a.id, 'notice_checkin');
    expect(first.title).toMatch(/joins .* in 30 days/);

    // One open check-in at a time
    await runRules(app.db, new Date('2026-11-03T09:00:00'));
    expect(await openTasks(a.id, 'notice_checkin')).toHaveLength(1);

    await app.db.update(tasks).set({ doneAt: day1 }).where(eq(tasks.id, first.id));
    await runRules(app.db, new Date('2026-11-05T09:00:00'));
    expect(await openTasks(a.id, 'notice_checkin')).toHaveLength(0); // next one is due a week later
    await runRules(app.db, new Date('2026-11-08T11:00:00'));
    const second = await openTasks(a.id, 'notice_checkin');
    expect(second).toHaveLength(1);

    // Last 3 days: daily
    await app.db
      .update(tasks)
      .set({ doneAt: new Date('2026-11-28T10:00:00') })
      .where(eq(tasks.id, second[0].id));
    await runRules(app.db, new Date('2026-11-29T11:00:00'));
    expect(await openTasks(a.id, 'notice_checkin')).toHaveLength(1);

    await runRules(app.db, new Date('2026-12-01T09:00:00'));
    expect(await openTasks(a.id, 'confirm_joining')).toHaveLength(1);

    // Joined: all notice tasks close
    await app.db
      .update(applications)
      .set({ status: 'joined', closedAt: new Date() })
      .where(eq(applications.id, a.id));
    await runRules(app.db, new Date('2026-12-01T12:00:00'));
    expect(await openTasks(a.id, 'notice_checkin')).toHaveLength(0);
    expect(await openTasks(a.id, 'confirm_joining')).toHaveLength(0);
  });

  it('respects rules switched off in settings', async () => {
    const admin = await login(app, 'admin@test.crm');
    const s = (await admin.get('/api/settings')).body;
    await admin.put('/api/settings', { ...s, rules: { ...s.rules, chase_feedback: false } });
    const a = await submitted(new Date('2026-10-01T10:00:00'));
    await runRules(app.db, new Date('2026-10-10T10:00:00'));
    expect(await openTasks(a.id, 'chase_feedback')).toHaveLength(0);
    expect(await openTasks(a.id, 'escalate_feedback')).toHaveLength(1);
  });
});
