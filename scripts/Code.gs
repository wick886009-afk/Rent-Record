/**
 * RENTFLOW — GOOGLE APPS SCRIPT TWO-WAY SYNC & AUTOMATION ENGINE (Code.gs)
 * Connected Workbook ID: 1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s
 * Original Backup ID:    1F1wplNMBN2JXx9gGwtTUjCY0bT-2JVLB
 *
 * Features:
 * 1. Custom Menu 'Rent Management' inside Google Sheets
 * 2. doGet(e) & doPost(e) REST Web App Bridge for the RentFlow Next.js Website
 * 3. Idempotent payment recording into 'Payments Ledger' with duplicate prevention
 * 4. Direct Meter Reading & Monthly Rent updates across all 13 Tenant Worksheets
 * 5. Automatic Audit Logging into 'Audit Log & Settings'
 */

const SPREADSHEET_ID = '1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s';
const WEBHOOK_SECRET = 'rentflow-webhook-secret-2026';

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Rent Management')
    .addItem('Record New Payment', 'showRecordPaymentPrompt')
    .addItem('Switch Rent Slips Month', 'switchRentSlipMonthPrompt')
    .addSeparator()
    .addItem('Refresh Normalized API Tables', 'syncNormalizedTables')
    .addItem('Export Single-A4 Rent Slips PDF', 'exportRentSlipsPdf')
    .addToUi();
}

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ledgerSheet = ss.getSheetByName('Payments Ledger');
  const dirSheet = ss.getSheetByName('Tenant Directory');
  const syncSheet = ss.getSheetByName('Sync_Status');

  const payments = ledgerSheet ? ledgerSheet.getDataRange().getValues() : [];
  const tenants = dirSheet ? dirSheet.getDataRange().getValues() : [];

  if (syncSheet) {
    syncSheet.getRange('B2').setValue(new Date().toISOString());
  }

  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    lastSync: new Date().toISOString(),
    tenantsCount: Math.max(0, tenants.length - 4),
    paymentsCount: Math.max(0, payments.length - 4),
    payments: payments.slice(4),
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (body.action === 'RECORD_PAYMENT') {
      const p = body.payload;
      const ledger = ss.getSheetByName('Payments Ledger');
      // Idempotency check: prevent duplicate Payment ID
      const existingIds = ledger.getRange('A5:A' + Math.max(5, ledger.getLastRow())).getValues().flat();
      if (existingIds.indexOf(p.paymentId) !== -1) {
        return jsonResponse({ ok: true, duplicateIgnored: true, paymentId: p.paymentId });
      }
      ledger.appendRow([
        p.paymentId,
        p.tenantName,
        p.month,
        p.date,
        Number(p.amount),
        p.method || 'Cash',
        p.reference || '',
        p.type || 'Payment',
        p.notes || '',
        new Date().toISOString()
      ]);
      logAudit(ss, 'Web App', p.tenantName + ' (' + p.month + ')', 'Record Payment', '—', '₹' + p.amount);
      return jsonResponse({ ok: true, saved: true, paymentId: p.paymentId });
    }

    if (body.action === 'UPDATE_METER_READING') {
      const { sheetName, monthIndex, currentReading } = body.payload;
      const tSheet = ss.getSheetByName(sheetName);
      if (!tSheet) {
        return jsonResponse({ ok: false, error: 'Tenant worksheet not found: ' + sheetName });
      }
      const row = Number(monthIndex) + 2; // Row 3 = Jan-26 .. Row 14 = Dec-26
      const prevVal = tSheet.getRange(row, 4).getValue();
      tSheet.getRange(row, 4).setValue(currentReading === null || currentReading === '' ? '' : Number(currentReading));
      logAudit(ss, 'Web App', sheetName + '!D' + row, 'Update Meter Reading', String(prevVal), String(currentReading));
      return jsonResponse({ ok: true, updatedCell: sheetName + '!D' + row });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function logAudit(ss, user, record, action, oldVal, newVal) {
  const audit = ss.getSheetByName('Audit Log & Settings');
  if (audit) {
    audit.appendRow([new Date().toISOString(), user, record, action, oldVal, newVal, 'Verified']);
  }
  const sync = ss.getSheetByName('Sync_Status');
  if (sync) {
    sync.getRange('C2').setValue(new Date().toISOString());
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
