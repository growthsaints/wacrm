import PDFDocument from 'pdfkit';
import { INVOICE_ISSUER } from './invoice-config';
import type { InvoiceRow } from './invoices';

function formatInr(amount: number): string {
  return `Rs. ${amount.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Renders a single-page GST tax invoice as a PDF buffer. pdfkit's
 *  built-in Helvetica font only covers Latin-1, so amounts use "Rs."
 *  rather than the ₹ glyph. */
export function renderInvoicePdf(invoice: InvoiceRow, billedToName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', { align: 'right' });
    doc.moveDown(0.5);

    doc.fontSize(14).font('Helvetica-Bold').text(INVOICE_ISSUER.legalName);
    doc.fontSize(10).font('Helvetica').text(INVOICE_ISSUER.address);
    doc.text(`GSTIN: ${INVOICE_ISSUER.gstin}`);
    doc.moveDown(1.5);

    const infoTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold').text('Invoice Number', 50, infoTop);
    doc.font('Helvetica').text(invoice.invoice_number, 50, doc.y);
    doc.font('Helvetica-Bold').text('Invoice Date', 300, infoTop);
    doc.font('Helvetica').text(formatDate(invoice.issued_at), 300, doc.y);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').text('Billed To');
    doc.font('Helvetica').text(billedToName);
    doc.moveDown(1.5);

    const tableTop = doc.y;
    const col = { desc: 50, base: 320, gst: 400, total: 480 };
    doc.font('Helvetica-Bold');
    doc.text('Description', col.desc, tableTop);
    doc.text('Amount', col.base, tableTop);
    doc.text('GST (18%)', col.gst, tableTop);
    doc.text('Total', col.total, tableTop);
    doc.moveTo(50, tableTop + 18).lineTo(545, tableTop + 18).stroke();

    const rowTop = tableTop + 26;
    doc.font('Helvetica');
    doc.text(invoice.description, col.desc, rowTop, { width: 260 });
    doc.text(formatInr(invoice.base_amount), col.base, rowTop);
    doc.text(formatInr(invoice.gst_amount), col.gst, rowTop);
    doc.text(formatInr(invoice.total_amount), col.total, rowTop);

    const totalRowTop = rowTop + 40;
    doc.moveTo(50, totalRowTop - 8).lineTo(545, totalRowTop - 8).stroke();
    doc.font('Helvetica-Bold').text('Total Paid', col.gst, totalRowTop);
    doc.text(formatInr(invoice.total_amount), col.total, totalRowTop);

    doc.moveDown(4);
    doc.fontSize(8).font('Helvetica').fillColor('#666666').text(
      'This is a system-generated invoice and does not require a signature.',
      50,
      doc.y,
    );

    doc.end();
  });
}
