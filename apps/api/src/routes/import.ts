// Excel/CSV candidate import: upload -> map columns -> validate (dry run) -> commit -> error report.
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  CANDIDATE_IMPORT_FIELDS,
  candidateSchema,
  importCommitSchema,
  importMappingSchema,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  parseCtc,
  parseExperience,
  parseNoticeDays,
  splitSkills,
  suggestMapping,
  type CandidateInput,
} from '@crm/shared';
import type { DB } from '../db';
import { candidates, importJobs, users } from '../db/schema';
import { me } from '../app';
import { badRequest, notFound } from '../lib/errors';
import { logActivity } from '../lib/audit';
import { sendXlsx, toXlsx } from '../lib/xlsx';
import { insertCandidate } from './candidates';

const MAX_ROWS = 5000;

type Cell = string | number | Date | null;

interface RowCheck {
  row: number;
  input: (CandidateInput & { sourcedBy?: number | null; createdAt?: Date }) | null;
  name: string;
  phone: string | null;
  email: string | null;
  errors: string[];
  warnings: string[];
  duplicates: { id: number; name: string; reasons: string[] }[];
  inFileDuplicateOf: number | null;
}

export async function importRoutes(app: FastifyInstance) {
  app.post('/api/import/candidates', async (req) => {
    const u = me(req);
    const file = await req.file();
    if (!file) throw badRequest('Attach an Excel or CSV file');
    const buf = await file.toBuffer();
    const { headers, rows } = await parseSheet(buf, file.filename);
    if (!headers.length) throw badRequest('The first sheet has no header row');
    if (!rows.length) throw badRequest('No data rows found');
    if (rows.length > MAX_ROWS) throw badRequest(`Import up to ${MAX_ROWS} rows at a time`);
    const [job] = await app.db
      .insert(importJobs)
      .values({ fileName: file.filename, headers, rows, createdBy: u.id })
      .returning({ id: importJobs.id });
    return {
      jobId: job.id,
      fileName: file.filename,
      headers,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
      suggestedMapping: suggestMapping(headers),
      fields: CANDIDATE_IMPORT_FIELDS.map(({ key, label, required }) => ({ key, label, required: !!required })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/import/:id/validate', async (req) => {
    const u = me(req);
    const body = importMappingSchema.parse(req.body);
    const job = await loadJob(app.db, Number(req.params.id), u.id);
    const checks = await validate(app.db, job.rows, body.mapping, body.defaultSource ?? null);
    return summarize(checks);
  });

  app.post<{ Params: { id: string } }>('/api/import/:id/commit', async (req) => {
    const u = me(req);
    const body = importCommitSchema.parse(req.body);
    const job = await loadJob(app.db, Number(req.params.id), u.id);
    if (job.status === 'committed') throw badRequest('This file was already imported');
    const checks = await validate(app.db, job.rows, body.mapping, body.defaultSource ?? null);
    const include = new Set(body.includeDuplicates);
    const result = await app.db.transaction(async (tx) => {
      let created = 0;
      const skipped: { row: number; reason: string }[] = [];
      for (const c of checks) {
        if (c.errors.length || !c.input) {
          skipped.push({ row: c.row, reason: c.errors.join('; ') });
          continue;
        }
        if ((c.duplicates.length || c.inFileDuplicateOf) && !include.has(c.row)) {
          skipped.push({
            row: c.row,
            reason: c.inFileDuplicateOf
              ? `Same phone/email as row ${c.inFileDuplicateOf}`
              : `Possible duplicate of ${c.duplicates.map((d) => d.name).join(', ')}`,
          });
          continue;
        }
        const { createdAt, ...input } = c.input;
        const row = await insertCandidate(
          tx,
          u.id,
          { ...input, importJobId: job.id },
          `Imported ${input.name} from ${job.fileName}`,
        );
        if (createdAt) await tx.update(candidates).set({ createdAt }).where(eq(candidates.id, row.id));
        created++;
      }
      await logActivity(tx, {
        actorId: u.id,
        verb: 'import.candidates',
        summary: `Imported ${created} candidate${created === 1 ? '' : 's'} from ${job.fileName} (${skipped.length} skipped)`,
        payload: { jobId: job.id },
      });
      const res = { created, skipped };
      await tx.update(importJobs).set({ status: 'committed', result: res }).where(eq(importJobs.id, job.id));
      return res;
    });
    return { ...result, skippedCount: result.skipped.length };
  });

  /** Rows that were not imported, with the reason, so HR can fix and re-upload them. */
  app.get<{ Params: { id: string } }>('/api/import/:id/errors', async (req, reply) => {
    const u = me(req);
    const job = await loadJob(app.db, Number(req.params.id), u.id);
    const skipped = ((job.result?.skipped ?? []) as { row: number; reason: string }[]).map((s) => ({
      ...s,
      data: job.rows[s.row - 1] ?? {},
    }));
    const buf = await toXlsx(
      'Not imported',
      [
        { header: 'Row', value: (r) => r.row + 1 },
        { header: 'Reason', value: (r) => r.reason, width: 40 },
        ...job.headers.map((h) => ({ header: h, value: (r: (typeof skipped)[number]) => toCell(r.data[h]) })),
      ],
      skipped,
    );
    return sendXlsx(reply, `not-imported-${job.id}.xlsx`, buf);
  });
}

async function loadJob(db: DB, id: number, userId: number) {
  const [job] = await db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.createdBy, userId)));
  if (!job) throw notFound('Import');
  return job;
}

function toCell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number') return v;
  return String(v);
}

/** First worksheet -> header list + row objects (keyed by header). */
export async function parseSheet(buf: Buffer, fileName: string) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(fileName)) {
    await wb.csv.read(Readable.from(buf.toString('utf8').replace(/^﻿/, '')));
  } else if (/\.xlsx$/i.test(fileName)) {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } else {
    throw badRequest('Upload an .xlsx or .csv file (save older .xls files as .xlsx first)');
  }
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (!headerRow && (row.values as unknown[]).filter((v) => v != null && String(v).trim()).length >= 2) headerRow = n;
  });
  if (!headerRow) return { headers: [], rows: [] };
  const headerCells = ws.getRow(headerRow);
  const headers: string[] = [];
  const colIndex: number[] = [];
  headerCells.eachCell((cell, col) => {
    const h = cellText(cell.value)?.toString().trim();
    if (h && !headers.includes(h)) {
      headers.push(h);
      colIndex.push(col);
    }
  });
  const rows: Record<string, Cell>[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const obj: Record<string, Cell> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = cellText(row.getCell(colIndex[i]).value);
      if (v != null && v !== '') any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  });
  return { headers, rows };
}

function cellText(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return cellText(v.text as ExcelJS.CellValue);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('error' in v) return null;
  }
  return String(v);
}

async function validate(
  db: DB,
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  defaultSource: string | null,
): Promise<RowCheck[]> {
  if (!mapping.name) throw badRequest('Map the Name column');
  const get = (row: Record<string, unknown>, key: string) => (mapping[key] ? row[mapping[key]] : null);
  const str = (v: unknown) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim() || null);
  const team = await db.select({ id: users.id, name: users.name }).from(users);
  const userByName = new Map(team.map((t) => [normalizeText(t.name), t.id]));

  const checks: RowCheck[] = rows.map((row, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = str(get(row, 'name')) ?? '';
    const phoneRaw = str(get(row, 'phone'));
    const emailRaw = str(get(row, 'email'));
    const phone = normalizePhone(phoneRaw);
    const email = normalizeEmail(emailRaw);
    if (phoneRaw && !phone) warnings.push(`Phone "${phoneRaw}" doesn't look valid`);
    if (emailRaw && !email) warnings.push(`Email "${emailRaw}" doesn't look valid`);
    if (!phoneRaw && !emailRaw) warnings.push('No phone or email');
    const raw = {
      name,
      phone: phoneRaw,
      altPhone: str(get(row, 'altPhone')),
      email: emailRaw,
      currentCompany: str(get(row, 'currentCompany')),
      currentTitle: str(get(row, 'currentTitle')),
      totalExp: parseExperience(get(row, 'totalExp')),
      currentCtc: parseCtc(get(row, 'currentCtc')),
      expectedCtc: parseCtc(get(row, 'expectedCtc')),
      noticeDays: parseNoticeDays(get(row, 'noticeDays')),
      location: str(get(row, 'location')),
      preferredLocations: str(get(row, 'preferredLocations')),
      skills: splitSkills(str(get(row, 'skills'))),
      qualification: str(get(row, 'qualification')),
      source: str(get(row, 'source')) ?? defaultSource,
      linkedinUrl: str(get(row, 'linkedinUrl')),
      notes: str(get(row, 'notes')),
    };
    const parsed = candidateSchema.safeParse(raw);
    if (!parsed.success) errors.push(...parsed.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`));
    let sourcedBy: number | null = null;
    const recruiter = str(get(row, 'sourcedBy'));
    if (recruiter) {
      sourcedBy = userByName.get(normalizeText(recruiter)) ?? null;
      if (!sourcedBy) warnings.push(`Recruiter "${recruiter}" is not a CRM user`);
    }
    let createdAt: Date | undefined;
    const added = get(row, 'addedOn');
    if (added) {
      const d = added instanceof Date ? added : new Date(String(added));
      if (Number.isNaN(d.getTime())) warnings.push(`Date "${String(added)}" not understood`);
      else createdAt = d;
    }
    return {
      row: i + 1,
      input: parsed.success ? { ...parsed.data, sourcedBy, createdAt } : null,
      name,
      phone,
      email,
      errors,
      warnings,
      duplicates: [],
      inFileDuplicateOf: null,
    };
  });

  // Duplicates inside the file
  const seen = new Map<string, number>();
  for (const c of checks) {
    for (const k of [c.phone && `p:${c.phone}`, c.email && `e:${c.email}`].filter(Boolean) as string[]) {
      const first = seen.get(k);
      if (first && !c.inFileDuplicateOf) c.inFileDuplicateOf = first;
      else if (!first) seen.set(k, c.row);
    }
  }
  // Duplicates against the database (phone/email), in one query
  const phones = [...new Set(checks.map((c) => c.phone).filter(Boolean))] as string[];
  const emails = [...new Set(checks.map((c) => c.email).filter(Boolean))] as string[];
  if (phones.length || emails.length) {
    const existing = await db
      .select({ id: candidates.id, name: candidates.name, phoneE164: candidates.phoneE164, emailNorm: candidates.emailNorm })
      .from(candidates)
      .where(
        or(
          phones.length ? inArray(candidates.phoneE164, phones) : undefined,
          emails.length ? inArray(candidates.emailNorm, emails) : undefined,
        ),
      );
    for (const c of checks) {
      for (const e of existing) {
        const reasons: string[] = [];
        if (c.phone && e.phoneE164 === c.phone) reasons.push('phone');
        if (c.email && e.emailNorm === c.email) reasons.push('email');
        if (reasons.length) c.duplicates.push({ id: e.id, name: e.name, reasons });
      }
    }
  }
  return checks;
}

function summarize(checks: RowCheck[]) {
  const errors = checks.filter((c) => c.errors.length).length;
  const duplicates = checks.filter((c) => !c.errors.length && (c.duplicates.length || c.inFileDuplicateOf)).length;
  return {
    total: checks.length,
    ready: checks.length - errors - duplicates,
    errors,
    duplicates,
    warnings: checks.filter((c) => c.warnings.length).length,
    rows: checks.map(({ input, ...rest }) => ({
      ...rest,
      company: input?.currentCompany ?? null,
      exp: input?.totalExp ?? null,
      currentCtc: input?.currentCtc ?? null,
      noticeDays: input?.noticeDays ?? null,
    })),
  };
}
