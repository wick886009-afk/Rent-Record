import { google } from 'googleapis';
import { INITIAL_WORKBOOK_DATA } from '@/lib/data/initial-workbook-data';
import { PaymentTransaction } from '@/lib/calculations';

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
  INITIAL_WORKBOOK_DATA.spreadsheetId;

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey || privateKey.includes('YOUR_PRIVATE_KEY_HERE')) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  return google.sheets({ version: 'v4', auth });
}

export async function fetchWorkbookStateFromSheets() {
  const sheets = getGoogleSheetsClient();
  if (!sheets) {
    return {
      ...INITIAL_WORKBOOK_DATA,
      mode: 'hybrid-seed' as const,
      spreadsheetId: SPREADSHEET_ID,
      lastSync: new Date().toISOString(),
    };
  }

  const tenantTabs = INITIAL_WORKBOOK_DATA.tenants.map((t) => `'${t.sheetName}'!A3:P14`);
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [
      'Payments Ledger!A5:J500',
      ...tenantTabs,
    ],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = response.data.valueRanges || [];
  const ledgerRows = valueRanges[0]?.values || [];

  const livePayments: PaymentTransaction[] = [];
  ledgerRows.forEach((r, idx) => {
    if (!r[0] && !r[1]) return;
    const tName = String(r[1] || '').trim();
    const matchedT = INITIAL_WORKBOOK_DATA.tenants.find(
      (x) => x.name.toLowerCase() === tName.toLowerCase()
    );
    livePayments.push({
      paymentId: String(r[0] || `PAY-${String(idx + 1).padStart(3, '0')}`),
      tenantId: matchedT ? matchedT.tenantId : 'T-01',
      tenantName: matchedT ? matchedT.name : tName,
      recordId: `REC-2026-${String(r[2] || 'Nov-26')}-${matchedT ? matchedT.tenantId : 'T-01'}`,
      month: String(r[2] || 'Nov-26'),
      year: 2026,
      date: String(r[3] || ''),
      amount: Number(r[4]) || 0,
      method: String(r[5] || 'Cash'),
      reference: String(r[6] || ''),
      type: String(r[7] || 'Payment'),
      notes: String(r[8] || ''),
      createdAt: String(r[9] || new Date().toISOString()),
    });
  });

  const liveReadings: Array<{
    recordId: string;
    tenantId: string;
    month: string;
    rent: number;
    currentReading: number | null;
    water: number;
    credits: number;
  }> = [];

  INITIAL_WORKBOOK_DATA.tenants.forEach((t, tIdx) => {
    const rows = valueRanges[tIdx + 1]?.values || [];
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const r = rows[mIdx] || [];
      const rawRead = r[3];
      const currentReading =
        rawRead === '' || rawRead === null || rawRead === undefined || Number.isNaN(Number(rawRead))
          ? null
          : Number(rawRead);
      liveReadings.push({
        recordId: `REC-2026-${String(mIdx + 1).padStart(2, '0')}-${t.tenantId}`,
        tenantId: t.tenantId,
        month: `${MONTH_SHORT[mIdx]}-26`,
        rent: Number(r[1]) || t.monthlyRent,
        currentReading,
        water: Number(r[8]) ?? t.waterCharge,
        credits: Number(r[11]) || 0,
      });
    }
  });

  return {
    ...INITIAL_WORKBOOK_DATA,
    mode: 'live-service-account' as const,
    spreadsheetId: SPREADSHEET_ID,
    lastSync: new Date().toISOString(),
    liveReadings,
    payments: livePayments.length > 0 ? livePayments.reverse() : INITIAL_WORKBOOK_DATA.payments,
  };
}

export async function appendPaymentToGoogleSheet(payment: PaymentTransaction) {
  const sheets = getGoogleSheetsClient();
  const webhookUrl = process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;

  if (sheets) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Payments Ledger!A5:J5',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          payment.paymentId,
          payment.tenantName,
          payment.month,
          payment.date,
          payment.amount,
          payment.method,
          payment.reference,
          payment.type,
          payment.notes,
          payment.createdAt,
        ]],
      },
    });
    return { synced: true, mode: 'service-account' };
  }

  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RECORD_PAYMENT',
        secret: process.env.GOOGLE_APPS_SCRIPT_SECRET_TOKEN,
        payload: payment,
      }),
    });
    if (res.ok) {
      return { synced: true, mode: 'apps-script-webhook' };
    }
  }

  return { synced: false, mode: 'in-memory-staged' };
}

export async function updateMeterReadingInGoogleSheet(params: {
  sheetName: string;
  monthIndex: number;
  currentReading: number | null;
  waterCharge?: number;
}) {
  const sheets = getGoogleSheetsClient();
  const rowNumber = params.monthIndex + 2;
  const range = `'${params.sheetName}'!D${rowNumber}`;

  if (sheets) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[params.currentReading === null ? '' : params.currentReading]],
      },
    });
    return { synced: true, cell: range };
  }

  return { synced: false, cell: range };
}
