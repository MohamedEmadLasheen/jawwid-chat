import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import bidiFactory from 'bidi-js';
import { formatMajor } from './money';
import type { InvoiceSnapshot, PaymentMethod } from './payment-ledger.service';

/**
 * PD-27: an invoice as a PDF, rendered on request from its frozen snapshot --
 * the same bytes every time for the same invoice (the refund line aside).
 *
 * Bilingual on every line: English on the left, Arabic on the right, the value
 * between. Names are often Arabic, so text is laid out right-to-left where it
 * must be: the line is reordered with the Unicode Bidirectional Algorithm
 * (bidi-js), and each run of Arabic letters is handed to the font in logical
 * order, because fontkit shapes and lays an Arabic run right-to-left itself.
 * Amounts use Latin digits (banks and accountants read the document too).
 */

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const REGULAR = join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf');
const BOLD = join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf');

const INK = '#1B2B2A';
const MUTED = '#5C6B69';
const RULE = '#C9D3D1';
const BRAND = '#0F5C55';

const bidi = bidiFactory();
// Arabic letters and marks -- not the Arabic-Indic digits or separators, which
// are laid out left-to-right like any number.
const ARABIC_LETTER = /[؀-ٟٮ-ۯۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** The line's segments in visual order (left to right), each ready for the font. */
export function visualSegments(text: string): string[] {
  if (!text) return [];
  // The paragraph's direction is its first strong character's (UAX #9 P2):
  // "3-month package · باقة" reads left to right, "باقة 3 أشهر" right to left.
  const levels = bidi.getEmbeddingLevels(text);
  const visual = bidi.getReorderedString(text, levels);
  const out: string[] = [];
  let current = '';
  let arabic: boolean | null = null;
  for (const ch of visual) {
    const a = ARABIC_LETTER.test(ch);
    if (arabic === null || a === arabic) current += ch;
    else {
      out.push(arabic ? [...current].reverse().join('') : current);
      current = ch;
    }
    arabic = a;
  }
  if (current) out.push(arabic ? [...current].reverse().join('') : current);
  return out;
}

export interface InvoiceDocument {
  number: string;
  issuedAt: Date;
  status: 'paid' | 'partially_refunded' | 'refunded' | 'void';
  refundedMinor: number;
  snapshot: InvoiceSnapshot;
}

const METHOD: Record<PaymentMethod, [string, string]> = {
  card: ['Card (Stripe)', 'بطاقة'],
  bank_transfer: ['Bank transfer', 'تحويل بنكي'],
  cash: ['Cash', 'نقدًا'],
  invoice: ['Invoice', 'فاتورة'],
};
const STATUS: Record<InvoiceDocument['status'], [string, string]> = {
  paid: ['PAID', 'مدفوعة'],
  partially_refunded: ['PARTIALLY REFUNDED', 'مستردة جزئيًا'],
  refunded: ['REFUNDED', 'مستردة'],
  void: ['VOID', 'ملغاة'],
};
const PURPOSE: Record<string, [string, string]> = {
  subscription: ['Subscription', 'اشتراك'],
  renewal: ['Renewal', 'تجديد'],
  instalment: ['Instalment', 'قسط'],
  balance: ['Outstanding balance', 'رصيد مستحق'],
  other: ['Payment', 'دفعة'],
};

function planLabel(months: number): [string, string] {
  const ar = months === 1 ? 'باقة شهر' : months === 12 ? 'باقة سنة' : `باقة ${months} أشهر`;
  return [`${months}-month package`, ar];
}

export function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Invoice ${doc.number}`, Author: doc.snapshot.issuer?.name ?? 'Jawwid', Creator: 'Jawwid Chat' },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.registerFont('regular', REGULAR);
    pdf.registerFont('bold', BOLD);

    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;
    const s = doc.snapshot;

    const line = (text: string, x: number, y: number, w: number, align: 'left' | 'right' | 'center', font = 'regular', size = 10, color = INK) => {
      pdf.font(font).fontSize(size).fillColor(color);
      const segs = visualSegments(text);
      const total = segs.reduce((a, t) => a + pdf.widthOfString(t), 0);
      let cx = align === 'right' ? x + w - total : align === 'center' ? x + (w - total) / 2 : x;
      for (const t of segs) {
        pdf.text(t, cx, y, { lineBreak: false });
        cx += pdf.widthOfString(t);
      }
    };
    const rule = (y: number) => pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(RULE).stroke();

    // Issuer
    let y = 48;
    line(s.issuer?.name ?? 'Jawwid · جوّيد', left, y, width, 'left', 'bold', 16, BRAND);
    line('فاتورة', left, y, width, 'right', 'bold', 16, BRAND);
    y += 24;
    if (s.issuer?.address) { line(s.issuer.address, left, y, width * 0.6, 'left', 'regular', 9, MUTED); y += 13; }
    if (s.issuer?.taxId) { line(`Tax ID ${s.issuer.taxId} · الرقم الضريبي`, left, y, width * 0.6, 'left', 'regular', 9, MUTED); y += 13; }
    line('INVOICE', left, 72, width, 'right', 'bold', 11, MUTED);
    y = Math.max(y, 96) + 8;
    rule(y);
    y += 14;

    // Number, date, status
    const issued = doc.issuedAt.toISOString().slice(0, 10);
    const pair = (en: string, ar: string, value: string, bold = false) => {
      line(en, left, y, 150, 'left', 'regular', 9, MUTED);
      line(ar, left + width - 150, y, 150, 'right', 'regular', 9, MUTED);
      line(value, left + 150, y, width - 300, 'center', bold ? 'bold' : 'regular', 11, INK);
      y += 20;
    };
    pair('Invoice number', 'رقم الفاتورة', doc.number, true);
    pair('Issued', 'تاريخ الإصدار', issued);
    const [stEn, stAr] = STATUS[doc.status];
    pair('Status', 'الحالة', `${stEn} · ${stAr}`, true);
    y += 4;
    rule(y);
    y += 14;

    // Billed to
    pair('Billed to', 'إلى', s.billedTo || '—', true);
    if (s.family && s.family !== s.billedTo) pair('Family', 'الأسرة', s.family);
    if (s.child) pair('Student', 'الطالب', s.child);
    y += 4;
    rule(y);
    y += 14;

    // What was paid for
    const [pEn, pAr] = PURPOSE[s.purpose ?? 'other'] ?? (PURPOSE.other as [string, string]);
    pair('Description', 'البيان', s.label, true);
    pair('Type', 'النوع', `${pEn} · ${pAr}`);
    if (s.planMonths) {
      const [en, ar] = planLabel(s.planMonths);
      pair('Package', 'الباقة', `${en} · ${ar}`);
    }
    if (s.periodStart || s.periodEnd) pair('Billing period', 'فترة الاشتراك', `${s.periodStart ?? '…'} → ${s.periodEnd ?? '…'}`);
    y += 4;
    rule(y);
    y += 14;

    // Payment
    const [mEn, mAr] = METHOD[s.method];
    pair('Payment method', 'طريقة الدفع', `${mEn} · ${mAr}`);
    pair('Paid on', 'تاريخ الدفع', s.paidOn);
    if (s.reference) pair('Reference', 'المرجع', s.reference);
    y += 4;
    rule(y);
    y += 16;

    // Amounts
    const money = (minor: number) => `${formatMajor(minor, s.currency)} ${s.currency}`;
    pair('Amount paid', 'المبلغ المدفوع', money(s.amountMinor), true);
    if (doc.refundedMinor > 0) {
      pair('Refunded', 'المسترد', `− ${money(doc.refundedMinor)}`);
      pair('Net', 'الصافي', money(Math.max(0, s.amountMinor - doc.refundedMinor)), true);
    }

    // Footer
    const footY = pdf.page.height - pdf.page.margins.bottom - 24;
    rule(footY - 8);
    line('Issued by Jawwid Chat. This invoice was generated from the payment record and is valid without a signature.', left, footY, width, 'left', 'regular', 8, MUTED);
    line('صدرت من جوّيد. أُنشئت هذه الفاتورة من سجل الدفع ولا تحتاج إلى توقيع.', left, footY + 12, width, 'right', 'regular', 8, MUTED);

    pdf.end();
  });
}
