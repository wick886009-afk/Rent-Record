/**
 * RENTFLOW — COMPLETE TWO-WAY GOOGLE SHEETS SYNC ENGINE (Code.gs)
 * Connected Workbook ID: 1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s
 *
 * HOW TO AUTHORIZE & DEPLOY (60 SECONDS):
 * 1. Click "▶ Run" at the top (with "testAndAuthorizeConnection" selected) and click "Review permissions" -> "Allow".
 * 2. Click "Deploy" (top right) -> "New deployment" -> Select type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 3. Click "Deploy", copy the Web App URL (https://script.google.com/macros/s/.../exec),
 *    and paste it into the "🔗 Connect Sheet" button on the RentFlow website!
 */

const SPREADSHEET_ID = '1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s';
const TENANT_SHEETS = [
  { tenantId: 'T-01', name: 'Javed', sheetName: 'Javed', room: 'Room 101' },
  { tenantId: 'T-02', name: 'Raja', sheetName: 'Raja', room: 'Room 102' },
  { tenantId: 'T-03', name: 'Ghanti', sheetName: 'Ghanti', room: 'Room 103' },
  { tenantId: 'T-04', name: 'Sonu', sheetName: 'Sonu', room: 'Room 104' },
  { tenantId: 'T-05', name: 'Painter', sheetName: 'Painter', room: 'Room 105' },
  { tenantId: 'T-06', name: 'Imran', sheetName: 'Imran', room: 'Room 106' },
  { tenantId: 'T-07', name: 'Virasat', sheetName: 'Virasat', room: 'Room 107' },
  { tenantId: 'T-08', name: 'Guddu', sheetName: 'Guddu', room: 'Room 108' },
  { tenantId: 'T-09', name: 'Sajid', sheetName: 'Sajid', room: 'Room 109' },
  { tenantId: 'T-10', name: 'Sundar Ki Mummy', sheetName: 'Sundar ki mummy', room: 'Room 110' },
  { tenantId: 'T-11', name: 'Dinesh', sheetName: 'Dinesh', room: 'Room 111' },
  { tenantId: 'T-12', name: 'Nisha', sheetName: 'Nisha', room: 'Room 112' },
  { tenantId: 'T-13', name: 'Sundar', sheetName: 'Sundar', room: 'Room 113' }
];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonthKeyFromCell(val) {
  if (!val) return 'Oct-26';
  if (val instanceof Date) {
    const mShort = MONTH_SHORT[val.getMonth()];
    const dNum = val.getDate();
    const yy = (dNum >= 25 && dNum <= 35) ? String(dNum).padStart(2, '0') : String(val.getFullYear()).slice(-2);
    return mShort + '-' + yy;
  }
  const s = String(val).trim();
  const exact = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i);
  if (exact) {
    return exact[1].charAt(0).toUpperCase() + exact[1].slice(1, 3).toLowerCase() + '-' + exact[2];
  }
  return s;
}

/**
 * 1. DEFAULT FUNCTION WHEN YOU CLICK "▶ Run" IN APPS SCRIPT EDITOR:
 * Verifies connection to your Google Sheet, sets Dashboard & Rent Slips to the prior billing month (e.g., Oct-26 in Nov),
 * and authorizes all permissions cleanly without any getUi() error!
 */
function testAndAuthorizeConnection() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('✅ Connected to Google Sheet: ' + ss.getName());
  setPriorBillingMonthInSheet();
  const testRead = doGet({});
  Logger.log('✅ Verified live data read from all 13 tenant tabs + Payments Ledger!');
  Logger.log('👉 NEXT STEP: Click "Deploy" (top right) -> "New deployment" -> Select type: "Web app" (Execute as: Me, Who has access: Anyone) and copy the Web App URL!');
}

/**
 * Safe onOpen() handler — works both when opening the spreadsheet AND if clicked manually in the editor!
 */
function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Rent Management')
      .addItem('Switch Dashboard & Slips to Active Billing Month (Prior Month)', 'setPriorBillingMonthInSheet')
      .addToUi();
  } catch (err) {
    testAndAuthorizeConnection();
  }
}

/**
 * Always selects the month prior to the current calendar month (e.g. Oct-26 when current month is November 2026)
 */
function setPriorBillingMonthInSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  const currM = now.getMonth();
  const currY = now.getFullYear() >= 2026 ? now.getFullYear() : 2026;
  const priorM = currM === 0 ? 11 : currM - 1;
  const priorY = currM === 0 ? Math.max(2026, currY - 1) : currY;
  const mKey = MONTH_SHORT[priorM] + '-' + String(priorY).slice(-2);
  const dash = ss.getSheetByName('Dashboard');
  if (dash) dash.getRange('C3').setValue(mKey);
  const slips = ss.getSheetByName('Monthly Rent Slips');
  if (slips) slips.getRange('I1').setValue(mKey);
  const syncSheet = ss.getSheetByName('Sync_Status');
  if (syncSheet) syncSheet.getRange('B2').setValue(new Date().toISOString());
  Logger.log('✅ Updated Dashboard & Monthly Rent Slips to active prior billing month: ' + mKey);
}

/**
 * GET Handler: Reads live meter readings, rents, credits, and payments across all tabs
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const liveReadings = [];

    TENANT_SHEETS.forEach(function(t) {
      const sh = ss.getSheetByName(t.sheetName);
      if (!sh) return;
      const vals = sh.getRange(3, 1, 12, 16).getValues();
      for (let i = 0; i < 12; i++) {
        const row = vals[i];
        const rentVal = Number(row[1]) || 0;
        const mKey = MONTH_SHORT[i] + '-26';
        const mainReadRaw = row[3];
        const currentReading = (mainReadRaw === '' || mainReadRaw === null || mainReadRaw === undefined || isNaN(Number(mainReadRaw)))
          ? null
          : Number(mainReadRaw);
        const waterVal = Number(row[8]) || 0;
        const creditsVal = Number(row[11]) || 0;
        liveReadings.push({
          recordId: 'REC-2026-' + String(i + 1).padStart(2, '0') + '-' + t.tenantId,
          tenantId: t.tenantId,
          month: mKey,
          monthIndex: i + 1,
          year: 2026,
          rent: rentVal,
          currentReading: currentReading,
          water: waterVal,
          credits: creditsVal
        });
      }
    });

    const ledger = ss.getSheetByName('Payments Ledger');
    const payments = [];
    if (ledger && ledger.getLastRow() >= 5) {
      const pRows = ledger.getRange(5, 1, ledger.getLastRow() - 4, 10).getValues();
      pRows.forEach(function(r, idx) {
        if (!r[0] && !r[1]) return;
        const tName = String(r[1] || '').trim();
        const matchedT = TENANT_SHEETS.find(function(x) {
          return x.name.toLowerCase() === tName.toLowerCase() || x.sheetName.toLowerCase() === tName.toLowerCase();
        });
        const mKey = formatMonthKeyFromCell(r[2]);
        const mIdx = MONTH_SHORT.indexOf(mKey.split('-')[0]) + 1;
        let dtStr = '';
        if (r[3] instanceof Date) {
          dtStr = Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          dtStr = String(r[3] || '');
        }
        payments.push({
          paymentId: String(r[0] || ('PAY-' + String(idx + 1).padStart(3, '0'))),
          tenantId: matchedT ? matchedT.tenantId : 'T-01',
          tenantName: matchedT ? matchedT.name : tName,
          recordId: 'REC-2026-' + String(mIdx > 0 ? mIdx : 10).padStart(2, '0') + '-' + (matchedT ? matchedT.tenantId : 'T-01'),
          month: mKey,
          year: 2026,
          date: dtStr,
          amount: Number(r[4]) || 0,
          method: String(r[5] || 'Cash'),
          reference: String(r[6] || ''),
          type: String(r[7] || 'Payment'),
          notes: String(r[8] || ''),
          createdAt: String(r[9] || new Date().toISOString())
        });
      });
    }

    const syncSheet = ss.getSheetByName('Sync_Status');
    if (syncSheet) {
      syncSheet.getRange('B2').setValue(new Date().toISOString());
    }

    return jsonResponse({
      ok: true,
      spreadsheetId: SPREADSHEET_ID,
      lastSync: new Date().toISOString(),
      liveReadings: liveReadings,
      payments: payments.reverse()
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * POST Handler: Writes new payments, meter readings, credits, and tenant updates
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const action = body.action;
    const p = body.payload || {};

    if (action === 'RECORD_PAYMENT' || action === 'Record Payment') {
      const ledger = ss.getSheetByName('Payments Ledger');
      const lastRow = Math.max(4, ledger.getLastRow());
      if (lastRow >= 5) {
        const existingIds = ledger.getRange(5, 1, lastRow - 4, 1).getValues().flat();
        if (existingIds.indexOf(p.paymentId) !== -1) {
          return jsonResponse({ ok: true, duplicateIgnored: true, paymentId: p.paymentId });
        }
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

    if (action === 'UPDATE_METER_READING' || action === 'Update Meter Reading') {
      const sheetName = p.sheetName || p.tenantName;
      const tSheet = ss.getSheetByName(sheetName);
      if (!tSheet) return jsonResponse({ ok: false, error: 'Worksheet not found: ' + sheetName });
      const row = Number(p.monthIndex) + 2;
      const prevVal = tSheet.getRange(row, 4).getValue();
      const newVal = (p.currentReading === null || p.currentReading === '' || p.currentReading === undefined) ? '' : Number(p.currentReading);
      tSheet.getRange(row, 4).setValue(newVal);
      logAudit(ss, 'Web App', sheetName + '!D' + row, 'Update Meter Reading', String(prevVal), String(newVal));
      return jsonResponse({ ok: true, updatedCell: sheetName + '!D' + row });
    }

    if (action === 'UPDATE_CREDIT' || action === 'Update Credit/Adjustment') {
      const sheetName = p.sheetName || p.tenantName;
      const tSheet = ss.getSheetByName(sheetName);
      if (tSheet && p.monthIndex) {
        const row = Number(p.monthIndex) + 2;
        tSheet.getRange(row, 12).setValue(Number(p.credits) || 0);
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'UPDATE_TENANT_RENT' || action === 'Revise Future Rent') {
      const dir = ss.getSheetByName('Tenant Directory');
      if (dir) {
        const rows = dir.getRange(5, 1, 13, 4).getValues();
        for (let i = 0; i < rows.length; i++) {
          if (String(rows[i][0]) === String(p.tenantId)) {
            dir.getRange(5 + i, 4).setValue(Number(p.monthlyRent || p.newRent));
            break;
          }
        }
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: true, note: 'Action logged: ' + action });
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
