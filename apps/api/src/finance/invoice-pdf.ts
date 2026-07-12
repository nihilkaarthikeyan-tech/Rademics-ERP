import PDFDocument from 'pdfkit';
import type { FinanceConfig } from './finance-config';

interface PdfLine {
  description: string;
  quantity: number;
  rate: number;
  gstPercent: number;
  lineTotal: number;
}
interface PdfInvoice {
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  gstAmount: number;
  total: number;
  amountPaid: number;
  notes: string | null;
  footerText: string | null;
  clientName: string | null;
  projectName: string | null;
  lines: PdfLine[];
}

const inr = (n: number) => `Rs. ${n.toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Render a branded invoice PDF (Spec §5.8). Streams into a PDFKit document the caller
 * pipes to the HTTP response. Colours + company identity come from Admin Settings (§23).
 */
export function buildInvoicePdf(inv: PdfInvoice, config: FinanceConfig): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const primary = config.brandPrimary || '#1B2A4A';
  const accent = config.brandAccent || '#2563EB';

  // ── Header band ──
  doc.rect(0, 0, doc.page.width, 90).fill(primary);
  doc.fillColor('white').fontSize(22).text(config.companyName, 50, 30);
  doc.fontSize(9).fillColor('#dbe4ff').text(config.companyAddress, 50, 58);
  if (config.companyGstin) doc.text(`GSTIN: ${config.companyGstin}`, 50, 70);
  doc.fillColor(accent).fontSize(20).text('INVOICE', 0, 34, { align: 'right', width: doc.page.width - 50 });

  // ── Meta ──
  doc.fillColor('#111').fontSize(11);
  let y = 120;
  doc.text(`Invoice #: ${inv.number}`, 50, y);
  doc.text(`Status: ${inv.status}`, 350, y, { width: 195, align: 'right' });
  y += 18;
  doc.text(`Issue date: ${day(inv.issueDate)}`, 50, y);
  doc.text(`Due date: ${day(inv.dueDate)}`, 350, y, { width: 195, align: 'right' });
  y += 24;
  doc.fillColor('#555').fontSize(10).text('Bill to', 50, y);
  doc.fillColor('#111').fontSize(12).text(inv.clientName ?? 'Client', 50, y + 12);
  if (inv.projectName) doc.fillColor('#555').fontSize(10).text(`Project: ${inv.projectName}`, 50, y + 30);

  // ── Table header ──
  y += 60;
  doc.rect(50, y, doc.page.width - 100, 22).fill(primary);
  doc.fillColor('white').fontSize(10);
  doc.text('Description', 58, y + 6);
  doc.text('Qty', 300, y + 6, { width: 50, align: 'right' });
  doc.text('Rate', 355, y + 6, { width: 60, align: 'right' });
  doc.text('GST%', 420, y + 6, { width: 40, align: 'right' });
  doc.text('Amount', 460, y + 6, { width: 85, align: 'right' });
  y += 22;

  // ── Rows ──
  doc.fillColor('#111').fontSize(10);
  for (const l of inv.lines) {
    const h = Math.max(18, doc.heightOfString(l.description, { width: 235 }) + 6);
    if (y + h > doc.page.height - 120) { doc.addPage(); y = 50; }
    doc.fillColor('#111').text(l.description, 58, y + 4, { width: 235 });
    doc.text(String(l.quantity), 300, y + 4, { width: 50, align: 'right' });
    doc.text(l.rate.toFixed(2), 355, y + 4, { width: 60, align: 'right' });
    doc.text(l.gstPercent.toFixed(0), 420, y + 4, { width: 40, align: 'right' });
    doc.text(l.lineTotal.toFixed(2), 460, y + 4, { width: 85, align: 'right' });
    doc.moveTo(50, y + h).lineTo(doc.page.width - 50, y + h).strokeColor('#e5e7eb').stroke();
    y += h;
  }

  // ── Totals ──
  y += 12;
  const totalsX = 355;
  const rightW = 190;
  const totalRow = (label: string, val: string, bold = false) => {
    doc.fillColor(bold ? '#111' : '#555').fontSize(bold ? 12 : 10).font(bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, totalsX, y, { width: 90 });
    doc.text(val, totalsX + 90, y, { width: rightW - 90, align: 'right' });
    y += bold ? 20 : 16;
  };
  totalRow('Subtotal', inr(inv.subtotal));
  totalRow('GST', inr(inv.gstAmount));
  totalRow('Total', inr(inv.total), true);
  totalRow('Paid', inr(inv.amountPaid));
  totalRow('Balance', inr(Math.round((inv.total - inv.amountPaid) * 100) / 100), true);
  doc.font('Helvetica');

  // ── Notes + footer ──
  if (inv.notes) doc.fillColor('#555').fontSize(9).text(inv.notes, 50, y + 10, { width: 280 });
  doc.fillColor('#9ca3af').fontSize(9).text(inv.footerText ?? config.invoiceFooterText, 50, doc.page.height - 70, { width: doc.page.width - 100, align: 'center' });

  return doc;
}
