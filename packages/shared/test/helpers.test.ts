import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  calculateFee,
  formatInrShort,
  normalizePhone,
  parseCtc,
  parseExperience,
  parseNoticeDays,
  splitSkills,
  suggestMapping,
} from '../src';

describe('normalizePhone', () => {
  it('normalises Indian numbers to E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });
  it('returns null for junk', () => {
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('parsers', () => {
  it('parses CTC in Indian formats', () => {
    expect(parseCtc('12 LPA')).toBe(1200000);
    expect(parseCtc('12.5')).toBe(1250000);
    expect(parseCtc('1,200,000')).toBe(1200000);
    expect(parseCtc('1.2 Cr')).toBe(12000000);
    expect(parseCtc(8)).toBe(800000);
    expect(parseCtc('')).toBeNull();
  });
  it('parses notice periods', () => {
    expect(parseNoticeDays('Immediate')).toBe(0);
    expect(parseNoticeDays('2 months')).toBe(60);
    expect(parseNoticeDays('30 days')).toBe(30);
    expect(parseNoticeDays(15)).toBe(15);
  });
  it('parses experience', () => {
    expect(parseExperience('5 yrs')).toBe(5);
    expect(parseExperience('5y 6m')).toBe(5.5);
    expect(parseExperience(3.5)).toBe(3.5);
  });
  it('splits skills without duplicates', () => {
    expect(splitSkills('React, node; react |AWS')).toEqual(['React', 'node', 'AWS']);
  });
  it('suggests column mapping from headers', () => {
    expect(suggestMapping(['Candidate Name', 'Mobile No', 'Email ID', 'CTC', 'Notice Period'])).toEqual({
      name: 'Candidate Name',
      phone: 'Mobile No',
      email: 'Email ID',
      currentCtc: 'CTC',
      noticeDays: 'Notice Period',
    });
  });
});

describe('money & dates', () => {
  it('calculates fees', () => {
    expect(calculateFee('percent', 8.33, 1200000)).toBe(99960);
    expect(calculateFee('fixed', 50000, 1200000)).toBe(50000);
    expect(calculateFee('percent', 10, null)).toBe(0);
  });
  it('formats rupees', () => {
    expect(formatInrShort(2400000)).toBe('₹24L');
    expect(formatInrShort(85000)).toBe('₹85K');
  });
  it('skips Sundays when adding working days', () => {
    const fri = new Date(2026, 9, 23, 10); // Fri 23 Oct 2026
    expect(addWorkingDays(fri, 2).getDate()).toBe(26); // Sat 24, (Sun 25 off), Mon 26
    expect(addWorkingDays(fri, 2, [0, 6]).getDate()).toBe(27);
  });
});
