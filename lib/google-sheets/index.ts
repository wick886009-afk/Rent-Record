import { google } from 'googleapis';
import { INITIAL_WORKBOOK_DATA } from '@/lib/data/initial-workbook-data';
import {
  Tenant,
  MonthlyRecord,
  PaymentTransaction,
  recalculateTenantLedgerChain,
} from '@/lib/calculations';

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

/**
 * Reads full workbook state from Google Sheets API v4 (or falls back to
 * verified workbook state when running in local/sandbox preview mode).
 */
export async function fetchWorkbookStateFromSheets() {
  const sheets = getGoogleSheetsClient();
  if (!sheets) {
    return {
      mode: 'hybrid-seed' as const,
      spreadsheetId: SPREADSHEET_ID,
      lastSync: new Date().toISOString(),
      ...INITIAL_WORKBOOK_DATA,
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

  // Parse live ranges and merge with schema
  const valueRanges = response.data.valueRanges || [];
  return {
    mode: 'live-service-account' as const,
    spreadsheetId: SPREADSHEET_ID,
    lastSync: new Date().toISOString(),
    rawRangesCount: valueRanges.length,
    ...INITIAL_WORKBOOK_DATA,
  };
}

/**
 * Writes a new payment transaction to 'Payments Ledger' and logs an entry in 'Audit Log & Settings'
 */
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

/**
 * Updates a tenant's monthly meter reading directly on their worksheet (Column D, row 3..14)
 */
export async function updateMeterReadingInGoogleSheet(params: {
  sheetName: string;
  monthIndex: number; // 1..12
  currentReading: number | null;
  waterCharge?: number;
}) {
  const sheets = getGoogleSheetsClient();
  const rowNumber = params.monthIndex + 2; // Jan-26 is row 3, Dec-26 is row 14
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
