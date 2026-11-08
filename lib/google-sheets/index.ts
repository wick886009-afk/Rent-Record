import { google } from 'googleapis';
import { INITIAL_WORKBOOK_DATA } from '@/lib/data/initial-workbook-data';
import { PaymentTransaction } from '@/lib/calculations';

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
  INITIAL_WORKBOOK_DATA.spreadsheetId;

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
      // Spread seed data first so the configured spreadsheet ID takes precedence.
      ...INITIAL_WORKBOOK_DATA,
      mode: 'hybrid-seed' as const,
      spreadsheetId: SPREADSHEET_ID,
      lastSync: new Date().toISOString(),
    };
  }

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [
      'Tenant Directory!A5:P17',
      'Payments Ledger!A5:J500',
      'Monthly_Records!A2:P300',
      'Audit Log & Settings!B4:C11',
    ],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = response.data.valueRanges || [];
  return {
    // Keep runtime metadata after the seed data to avoid duplicate-property errors.
    ...INITIAL_WORKBOOK_DATA,
    mode: 'live-service-account' as const,
    spreadsheetId: SPREADSHEET_ID,
    lastSync: new Date().toISOString(),
    rawRangesCount: valueRanges.length,
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
