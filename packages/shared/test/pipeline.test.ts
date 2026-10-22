import { describe, expect, it } from 'vitest';
import { checkMove, missingScreeningFields, stageOfStatus, STAGES, STAGE_STATUSES } from '../src';

const fullCard = {
  interested: true,
  currentCtc: 1200000,
  expectedCtc: 1600000,
  noticeDays: 30,
  noticeNegotiable: false,
  currentLocation: 'Pune',
  willingToRelocate: true,
  skillRating: 4,
  remarks: 'Strong React',
};

describe('checkMove', () => {
  it('allows any status within a stage', () => {
    expect(checkMove({ stage: 'sourced', status: 'contacted' }, { stage: 'sourced', status: 'interested' }).ok).toBe(true);
  });

  it('requires the gate status to move forward', () => {
    const r = checkMove({ stage: 'sourced', status: 'contacted' }, { stage: 'screening', status: 'screening_pending' });
    expect(r.ok).toBe(false);
    expect(checkMove({ stage: 'sourced', status: 'interested' }, { stage: 'screening', status: 'screening_pending' }).ok).toBe(true);
  });

  it('forbids skipping stages', () => {
    const r = checkMove({ stage: 'sourced', status: 'interested' }, { stage: 'submitted', status: 'feedback_pending' });
    expect(r).toEqual({ ok: false, error: 'Stages cannot be skipped' });
  });

  it('blocks submission without a complete screening card and logged submission', () => {
    const from = { stage: 'screening', status: 'screened_ok' } as const;
    const to = { stage: 'submitted', status: 'feedback_pending' } as const;
    expect(checkMove(from, to, { screening: { interested: true } }).ok).toBe(false);
    expect(checkMove(from, to, { screening: fullCard }).ok).toBe(false);
    expect(checkMove(from, to, { screening: fullCard, hasSubmission: true }).ok).toBe(true);
  });

  it('requires reasons for closing statuses', () => {
    const from = { stage: 'submitted', status: 'feedback_pending' } as const;
    const to = { stage: 'submitted', status: 'client_rejected' } as const;
    expect(checkMove(from, to).ok).toBe(false);
    expect(checkMove(from, to, { reasonId: 3 }).ok).toBe(true);
  });

  it('allows withdraw from any stage but only in place', () => {
    expect(checkMove({ stage: 'offer', status: 'negotiation' }, { stage: 'offer', status: 'requirement_cancelled' }).ok).toBe(true);
    expect(checkMove({ stage: 'offer', status: 'negotiation' }, { stage: 'joining', status: 'withdrawn' }, { reasonId: 1 }).ok).toBe(false);
  });

  it('requires an offer with DOJ before joining', () => {
    const from = { stage: 'offer', status: 'offer_accepted' } as const;
    const to = { stage: 'joining', status: 'awaiting_doj' } as const;
    expect(checkMove(from, to).ok).toBe(false);
    expect(checkMove(from, to, { hasOfferWithDoj: true }).ok).toBe(true);
  });

  it('moves backwards onto the entry status only', () => {
    expect(checkMove({ stage: 'interview', status: 'interviewing' }, { stage: 'submitted', status: 'feedback_pending' }).ok).toBe(true);
    expect(checkMove({ stage: 'interview', status: 'interviewing' }, { stage: 'submitted', status: 'client_shortlisted' }).ok).toBe(false);
  });

  it('rejects statuses from another stage', () => {
    expect(checkMove({ stage: 'sourced', status: 'contacted' }, { stage: 'sourced', status: 'joined' }).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('lists missing screening fields', () => {
    expect(missingScreeningFields(fullCard)).toEqual([]);
    expect(missingScreeningFields({ ...fullCard, remarks: ' ' })).toEqual(['remarks']);
  });
  it('maps every stage status back to its stage', () => {
    for (const s of STAGES) for (const st of STAGE_STATUSES[s]) expect(stageOfStatus(st)).toBe(s);
  });
});
