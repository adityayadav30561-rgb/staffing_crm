import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { addDays, isoDate } from '@crm/shared';
import { auditLogs, lookups } from '../src/db/schema';
import {
  login,
  newCandidate,
  openRequirement,
  PDF,
  screenedApplication,
  setupApp,
  SCREENING,
  type Agent,
} from './helpers';

let app: FastifyInstance;
let manager: Agent, riya: Agent, rohan: Agent;

beforeAll(async () => {
  app = await setupApp();
  [manager, riya, rohan] = await Promise.all([
    login(app, 'manager@test.crm'),
    login(app, 'riya@test.crm'),
    login(app, 'rohan@test.crm'),
  ]);
});
afterAll(async () => {
  await app?.close();
});

async function reasonId(kind: string) {
  const [r] = await app.db
    .select()
    .from(lookups)
    .where(eq(lookups.kind, kind as never));
  return r.id;
}

describe('auth & security', () => {
  it('rejects bad passwords and unauthenticated calls', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'riya@test.crm', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    const anon = await app.inject({ method: 'GET', url: '/api/candidates' });
    expect(anon.statusCode).toBe(401);
  });

  it('requires the CSRF header on writes', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'riya@test.crm', password: 'Password@123' },
    });
    const cookie = r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const w = await app.inject({
      method: 'POST',
      url: '/api/clients',
      payload: { name: 'X Corp' },
      headers: { cookie },
    });
    expect(w.statusCode).toBe(403);
    expect(w.json().code).toBe('CSRF');
  });

  it('enforces roles', async () => {
    expect(
      (
        await riya.post('/api/users', {
          name: 'New',
          email: 'n@test.crm',
          role: 'recruiter',
          password: 'abcdefghijk',
        })
      ).status,
    ).toBe(403);
    expect((await riya.get('/api/placements')).status).toBe(403);
    const c = await riya.post('/api/clients', {
      name: 'Fee Hidden Ltd',
      feeType: 'fixed',
      feeValue: 99999,
    });
    expect(c.status).toBe(200);
    expect(c.body.feeValue).toBeUndefined();
    const asManager = await manager.get(`/api/clients/${c.body.id}`);
    expect(asManager.body.feeValue).toBe(8.33); // recruiter could not set commercial terms
    const cand = await newCandidate(riya);
    expect((await riya.del(`/api/candidates/${cand.id}`)).status).toBe(403);
    expect((await manager.del(`/api/candidates/${cand.id}`)).status).toBe(200);
  });
});

describe('requirements & assignment', () => {
  it('only maps candidates on open requirements, by the owner, assignees or managers', async () => {
    const c = await manager.post('/api/clients', { name: 'ABC Technologies' });
    const r = await manager.post('/api/requirements', {
      clientId: c.body.id,
      title: 'Java Backend',
      openings: 1,
    });
    expect(r.body.code).toMatch(/^REQ-\d{4}$/);
    const cand = await newCandidate(riya);
    // Draft: cannot map
    expect(
      (await manager.post('/api/applications', { candidateId: cand.id, requirementId: r.body.id }))
        .status,
    ).toBe(400);
    await manager.post(`/api/requirements/${r.body.id}/status`, {
      version: r.body.version,
      status: 'open',
    });
    // Riya is not assigned yet
    expect(
      (await riya.post('/api/applications', { candidateId: cand.id, requirementId: r.body.id }))
        .status,
    ).toBe(403);
    // Recruiter can't assign on someone else's requirement
    expect(
      (await riya.put(`/api/requirements/${r.body.id}/assignees`, { userIds: [riya.id] })).status,
    ).toBe(403);
    const assign = await manager.put(`/api/requirements/${r.body.id}/assignees`, {
      userIds: [riya.id],
    });
    expect(assign.body.map((a: { id: number }) => a.id)).toEqual([riya.id]);
    // Assignment creates a task and a notification for Riya
    const tasks = await riya.get('/api/tasks');
    expect(tasks.body.some((t: { rule: string }) => t.rule === 'assignment')).toBe(true);
    const counts = await riya.get('/api/tasks/counts');
    expect(counts.body.unreadNotifications).toBeGreaterThan(0);
    expect(
      (await riya.post('/api/applications', { candidateId: cand.id, requirementId: r.body.id }))
        .status,
    ).toBe(200);
  });
});

describe('duplicates', () => {
  it('warns (but does not block) on duplicate candidates', async () => {
    const a = await newCandidate(riya, { phone: '+91 99000 11111', email: 'dup@x.com' });
    const dupes = await rohan.get('/api/candidates/duplicates?phone=9900011111');
    expect(dupes.body.map((d: { id: number }) => d.id)).toContain(a.id);
    const b = await rohan.post('/api/candidates', { name: 'Someone Else', email: 'DUP@x.com' });
    expect(b.status).toBe(200);
    expect(b.body.duplicates[0].reasons).toContain('email');
  });

  it('never lets two recruiters put the same person on one requirement, even at the same moment', async () => {
    const { requirementId } = await openRequirement(manager);
    await manager.put(`/api/requirements/${requirementId}/assignees`, {
      userIds: [riya.id, rohan.id],
    });
    const cand = await newCandidate(riya);
    const [x, y] = await Promise.all([
      riya.post('/api/applications', { candidateId: cand.id, requirementId }),
      rohan.post('/api/applications', { candidateId: cand.id, requirementId }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.code).toBe('DUPLICATE_APPLICATION');
    expect(loser.body.error).toMatch(/Already on this requirement — added by (Riya|Rohan)/);
  });

  it('warns before submitting someone the same client already received', async () => {
    const { clientId, requirementId } = await openRequirement(manager, { title: 'Role A' });
    const second = await openRequirement(manager, { clientId, title: 'Role B' });
    const cand = await newCandidate(manager);
    const a = await screenedApplication(manager, cand.id, requirementId);
    const sub = await manager.post(`/api/applications/${a.id}/submit`, {
      version: a.version,
      submittedAt: new Date().toISOString(),
      channel: 'email',
    });
    expect(sub.status).toBe(200);
    const warn = await manager.post('/api/applications', {
      candidateId: cand.id,
      requirementId: second.requirementId,
    });
    expect(warn.status).toBe(409);
    expect(warn.body.code).toBe('CLIENT_DUPLICATE');
    expect(warn.body.error).toMatch(/Already submitted to this client for Role A/);
    const ack = await manager.post('/api/applications', {
      candidateId: cand.id,
      requirementId: second.requirementId,
      acknowledgeClientDuplicate: true,
    });
    expect(ack.status).toBe(200);
  });
});

describe('optimistic locking', () => {
  it('refuses a save based on an old version and says who changed it', async () => {
    const cand = await newCandidate(riya);
    const first = await riya.patch(`/api/candidates/${cand.id}`, {
      version: cand.version,
      noticeDays: 15,
    });
    expect(first.status).toBe(200);
    const stale = await rohan.patch(`/api/candidates/${cand.id}`, {
      version: cand.version,
      noticeDays: 60,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE');
    expect(stale.body.error).toMatch(/Riya Recruiter changed this candidate/);
  });
});

describe('pipeline: requirement to joining', () => {
  it('runs the full process doc flow and creates the placement', async () => {
    const { requirementId, clientId } = await openRequirement(manager, { openings: 1 });
    await manager.patch(`/api/clients/${clientId}`, {
      version: 1,
      feeType: 'percent',
      feeValue: 10,
    });
    const cand = await newCandidate(manager);
    await manager.upload(`/api/candidates/${cand.id}/resumes`, 'cv.pdf', PDF, 'application/pdf');

    let a = (await manager.post('/api/applications', { candidateId: cand.id, requirementId })).body;
    expect([a.stage, a.status]).toEqual(['sourced', 'contacted']);

    // Skipping stages is refused
    const skip = await manager.post(`/api/applications/${a.id}/move`, {
      version: a.version,
      stage: 'screening',
      status: 'screening_pending',
    });
    expect(skip.status).toBe(400);

    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'sourced',
        status: 'interested',
      })
    ).body;
    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'screening',
        status: 'screening_pending',
      })
    ).body;

    // Submission is blocked until the screening card is complete
    const early = await manager.post(`/api/applications/${a.id}/submit`, {
      version: a.version,
      submittedAt: new Date().toISOString(),
      channel: 'email',
    });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('SCREENING_INCOMPLETE');

    a = (
      await manager.put(`/api/applications/${a.id}/screening`, {
        version: a.version,
        ...SCREENING,
        expectedCtc: 1800000,
      })
    ).body;
    // The screening call refreshes the candidate profile
    expect((await manager.get(`/api/candidates/${cand.id}`)).body.expectedCtc).toBe(1800000);

    a = (
      await manager.post(`/api/applications/${a.id}/submit`, {
        version: a.version,
        submittedAt: new Date().toISOString(),
        channel: 'whatsapp',
      })
    ).body;
    expect([a.stage, a.status]).toEqual(['submitted', 'feedback_pending']);
    expect(a.resumeId).toBeTruthy();

    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'submitted',
        status: 'client_shortlisted',
      })
    ).body;
    expect(a.feedbackAt).toBeTruthy();
    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'interview',
        status: 'interviewing',
      })
    ).body;

    const when = new Date(Date.now() + 86_400_000).toISOString();
    const iv = (
      await manager.post(`/api/applications/${a.id}/interviews`, {
        label: 'Technical',
        mode: 'video',
        scheduledAt: when,
        panelConfirmed: true,
      })
    ).body;
    expect(iv.roundNo).toBe(1);
    const done = await manager.patch(`/api/interviews/${iv.id}`, {
      version: iv.version,
      status: 'completed',
      feedback: 'Good',
    });
    expect(done.status).toBe(200);
    a = (await manager.get(`/api/applications/${a.id}`)).body;
    expect(a.status).toBe('decision_pending'); // waits for the client's decision

    // Next round puts the candidate back into interviewing with round 2
    const r2 = (
      await manager.post(`/api/applications/${a.id}/interviews`, { label: 'HR', scheduledAt: when })
    ).body;
    expect(r2.roundNo).toBe(2);
    a = (await manager.get(`/api/applications/${a.id}`)).body;
    expect(a.status).toBe('interviewing');

    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'interview',
        status: 'selected',
      })
    ).body;
    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'offer',
        status: 'negotiation',
      })
    ).body;
    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'offer',
        status: 'offer_accepted',
      })
    ).body;

    // Joining needs an offer with an expected date
    const noDoj = await manager.post(`/api/applications/${a.id}/move`, {
      version: a.version,
      stage: 'joining',
      status: 'awaiting_doj',
    });
    expect(noDoj.status).toBe(400);
    await manager.put(`/api/applications/${a.id}/offer`, {
      offeredCtc: 2000000,
      offerDate: '2026-10-20',
      expectedDoj: '2026-11-20',
    });
    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'joining',
        status: 'awaiting_doj',
      })
    ).body;

    // A joining risk can be flagged during notice
    a = (
      await manager.post(`/api/applications/${a.id}/risk`, {
        version: a.version,
        risk: 'counter_offer',
        note: 'Manager is retaining',
      })
    ).body;
    expect(a.joiningRisk).toBe('counter_offer');

    a = (
      await manager.post(`/api/applications/${a.id}/move`, {
        version: a.version,
        stage: 'joining',
        status: 'joined',
      })
    ).body;
    expect(a.closedAt).toBeTruthy();
    expect(a.joiningRisk).toBeNull();

    const detail = (await manager.get(`/api/applications/${a.id}`)).body;
    expect(detail.placement.feeAmount).toBe(200000); // 10% of 20L
    // Joined before the expected date: joining date is today, guarantee runs 90 days from it
    expect(detail.placement.joinedOn).toBe(isoDate(new Date()));
    expect(detail.placement.guaranteeUntil).toBe(isoDate(addDays(new Date(), 90)));
    const req = (await manager.get(`/api/requirements/${requirementId}`)).body;
    expect(req.filled).toBe(1);

    // Recruiters see the placement without the fee
    await manager.put(`/api/requirements/${requirementId}/assignees`, { userIds: [riya.id] });
    const asRiya = (await riya.get(`/api/applications/${a.id}`)).body;
    expect(asRiya.placement.feeAmount).toBeUndefined();

    // Did not join (correction) removes the placement and reopens the slot
    await manager.post(`/api/requirements/${requirementId}/status`, {
      version: req.version,
      status: 'filled',
    });
    const dnj = await manager.post(`/api/applications/${a.id}/move`, {
      version: a.version,
      stage: 'joining',
      status: 'did_not_join',
      reasonId: await reasonId('reason_did_not_join'),
    });
    expect(dnj.status).toBe(200);
    expect((await manager.get(`/api/applications/${a.id}`)).body.placement).toBeNull();
    const reopened = (await manager.get(`/api/requirements/${requirementId}`)).body;
    expect(reopened.status).toBe('open');
    expect(reopened.filled).toBe(0);

    // Every step is on the timeline and in the audit log
    expect(detail.timeline.length).toBeGreaterThan(8);
    const audit = await app.db.select().from(auditLogs).where(eq(auditLogs.entity, 'application'));
    expect(audit.filter((x) => x.entityId === a.id).length).toBeGreaterThan(8);
  });

  it('needs a reason to reject, and client cancellation closes every open candidate', async () => {
    const { requirementId } = await openRequirement(manager);
    const c1 = await newCandidate(manager);
    const c2 = await newCandidate(manager);
    const a1 = await screenedApplication(manager, c1.id, requirementId);
    await screenedApplication(manager, c2.id, requirementId);
    const s = (
      await manager.post(`/api/applications/${a1.id}/submit`, {
        version: a1.version,
        submittedAt: new Date().toISOString(),
        channel: 'email',
      })
    ).body;
    const noReason = await manager.post(`/api/applications/${a1.id}/move`, {
      version: s.version,
      stage: 'submitted',
      status: 'client_rejected',
    });
    expect(noReason.status).toBe(400);
    const wrongKind = await manager.post(`/api/applications/${a1.id}/move`, {
      version: s.version,
      stage: 'submitted',
      status: 'client_rejected',
      reasonId: await reasonId('source'),
    });
    expect(wrongKind.status).toBe(400);

    const r = (await manager.get(`/api/requirements/${requirementId}`)).body;
    await manager.post(`/api/requirements/${requirementId}/status`, {
      version: r.version,
      status: 'cancelled',
      note: 'Budget frozen',
    });
    const apps = (await manager.get(`/api/applications?requirementId=${requirementId}&active=all`))
      .body;
    expect(apps.every((x: { status: string }) => x.status === 'requirement_cancelled')).toBe(true);
  });
});

describe('import', () => {
  it('maps columns, flags duplicates and imports the rest', async () => {
    await newCandidate(manager, { phone: '9811122233', name: 'Existing Person' });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tracker');
    ws.addRow([
      'Candidate Name',
      'Mobile No',
      'Email ID',
      'Current Company',
      'Total Exp',
      'CTC',
      'Expected CTC',
      'Notice Period',
      'Key Skills',
      'Recruiter',
    ]);
    ws.addRow([
      'Kiran Shah',
      '98111 22233',
      'kiran@x.com',
      'TCS',
      '5 yrs',
      '12 LPA',
      '16',
      '2 months',
      'Java, Spring',
      'Riya Recruiter',
    ]);
    ws.addRow([
      'Leela Nair',
      '9822233344',
      'leela@x.com',
      'Wipro',
      3.5,
      8,
      11,
      'Immediate',
      'React',
      'Unknown Person',
    ]);
    ws.addRow(['', '9833344455', '', '', '', '', '', '', '', '']);
    ws.addRow(['Leela Again', '9822233344', '', '', '', '', '', '', '', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await manager.upload(
      '/api/import/candidates',
      'tracker.xlsx',
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(up.status).toBe(200);
    expect(up.body.rowCount).toBe(4);
    expect(up.body.suggestedMapping).toMatchObject({
      name: 'Candidate Name',
      phone: 'Mobile No',
      email: 'Email ID',
      currentCtc: 'CTC',
      noticeDays: 'Notice Period',
      sourcedBy: 'Recruiter',
    });

    const check = await manager.post(`/api/import/${up.body.jobId}/validate`, {
      mapping: up.body.suggestedMapping,
      defaultSource: 'Naukri',
    });
    expect(check.body).toMatchObject({ total: 4, ready: 1, errors: 1, duplicates: 2 });
    const leela = check.body.rows.find((r: { name: string }) => r.name === 'Leela Nair');
    expect(leela.currentCtc).toBe(800000);
    expect(leela.noticeDays).toBe(0);
    expect(leela.warnings[0]).toMatch(/Unknown Person/);

    const commit = await manager.post(`/api/import/${up.body.jobId}/commit`, {
      mapping: up.body.suggestedMapping,
      defaultSource: 'Naukri',
      includeDuplicates: [4],
    });
    expect(commit.body.created).toBe(2);
    expect(commit.body.skippedCount).toBe(2);
    const again = await manager.post(`/api/import/${up.body.jobId}/commit`, {
      mapping: up.body.suggestedMapping,
    });
    expect(again.status).toBe(400);
    const list = (await manager.get('/api/candidates?q=Leela')).body;
    expect(list.items[0]).toMatchObject({ source: 'Naukri', noticeDays: 0 });
  });
});

describe('referral link', () => {
  it('creates a candidate credited to the referrer', async () => {
    const me = (await riya.get('/api/auth/me')).body.user;
    const info = await app.inject({
      method: 'GET',
      url: `/api/public/referral/${me.referralCode}`,
    });
    expect(info.json().referrerName).toBe('Riya Recruiter');
    const boundary = '----x';
    const body =
      [
        ['name', 'Referred Person'],
        ['phone', '9876500011'],
        ['skills', 'Go, Kafka'],
      ]
        .map(
          ([k, v]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
        )
        .join('') + `--${boundary}--\r\n`;
    const r = await app.inject({
      method: 'POST',
      url: `/api/public/referral/${me.referralCode}`,
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(r.statusCode).toBe(200);
    const found = (await manager.get('/api/candidates?q=Referred Person')).body.items[0];
    expect(found.source).toBe('Referral – Riya Recruiter');
    expect(found.skills).toEqual(['Go', 'Kafka']);
  });
});

describe('reports', () => {
  it('returns all four reports and the dashboard', async () => {
    for (const r of [
      'productivity',
      'requirements?status=open,on_hold,cancelled,filled',
      'clients',
      'dropoffs',
    ]) {
      const res = await manager.get(`/api/reports/${r}`);
      expect(res.status, r).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
    const prod = (await manager.get('/api/reports/productivity')).body;
    expect(
      prod.find((p: { name: string }) => p.name === 'Manoj Manager').submitted,
    ).toBeGreaterThan(0);
    const drop = (await manager.get('/api/reports/dropoffs')).body;
    expect(drop.some((d: { status: string }) => d.status === 'requirement_cancelled')).toBe(true);
    const dash = await riya.get('/api/dashboard');
    expect(dash.body.scope).toBe('mine');
    expect(dash.body.kpi).toHaveProperty('open_positions');
    const xlsx = await app.inject({
      method: 'GET',
      url: '/api/reports/clients?format=xlsx',
      headers: { cookie: '' },
    });
    expect(xlsx.statusCode).toBe(401);
  });
});
