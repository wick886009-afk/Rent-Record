import { jsPDF } from 'jspdf';
import { MonthlyRecord, calculateCombinedJavedRajaSlip } from '@/lib/calculations';

export interface SlipPrintOptions {
  month: string;
  monthName: string;
  year: number;
  layout: '2-page-a4' | 'single-a4-12-grid';
  propertyName: string;
  landlordName: string;
  combineJavedRaja: boolean;
}

/**
 * Generates the Spacious 2-Page A4 Rent Slips PDF (6 Slips on Page 1 + 6 Slips on Page 2)
 * with full meter readings (Current, Previous, Units), Rent, Previous rent, Bill, Total Payable,
 * Paid, Balance Due, and dashed cut lines.
 */
export function generateTwoPageA4SlipsPdf(
  records: MonthlyRecord[],
  options: SlipPrintOptions
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const byName = new Map<string, MonthlyRecord>();
  records.forEach((r) => byName.set(r.tenantName.toLowerCase(), r));

  const mName = options.monthName || options.month;

  // PAGE 1 OF 2
  drawPdfPageHeader(doc, options.propertyName, mName, options.year, 1, 2);
  const javed = byName.get('javed');
  const raja = byName.get('raja');
  if (javed && raja) {
    drawSpaciousCombinedSlipPdf(doc, 10, 18, 92, 82, javed, raja, mName);
  }
  const p1List = [
    { key: 'ghanti', col: 1, row: 0, num: '02' },
    { key: 'painter', col: 0, row: 1, num: '03' },
    { key: 'virasat', col: 1, row: 1, num: '04' },
    { key: 'guddu', col: 0, row: 2, num: '05' },
    { key: 'sajid', col: 1, row: 2, num: '06' },
  ];
  p1List.forEach((item) => {
    const rec = byName.get(item.key);
    if (rec) {
      drawSpaciousSingleSlipPdf(doc, 10 + item.col * 98, 18 + item.row * 89, 92, 82, rec, mName, item.num);
    }
  });
  drawCutLinesOnPage(doc);

  // PAGE 2 OF 2
  doc.addPage('a4', 'portrait');
  drawPdfPageHeader(doc, options.propertyName, mName, options.year, 2, 2);
  const p2List = [
    { key: 'dinesh', col: 0, row: 0, num: '07' },
    { key: 'sonu', col: 1, row: 0, num: '08' },
    { key: 'imran', col: 0, row: 1, num: '09' },
    { key: 'nisha', col: 1, row: 1, num: '10' },
    { key: 'sundar', col: 0, row: 2, num: '11' },
    { key: 'sundar ki mummy', col: 1, row: 2, num: '12' },
  ];
  p2List.forEach((item) => {
    const rec = byName.get(item.key);
    if (rec) {
      drawSpaciousSingleSlipPdf(doc, 10 + item.col * 98, 18 + item.row * 89, 92, 82, rec, mName, item.num);
    }
  });
  drawCutLinesOnPage(doc);

  return doc;
}

/**
 * Generates the Compact 1-Page A4 PDF (All 12 Slips on 1 Page matching Total!A1:F32)
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

  if (javed && raja && options.combineJavedRaja) {
    const comb = calculateCombinedJavedRajaSlip(javed, raja);
    drawCombinedJavedSlipBox(doc, 10, 15, 122, 42, comb);
  }
  const ghanti = byName.get('ghanti');
  if (ghanti) {
    drawStandardCompactSlipBox(doc, 138, 15, 62, 42, ghanti, false);
  }

  ['painter', 'virasat', 'guddu'].forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 63, 60, 42, rec, false);
  });

  ['sajid', 'dinesh', 'sonu'].forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 111, 60, 42, rec, false);
  });

  ['imran', 'nisha', 'sundar'].forEach((tKey, i) => {
    const rec = byName.get(tKey);
    if (rec) drawStandardCompactSlipBox(doc, 10 + i * 64, 159, 60, 42, rec, false);
  });

  const skm = byName.get('sundar ki mummy');
  if (skm) {
    drawStandardCompactSlipBox(doc, 74, 207, 60, 62, skm, true);
  }

  return doc;
}

export function generateSingleTenantPdf(rec: MonthlyRecord, propertyName: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawSpaciousSingleSlipPdf(doc, 20, 20, 170, 95, rec, rec.monthName, rec.tenantId.replace('T-', ''));
  return doc;
}

function drawPdfPageHeader(doc: jsPDF, propName: string, mName: string, year: number, pageNum: number, totalPages: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${propName.toUpperCase()} — MONTHLY RENT SLIPS (${mName.toUpperCase()} ${year})`, 10, 11);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Page ${pageNum} of ${totalPages} (Cut along dashed lines)`, 200, 11, { align: 'right' });
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(10, 13.5, 200, 13.5);
}

function drawCutLinesOnPage(doc: jsPDF) {
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.25);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(8, 103.5, 202, 103.5);
  doc.line(8, 192.5, 202, 192.5);
  doc.line(105, 16, 105, 282);
  doc.setLineDashPattern([], 0);
}

export function drawSpaciousCombinedSlipPdf(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  javed: MonthlyRecord,
  raja: MonthlyRecord,
  mName: string
) {
  const combRent = javed.rent + raja.rent;
  const jPrev = javed.previousOutstanding;
  const rPrev = raja.previousOutstanding;
  const jBill = javed.currentReading !== null ? javed.totalBill : null;
  const rBill = raja.currentReading !== null ? raja.totalBill : null;
  const currOnly = combRent + (jBill ?? 0) + (rBill ?? 0);
  const fullTotal = jBill !== null && rBill !== null ? currOnly + jPrev + rPrev : jPrev + rPrev;
  const combPaid = javed.totalPaid + raja.totalPaid;
  const combBal = fullTotal - combPaid;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.rect(x, y, w, h);

  doc.setFillColor(27, 54, 93);
  doc.rect(x, y, w, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`Javed (${mName}) — Combined Slip`, x + 3, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Rooms 101 & 102 (Javed & Raja) · Slip #01`, x + 3, y + 10);

  doc.setFillColor(241, 245, 249);
  doc.rect(x, y + 12, w, 6.5, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('Particulars', x + 3, y + 16.5);
  doc.text('Javed (101)', x + 58, y + 16.5, { align: 'right' });
  doc.text('Raja (102)', x + w - 3, y + 16.5, { align: 'right' });

  const rows = [
    ['Rent (2200 + 2300)', '', `Rs. ${combRent.toLocaleString('en-IN')}`],
    ['Previous rent', `Rs. ${jPrev.toLocaleString('en-IN')}`, `Rs. ${rPrev.toLocaleString('en-IN')}`],
    [
      'Bill (Elec + Water)',
      jBill !== null ? `Rs. ${jBill.toLocaleString('en-IN')}` : 'Pending',
      rBill !== null ? `Rs. ${rBill.toLocaleString('en-IN')}` : 'Pending',
    ],
    ['Total Payable', `Curr: Rs. ${currOnly.toLocaleString('en-IN')}`, `Rs. ${fullTotal.toLocaleString('en-IN')}`],
  ];
  rows.forEach((r, idx) => {
    const ry = y + 18.5 + idx * 9.5;
    if (idx === 3) {
      doc.setFillColor(241, 245, 249);
      doc.rect(x, ry, w, 9.5, 'F');
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(x, ry, x + w, ry);
    doc.setFont('helvetica', idx === 3 ? 'bold' : 'normal');
    doc.setFontSize(idx === 3 ? 8.8 : 8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(r[0], x + 3, ry + 6.3);
    if (r[1]) doc.text(r[1], x + 58, ry + 6.3, { align: 'right' });
    doc.text(r[2], x + w - 3, ry + 6.3, { align: 'right' });
  });

  const my = y + 56.5;
  doc.setFillColor(254, 252, 232);
  doc.rect(x, my, w, 13, 'F');
  doc.line(x, my, x + w, my);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.3);
  doc.setTextColor(51, 65, 85);
  doc.text(`Javed Meter: Prev ${javed.previousReading} -> Curr ${javed.currentReading ?? 'Pending'} (${javed.units ?? '—'} U)`, x + 3, my + 5);
  doc.text(`Raja Meter:  Prev ${raja.previousReading} -> Curr ${raja.currentReading ?? 'Pending'} (${raja.units ?? '—'} U)`, x + 3, my + 10.5);

  const fy = y + 69.5;
  doc.line(x, fy, x + w, fy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(15, 23, 42);
  doc.text(`Paid: Rs. ${combPaid.toLocaleString('en-IN')}  |  Balance Due: Rs. ${combBal.toLocaleString('en-IN')}`, x + 3, fy + 5.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text('Prior Arrears: Rs. ' + (jPrev + rPrev).toLocaleString('en-IN'), x + 3, fy + 10.2);
  doc.text('Sign: _______________', x + w - 3, fy + 10.2, { align: 'right' });
}

export function drawSpaciousSingleSlipPdf(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  rec: MonthlyRecord,
  mName: string,
  slipNum: string
) {
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h);

  doc.setFillColor(15, 23, 42);
  doc.rect(x, y, w, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`${rec.tenantName} (${mName})`, x + 3, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`${rec.room} · Slip #${slipNum} · Status: ${rec.paymentStatus}`, x + 3, y + 10);

  const billStr = rec.currentReading !== null ? `Rs. ${rec.totalBill.toLocaleString('en-IN')}` : 'Reading Pending';
  const rows = [
    ['Rent', `Rs. ${rec.rent.toLocaleString('en-IN')}`],
    ['Previous rent', `Rs. ${rec.previousOutstanding.toLocaleString('en-IN')}`],
    [`Bill (Elec + Water Rs.${rec.water})`, billStr],
    ['Total Payable', `Rs. ${rec.totalPayable.toLocaleString('en-IN')}`],
  ];
  rows.forEach((r, idx) => {
    const ry = y + 12 + idx * 10;
    if (idx === 3) {
      doc.setFillColor(241, 245, 249);
      doc.rect(x, ry, w, 10, 'F');
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(x, ry, x + w, ry);
    doc.setFont('helvetica', idx === 3 ? 'bold' : 'normal');
    doc.setFontSize(idx === 3 ? 9 : 8.4);
    doc.setTextColor(15, 23, 42);
    doc.text(r[0], x + 3, ry + 6.5);
    doc.text(r[1], x + w - 3, ry + 6.5, { align: 'right' });
  });

  const my = y + 52;
  doc.setFillColor(254, 252, 232);
  doc.rect(x, my, w, 16, 'F');
  doc.line(x, my, x + w, my);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`Current reading: ${rec.currentReading !== null ? rec.currentReading : 'Pending'}`, x + 3, my + 5.5);
  doc.text(`Previous reading: ${rec.previousReading}`, x + w - 3, my + 5.5, { align: 'right' });
  doc.text(`Total Reading: ${rec.units !== null ? rec.units + ' Units (@ Rs.' + rec.rate + '/U)' : 'Pending'}`, x + 3, my + 12.5);

  const fy = y + 68;
  doc.line(x, fy, x + w, fy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`Paid: Rs. ${rec.totalPaid.toLocaleString('en-IN')}`, x + 3, fy + 5.5);
  doc.text(`Balance Due: Rs. ${rec.closingBalance.toLocaleString('en-IN')}`, x + w - 3, fy + 5.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text(`Due Date: 05 ${mName.slice(0, 3)} ${rec.year}`, x + 3, fy + 11.2);
  doc.text('Sign: _______________', x + w - 3, fy + 11.2, { align: 'right' });
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
