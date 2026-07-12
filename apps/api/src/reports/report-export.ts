import PDFDocument from 'pdfkit';

export interface ReportColumn {
  key: string;
  label: string;
}
export interface ReportData {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Generic CSV for any report (Spec §5.11, §21 columns). */
export function reportToCsv(data: ReportData): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = data.columns.map((c) => esc(c.label)).join(',');
  const lines = data.rows.map((r) => data.columns.map((c) => esc(cell(r[c.key]))).join(','));
  return [header, ...lines].join('\n');
}

/** Generic landscape PDF table for any report (Spec §5.11 export CSV/PDF). */
export function reportToPdf(data: ReportData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.fillColor('#1B2A4A').fontSize(16).text(data.title, { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor('#666').fontSize(8).text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  doc.moveDown(0.5);

  const usable = doc.page.width - 72;
  const colW = usable / data.columns.length;
  let y = doc.y + 4;

  const header = () => {
    doc.rect(36, y, usable, 18).fill('#1B2A4A');
    doc.fillColor('white').fontSize(7.5);
    data.columns.forEach((c, i) => doc.text(c.label, 40 + i * colW, y + 5, { width: colW - 6, ellipsis: true }));
    y += 18;
  };
  header();

  doc.fontSize(7.5);
  for (const row of data.rows) {
    if (y > doc.page.height - 40) { doc.addPage(); y = 40; header(); }
    doc.fillColor('#111');
    data.columns.forEach((c, i) => doc.text(cell(row[c.key]), 40 + i * colW, y + 4, { width: colW - 6, ellipsis: true }));
    doc.moveTo(36, y + 16).lineTo(36 + usable, y + 16).strokeColor('#e5e7eb').stroke();
    y += 16;
  }
  if (data.rows.length === 0) doc.fillColor('#999').text('No data for this range.', 40, y + 6);
  return doc;
}
