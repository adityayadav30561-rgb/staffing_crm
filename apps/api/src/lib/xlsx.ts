import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
}

export async function toXlsx<T>(sheetName: string, columns: Column<T>[], rows: T[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Recruitment CRM';
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? Math.max(12, c.header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(columns.map((c) => c.value(r) ?? null));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function sendXlsx(reply: FastifyReply, fileName: string, buf: Buffer) {
  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${fileName}"`)
    .send(buf);
}
