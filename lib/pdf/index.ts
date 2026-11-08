import { jsPDF } from 'jspdf';
import { MonthlyRecord, calculateCombinedJavedRajaSlip } from '@/lib/calculations';

export interface SlipPrintOptions {
  month: string;
  monthName: string;
  year: number;
  layout: 'single-a4-12-grid' | '1-per-page' | '2-per-page' | '4-per-page' | '6-per-page';
  propertyName: string;
  landlordName: string;
  combineJavedRaja: boolean;
}

/**
 * Generates an A4 PDF matching the user's exact compact 12-slip layout (Total!A1:F32)
 * where all 12 slips (including Javed+Raja combined and Sundar Ki Mummy's meter readings)
 * print cleanly on a single A4 portrait sheet with cut lines.
 */
export function generateSingleA4CompactSlipsPdf(
  records: MonthlyRecord[],
  options: SlipPrintOptions
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const byName = new Map<string, MonthlyRecord>();
  records.forEach((r) => byName.set(r.tenantName.toLowerCase(), r));

  const javed = byName.get('javed');
  const raja = byName.get('raja');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(27, 54, 93);
  doc.text(
    `${options.propertyName.toUpperCase()} — MONTHLY RENT SLIPS (${options.monthName.toUpperCase()} ${options.year})`,
    105,
    10,
    { align: 'center' }
  );

  // Draw Javed + Raja Combined Slip at top-left (Row 1, Col 1-2) and Ghanti at top-right (Row 1, Col 3)
  if (javed && raja && options.combineJavedRaja) {
    const comb = calculateCombinedJavedRajaSlip(javed, raja);
    drawCombinedJavedSlipBox(doc, 10, 15, 122, 42, comb);
  }
  const ghanti = byName.get('ghanti');
  if (ghanti) {
    drawStandardCompactSlipBox(doc, 138, 15, 62, 42, ghanti, false);
  }

  // Row 2: Painter, Virasat, Guddu
  const row2Tenants = ['painter', 'virasat', 'guddu'];
  row2Tenants.forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 63, 60, 42, rec, false);
  });

  // Row 3: Sajid, Dinesh, Sonu
  const row3Tenants = ['sajid', 'dinesh', 'sonu'];
  row3Tenants.forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 111, 60, 42, rec, false);
  });

  // Row 4: Imran, Nisha, Sundar
  const row4Tenants = ['imran', 'nisha', 'sundar'];
  row4Tenants.forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 159, 60, 42, rec, false);
  });

  // Row 5 Center: Sundar Ki Mummy (with Current reading, Previous reading, Total Reading)
  const skm = byName.get('sundar ki mummy');
  if (skm) {
    drawStandardCompactSlipBox(doc, 74, 207, 60, 62, skm, true);
  }

  return doc;
}

function drawCombinedJavedSlipBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  comb: ReturnType<typeof calculateCombinedJavedRajaSlip>
) {
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.35);
  doc.rect(x, y, w, h);

  doc.setFillColor(27, 54, 93);
  doc.rect(x, y, w, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(comb.title, x + w / 2, y + 5.5, { align: 'center' });

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  const rows = [
    ['Rent', `Rs. ${comb.combinedRent.toLocaleString('en-IN')}`, ''],
    ['Previous rent', `Rs. ${comb.javedPrev.toLocaleString('en-IN')}`, `Rs. ${comb.rajaPrev.toLocaleString('en-IN')}`],
    [
      'Bill',
      comb.javedBill !== null ? `Rs. ${comb.javedBill.toLocaleString('en-IN')}` : 'Pending',
      comb.rajaBill !== null ? `Rs. ${comb.rajaBill.toLocaleString('en-IN')}` : 'Pending',
    ],
    [
      'Total',
      `Rs. ${comb.fullCumulativeTotal.toLocaleString('en-IN')}`,
      `(Curr: Rs. ${comb.currentMonthOnlyTotal.toLocaleString('en-IN')})`,
    ],
  ];

  rows.forEach((r, idx) => {
    const ry = y + 8 + idx * 8.5;
    doc.setFont('helvetica', idx === 3 ? 'bold' : 'normal');
    doc.line(x, ry, x + w, ry);
    doc.text(r[0], x + 3, ry + 5.8);
    doc.text(r[1], x + 55, ry + 5.8);
    if (r[2]) doc.text(r[2], x + 88, ry + 5.8);
  });
}

function drawStandardCompactSlipBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  rec: MonthlyRecord,
  includeReadings: boolean
) {
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.35);
  doc.rect(x, y, w, h);

  doc.setFillColor(27, 54, 93);
  doc.rect(x, y, w, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(`${rec.tenantName} (${rec.monthName})`, x + w / 2, y + 5.5, { align: 'center' });

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  const rows: [string, string][] = [
    ['Rent', `Rs. ${rec.rent.toLocaleString('en-IN')}`],
    ['Previous rent', `Rs. ${rec.previousOutstanding.toLocaleString('en-IN')}`],
    ['Bill', rec.currentReading !== null ? `Rs. ${rec.totalBill.toLocaleString('en-IN')}` : 'Pending'],
    ['Total', `Rs. ${rec.totalPayable.toLocaleString('en-IN')}`],
  ];

  if (includeReadings) {
    rows.push(
      ['Current reading', rec.currentReading !== null ? String(rec.currentReading) : 'Pending'],
      ['Previous reading', String(rec.previousReading)],
      ['Total Reading', rec.units !== null ? String(rec.units) : 'Pending']
    );
  }

  rows.forEach((r, idx) => {
    const ry = y + 8 + idx * 7.5;
    doc.setFont('helvetica', idx === 3 ? 'bold' : 'normal');
    doc.line(x, ry, x + w, ry);
    doc.text(r[0], x + 2.5, ry + 5.2);
    doc.text(r[1], x + w - 2.5, ry + 5.2, { align: 'right' });
  });
}
