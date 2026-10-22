// Seeds defaults (lookups, settings, first admin). With --demo, also loads sample data so the
// screens can be tried out. Names and figures are illustrative.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { addDays, isoDate, normalizeEmail, normalizePhone, settingsSchema, type AppStatus, type LookupKind, type Stage } from '@crm/shared';
import { createDb, type DB } from './index';
import * as s from './schema';
import { hashPassword, randomToken } from '../lib/auth';

export const DEFAULT_LOOKUPS: Record<LookupKind, string[]> = {
  source: ['Naukri', 'LinkedIn', 'Referral', 'Internal database', 'Indeed', 'Careers page', 'Walk-in', 'Other'],
  platform: ['Naukri', 'LinkedIn', 'Indeed', 'Instahyre', 'WhatsApp groups', 'Company website', 'Other'],
  reason_not_interested: ['Not looking for change', 'Location', 'Compensation', 'Company profile', 'Role mismatch', 'Other'],
  reason_internal_reject: ['Skills mismatch', 'Experience mismatch', 'CTC out of budget', 'Notice period too long', 'Communication', 'Location', 'Other'],
  reason_client_reject: ['Skills mismatch', 'Experience mismatch', 'CTC out of budget', 'Notice period', 'Duplicate – other vendor', 'Duplicate – client database', 'Position on hold', 'Other'],
  reason_interview_reject: ['Technical skills', 'Communication', 'Attitude / culture fit', 'Salary expectation', 'Other'],
  reason_offer_declined: ['Counter-offer accepted', 'Better offer elsewhere', 'Compensation', 'Location / relocation', 'Personal reasons', 'Other'],
  reason_did_not_join: ['Counter-offer', 'Other offer', 'Not reachable', 'Personal reasons', 'Notice period not released', 'Other'],
  reason_withdrawn: ['Candidate withdrew', 'Not responding', 'Duplicate', 'Other'],
};

export async function seedDefaults(db: DB, admin?: { name: string; email: string; password: string }) {
  for (const [kind, labels] of Object.entries(DEFAULT_LOOKUPS)) {
    await db
      .insert(s.lookups)
      .values(labels.map((label, i) => ({ kind: kind as LookupKind, label, sort: i })))
      .onConflictDoNothing();
  }
  await db.insert(s.settings).values({ key: 'app', value: settingsSchema.parse({}) }).onConflictDoNothing();
  if (admin) {
    const [existing] = await db.select().from(s.users).where(eq(s.users.email, admin.email));
    if (!existing) {
      await db.insert(s.users).values({
        name: admin.name,
        email: admin.email,
        role: 'admin',
        passwordHash: await hashPassword(admin.password),
        referralCode: randomToken(9),
      });
    }
  }
}

const FIRST = ['Amit', 'Priya', 'Rahul', 'Sneha', 'Vikram', 'Ananya', 'Karthik', 'Neha', 'Arjun', 'Pooja', 'Rohan', 'Divya', 'Sanjay', 'Meera', 'Aditya', 'Kavya', 'Nikhil', 'Isha', 'Varun', 'Shruti', 'Manish', 'Riya', 'Suresh', 'Tanvi', 'Harsh', 'Nisha', 'Deepak', 'Aishwarya', 'Gaurav', 'Lakshmi'];
const LAST = ['Kumar', 'Sharma', 'Iyer', 'Reddy', 'Patel', 'Nair', 'Gupta', 'Menon', 'Joshi', 'Rao', 'Singh', 'Das', 'Kulkarni', 'Pillai', 'Verma', 'Bhat'];
const COMPANIES = ['Infosys', 'TCS', 'Wipro', 'HCL Tech', 'Tech Mahindra', 'Mindtree', 'Zoho', 'Freshworks', 'Swiggy', 'Razorpay', 'Persistent', 'L&T Infotech', 'Cognizant', 'Accenture', 'Mphasis'];
const CITIES = ['Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Gurugram', 'Noida', 'Mumbai'];
const SKILLSETS = [
  ['React', 'TypeScript', 'Redux', 'Node.js'],
  ['Java', 'Spring Boot', 'Microservices', 'AWS'],
  ['Python', 'Django', 'PostgreSQL'],
  ['Manual testing', 'Selenium', 'API testing'],
  ['Salesforce', 'Apex', 'Lightning'],
  ['DevOps', 'Kubernetes', 'Terraform', 'AWS'],
  ['Data analysis', 'SQL', 'Power BI'],
];

async function seedDemo(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.clients);
  if (n > 0) {
    console.log('Demo data skipped: clients already exist');
    return;
  }
  const pw = await hashPassword('Password@123');
  const team = await db
    .insert(s.users)
    .values([
      { name: 'Anjali Mehta', email: 'anjali@demo.crm', role: 'manager' as const, passwordHash: pw, referralCode: randomToken(9) },
      { name: 'Ravi Shankar', email: 'ravi@demo.crm', role: 'recruiter' as const, passwordHash: pw, referralCode: randomToken(9) },
      { name: 'Sana Qureshi', email: 'sana@demo.crm', role: 'recruiter' as const, passwordHash: pw, referralCode: randomToken(9) },
      { name: 'Mohit Bansal', email: 'mohit@demo.crm', role: 'recruiter' as const, passwordHash: pw, referralCode: randomToken(9) },
    ])
    .onConflictDoNothing()
    .returning();
  if (team.length < 4) {
    console.log('Demo users already exist; skipping demo data');
    return;
  }
  const [manager, ravi, sana, mohit] = team;
  const recruiters = [ravi, sana, mohit];

  const clientRows = await db
    .insert(s.clients)
    .values([
      { name: 'ABC Technologies', industry: 'IT services', city: 'Bengaluru', feeType: 'percent' as const, feeValue: 8.33, replacementDays: 90, createdBy: manager.id },
      { name: 'Kestrel Fintech', industry: 'Fintech', city: 'Pune', feeType: 'percent' as const, feeValue: 10, replacementDays: 60, createdBy: manager.id },
      { name: 'Bluepine Health', industry: 'Healthcare', city: 'Hyderabad', feeType: 'fixed' as const, feeValue: 75000, replacementDays: 90, createdBy: manager.id },
      { name: 'Oakline Retail', industry: 'Retail', city: 'Mumbai', feeType: 'percent' as const, feeValue: 8.33, replacementDays: 90, feedbackChaseDays: 3, createdBy: manager.id },
    ])
    .returning();
  for (const c of clientRows) {
    await db.insert(s.clientContacts).values([
      { clientId: c.id, name: `${pick(FIRST)} ${pick(LAST)}`, designation: 'HR Manager', email: `hr@${slug(c.name)}.example`, phone: '+91 98450 1' + rand(1000, 9999), isPrimary: true },
      { clientId: c.id, name: `${pick(FIRST)} ${pick(LAST)}`, designation: 'Engineering Manager', email: `hiring@${slug(c.name)}.example` },
    ]);
  }

  const reqSpecs = [
    { client: 0, title: 'Senior React Developer', openings: 5, exp: [5, 8], budget: [1800000, 2800000], skills: SKILLSETS[0], owner: manager, assignees: [ravi, sana, mohit], priority: 'urgent' as const },
    { client: 0, title: 'Java Backend Engineer', openings: 3, exp: [3, 6], budget: [1200000, 2000000], skills: SKILLSETS[1], owner: sana, assignees: [ravi], priority: 'high' as const },
    { client: 1, title: 'Python Developer', openings: 2, exp: [2, 5], budget: [900000, 1600000], skills: SKILLSETS[2], owner: ravi, assignees: [mohit], priority: 'normal' as const },
    { client: 1, title: 'DevOps Engineer', openings: 1, exp: [4, 8], budget: [1600000, 2600000], skills: SKILLSETS[5], owner: mohit, assignees: [], priority: 'high' as const },
    { client: 2, title: 'QA Engineer', openings: 2, exp: [2, 4], budget: [600000, 1000000], skills: SKILLSETS[3], owner: sana, assignees: [mohit], priority: 'normal' as const },
    { client: 3, title: 'Data Analyst', openings: 1, exp: [1, 3], budget: [500000, 900000], skills: SKILLSETS[6], owner: ravi, assignees: [sana], priority: 'low' as const },
  ];
  const now = new Date();
  const reqs = [];
  for (const [i, r] of reqSpecs.entries()) {
    const id = i + 1;
    const opened = addDays(now, -rand(10, 40));
    const [row] = await db
      .insert(s.requirements)
      .values({
        code: `REQ-${String(id).padStart(4, '0')}`,
        clientId: clientRows[r.client].id,
        ownerId: r.owner.id,
        title: r.title,
        status: 'open',
        openings: r.openings,
        expMin: r.exp[0],
        expMax: r.exp[1],
        budgetMin: r.budget[0],
        budgetMax: r.budget[1],
        skills: r.skills,
        location: clientRows[r.client].city,
        workMode: 'hybrid',
        priority: r.priority,
        jdText: `We are hiring a ${r.title} with ${r.exp[0]}-${r.exp[1]} years of experience in ${r.skills.join(', ')}.`,
        targetDate: isoDate(addDays(now, rand(15, 45))),
        openedAt: opened,
        createdAt: opened,
        createdBy: r.owner.id,
      })
      .returning();
    await db.execute(sql`select setval('requirements_id_seq', ${id})`);
    if (r.assignees.length) {
      await db.insert(s.requirementAssignees).values(r.assignees.map((a) => ({ requirementId: row.id, userId: a.id, assignedBy: r.owner.id })));
    }
    await db.insert(s.jobPostings).values({ requirementId: row.id, platform: 'Naukri', postedOn: isoDate(opened), postedBy: r.owner.id, expiresOn: isoDate(addDays(opened, 30)) });
    await activity(db, r.owner.id, 'requirement.created', `Created ${row.code} ${row.title} (${row.openings} positions) for ${clientRows[r.client].name}`, { requirementId: row.id, clientId: row.clientId }, opened);
    reqs.push({ row, spec: r });
  }

  const reasons = await db.select().from(s.lookups);
  const reason = (kind: LookupKind) => reasons.find((x) => x.kind === kind)!.id;

  const used = new Set<string>();
  const cands = [];
  for (let i = 0; i < 60; i++) {
    let name = '';
    do name = `${pick(FIRST)} ${pick(LAST)}`;
    while (used.has(name));
    used.add(name);
    const exp = rand(1, 10) + (rand(0, 1) ? 0.5 : 0);
    const ctc = Math.round((3 + exp * 2.2 + rand(0, 4)) * 1e5);
    const phone = `9${rand(100000000, 999999999)}`;
    const email = `${name.toLowerCase().replace(' ', '.')}@mail.example`;
    const by = pick(recruiters);
    const created = addDays(now, -rand(1, 45));
    const [c] = await db
      .insert(s.candidates)
      .values({
        name,
        phone,
        phoneE164: normalizePhone(phone),
        email,
        emailNorm: normalizeEmail(email),
        currentCompany: pick(COMPANIES),
        currentTitle: exp > 6 ? 'Senior Software Engineer' : 'Software Engineer',
        totalExp: exp,
        currentCtc: ctc,
        expectedCtc: Math.round(ctc * 1.3),
        noticeDays: pick([0, 15, 30, 60, 90]),
        location: pick(CITIES),
        skills: pick(SKILLSETS),
        source: pick(['Naukri', 'LinkedIn', 'Referral', 'Internal database']),
        sourcedBy: by.id,
        createdAt: created,
        updatedAt: created,
      })
      .returning();
    await activity(db, by.id, 'candidate.created', `Added ${c.name} (${c.currentCompany})`, { candidateId: c.id }, created);
    cands.push(c);
  }

  // Spread candidates across stages on the requirements.
  const plan: { stage: Stage; status: AppStatus }[] = [
    { stage: 'sourced', status: 'contacted' },
    { stage: 'sourced', status: 'interested' },
    { stage: 'screening', status: 'screening_pending' },
    { stage: 'screening', status: 'screened_ok' },
    { stage: 'submitted', status: 'feedback_pending' },
    { stage: 'submitted', status: 'feedback_pending' },
    { stage: 'submitted', status: 'client_rejected' },
    { stage: 'interview', status: 'interviewing' },
    { stage: 'interview', status: 'decision_pending' },
    { stage: 'offer', status: 'negotiation' },
    { stage: 'joining', status: 'awaiting_doj' },
    { stage: 'joining', status: 'joined' },
  ];
  let ci = 0;
  for (const { row: r, spec } of reqs) {
    const workers = [spec.owner, ...spec.assignees];
    const count = spec.openings >= 3 ? 12 : 7;
    for (let k = 0; k < count && ci < cands.length; k++, ci++) {
      const c = cands[ci];
      const p = plan[k % plan.length];
      const by = pick(workers);
      const added = addDays(now, -rand(6, 20));
      const submitted = ['submitted', 'interview', 'offer', 'joining'].includes(p.stage) ? addDays(now, -rand(1, 6)) : null;
      const closed = ['client_rejected', 'joined'].includes(p.status);
      const screening = submitted || p.status === 'screened_ok'
        ? { interested: true, currentCtc: c.currentCtc, expectedCtc: c.expectedCtc, noticeDays: c.noticeDays, noticeNegotiable: false, currentLocation: c.location ?? '', willingToRelocate: true, skillRating: rand(3, 5), remarks: 'Good communication; strong on core skills.' }
        : null;
      const [a] = await db
        .insert(s.applications)
        .values({
          candidateId: c.id,
          requirementId: r.id,
          stage: p.stage,
          status: p.status,
          screening,
          screenedBy: screening ? by.id : null,
          screenedAt: screening ? added : null,
          submittedAt: submitted,
          submittedBy: submitted ? by.id : null,
          submissionChannel: submitted ? 'email' : null,
          feedbackAt: submitted && p.status !== 'feedback_pending' ? addDays(submitted, 1) : null,
          reasonId: p.status === 'client_rejected' ? reason('reason_client_reject') : null,
          closedAt: closed ? addDays(now, -1) : null,
          joiningRisk: p.status === 'awaiting_doj' && k % 2 === 0 ? 'counter_offer' : null,
          addedBy: by.id,
          createdAt: added,
          updatedAt: submitted ?? added,
          stageChangedAt: submitted ?? added,
        })
        .returning();
      const ids = { candidateId: c.id, requirementId: r.id, clientId: r.clientId, applicationId: a.id };
      await activity(db, by.id, 'app.created', `Mapped ${c.name} to ${r.title}`, ids, added);
      if (screening) await activity(db, by.id, 'app.screened', `Screened ${c.name} for ${r.title}`, ids, added);
      if (submitted) await activity(db, by.id, 'app.submitted', `Submitted ${c.name} to client via email · ${r.title}`, ids, submitted);
      if (['interview', 'offer', 'joining'].includes(p.stage)) {
        await activity(db, by.id, 'app.status', `${c.name}: Client shortlisted · ${r.title}`, ids, addDays(submitted!, 1), { toStatus: 'client_shortlisted' });
        const when = p.status === 'interviewing' ? addDays(now, rand(0, 3)) : addDays(now, -rand(1, 3));
        when.setHours(rand(10, 17), 0, 0, 0);
        await db.insert(s.interviews).values({
          applicationId: a.id,
          roundNo: 1,
          label: 'Technical',
          mode: 'video',
          scheduledAt: when,
          panel: 'Engineering panel',
          coordinatorId: by.id,
          candidateConfirmed: true,
          panelConfirmed: p.status !== 'interviewing',
          status: p.status === 'interviewing' ? 'scheduled' : 'completed',
          feedback: p.status === 'interviewing' ? null : 'Strong fundamentals',
          createdBy: by.id,
        });
        await activity(db, by.id, 'interview.scheduled', `Round 1 (Technical) for ${c.name} · ${r.title}`, ids, addDays(submitted!, 1));
      }
      if (['offer', 'joining'].includes(p.stage)) {
        await activity(db, by.id, 'app.status', `${c.name}: Selected · ${r.title}`, ids, addDays(now, -2), { toStatus: 'selected' });
        const doj = p.status === 'joined' ? addDays(now, -3) : addDays(now, rand(10, 40));
        await db.insert(s.offers).values({
          applicationId: a.id,
          offeredCtc: Math.round((c.expectedCtc ?? 1e6) * 0.95),
          offerDate: isoDate(addDays(now, -2)),
          expectedDoj: isoDate(doj),
          actualDoj: p.status === 'joined' ? isoDate(doj) : null,
        });
        if (p.status === 'joined') {
          const client = clientRows.find((x) => x.id === r.clientId)!;
          const offered = Math.round((c.expectedCtc ?? 1e6) * 0.95);
          await db.insert(s.placements).values({
            applicationId: a.id,
            joinedOn: isoDate(doj),
            feeAmount: client.feeType === 'fixed' ? client.feeValue : Math.round((offered * client.feeValue) / 100),
            guaranteeUntil: isoDate(addDays(doj, client.replacementDays)),
          });
          await activity(db, by.id, 'app.status', `${c.name}: Joined · ${r.title}`, ids, doj, { toStatus: 'joined' });
        }
      }
    }
  }
  console.log(`Demo data: ${team.length} users (password Password@123), ${clientRows.length} clients, ${reqs.length} requirements, ${cands.length} candidates`);
}

async function activity(
  db: DB,
  actorId: number,
  verb: string,
  summary: string,
  ids: { candidateId?: number; requirementId?: number; clientId?: number; applicationId?: number },
  at: Date,
  payload?: Record<string, unknown>,
) {
  await db.insert(s.activities).values({ actorId, verb, summary, ...ids, createdAt: at, payload: payload ?? null });
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, client } = createDb(url);
  await seedDefaults(db, {
    name: process.env.SEED_ADMIN_NAME ?? 'Admin',
    email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@crm.local').toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123',
  });
  console.log('Defaults seeded');
  if (process.argv.includes('--demo')) await seedDemo(db);
  await client.end();
}
