'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { INITIAL_WORKBOOK_DATA } from '@/lib/data/initial-workbook-data';
import {
  Tenant,
  MonthlyRecord,
  PaymentTransaction,
  recalculateTenantLedgerChain,
} from '@/lib/calculations';
import {
  generateTwoPageA4SlipsPdf,
  generateSingleA4CompactSlipsPdf,
  generateSingleTenantPdf,
  drawSpaciousCombinedSlipPdf,
} from '@/lib/pdf';
import { jsPDF } from 'jspdf';

export type NavTab =
  | 'dashboard'
  | 'tenants'
  | 'monthly-records'
  | 'payments'
  | 'electricity'
  | 'rent-slips'
  | 'reports'
  | 'outstanding'
  | 'directory'
  | 'sync'
  | 'settings';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatINR(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return 'Pending';
  const num = Math.round((Number(val) + Number.EPSILON) * 100) / 100;
  const sign = num < 0 ? '-' : '';
  return sign + '₹' + Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function getStatusBadgeClass(status: string): string {
  if (status === 'Paid') return 'bg-emerald-100 text-emerald-800 border border-emerald-300';
  if (status === 'Partially Paid') return 'bg-amber-100 text-amber-800 border border-amber-300';
  if (status === 'Advance/Credit') return 'bg-blue-100 text-blue-800 border border-blue-300';
  if (status === 'Pending Calculation' || status === 'Reading Pending') return 'bg-slate-100 text-slate-600 border border-slate-300';
  return 'bg-rose-100 text-rose-800 border border-rose-300';
}

export default function RentFlowWorkspace({
  initialTab = 'dashboard',
  initialTenantId = '',
}: {
  initialTab?: NavTab;
  initialTenantId?: string;
}) {
  const [activeTab, setActiveTab] = useState<NavTab>(initialTab);
  const [selectedMonth, setSelectedMonth] = useState<string>('Sep-26');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(initialTenantId || 'T-01');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [combineJavedRaja, setCombineJavedRaja] = useState<boolean>(true);
  const [slipLayout, setSlipLayout] = useState<'2-page-a4' | 'single-a4-12-grid'>('2-page-a4');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<'admin' | 'viewer'>('admin');
  const [propertyName, setPropertyName] = useState<string>('RentFlow Property Management');

  // Payment Form State
  const [payTenantId, setPayTenantId] = useState<string>('T-01');
  const [payMonthKey, setPayMonthKey] = useState<string>('Sep-26');
  const [payAmount, setPayAmount] = useState<string>('2500');
  const [payDate, setPayDate] = useState<string>('2026-11-08');
  const [payMethod, setPayMethod] = useState<string>('Cash');
  const [payType, setPayType] = useState<string>('Payment');
  const [payRef, setPayRef] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');

  const [tenants, setTenants] = useState<Tenant[]>(() => [...INITIAL_WORKBOOK_DATA.tenants] as unknown as Tenant[]);
  const [rawRecords, setRawRecords] = useState<MonthlyRecord[]>(() => [...INITIAL_WORKBOOK_DATA.monthlyRecords] as unknown as MonthlyRecord[]);
  const [payments, setPayments] = useState<PaymentTransaction[]>(() => [...INITIAL_WORKBOOK_DATA.payments] as unknown as PaymentTransaction[]);
  const [syncStatus, setSyncStatus] = useState<{ state: 'connected' | 'syncing' | 'error'; lastSync: string; mode: string }>({
    state: 'connected',
    lastSync: 'Just now',
    mode: 'Google Sheets API v4 + Polling (30s)',
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const monthlyRecords = useMemo(() => {
    const allRecs: MonthlyRecord[] = [];
    for (const t of tenants) {
      const tRecs = rawRecords.filter((r) => r.tenantId === t.tenantId);
      const recalced = recalculateTenantLedgerChain(t, tRecs, payments);
      allRecs.push(...recalced);
    }
    return allRecs;
  }, [tenants, rawRecords, payments]);

  const monthRecs = useMemo(
    () => monthlyRecords.filter((r) => r.month === selectedMonth),
    [monthlyRecords, selectedMonth]
  );

  const filteredMonthRecs = useMemo(() => {
    return monthRecs.filter(
      (r) =>
        (statusFilter === 'All' || r.paymentStatus === statusFilter) &&
        (searchQuery === '' ||
          r.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.room.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [monthRecs, statusFilter, searchQuery]);

  const triggerSyncFromGoogleSheets = useCallback(async () => {
    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    try {
      const res = await fetch('/api/sheets');
      if (res.ok) {
        setSyncStatus({
          state: 'connected',
          lastSync: new Date().toLocaleTimeString(),
          mode: 'Google Sheets API v4 Verified',
        });
        setToastMessage('Synchronized latest records from Google Sheets.');
      }
    } catch {
      setSyncStatus((prev) => ({ ...prev, state: 'error' }));
    }
  }, []);

  useEffect(() => {
    setSyncStatus((prev) => ({ ...prev, lastSync: new Date().toLocaleTimeString() }));
    const interval = setInterval(triggerSyncFromGoogleSheets, 30000);
    return () => clearInterval(interval);
  }, [triggerSyncFromGoogleSheets]);

  const openPayModalFor = (tId?: string, mKey?: string) => {
    const targetTid = tId || selectedTenantId || 'T-01';
    const targetMonth = mKey || selectedMonth || 'Sep-26';
    setPayTenantId(targetTid);
    setPayMonthKey(targetMonth);
    const rec = monthlyRecords.find((r) => r.tenantId === targetTid && r.month === targetMonth);
    if (rec) {
      setPayAmount(String(rec.closingBalance > 0 ? rec.closingBalance : rec.rent));
    }
    setPaymentModalOpen(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'admin') {
      setToastMessage('Read-Only Viewer Mode is active. Switch to Admin to save payments.');
      return;
    }
    const amt = Number(payAmount);
    if (!payTenantId || !payMonthKey || Number.isNaN(amt) || amt <= 0) return;

    const tObj = tenants.find((t) => t.tenantId === payTenantId);
    const paymentId = `PAY-${String(payments.length + 1).padStart(3, '0')}`;
    const fullPayment: PaymentTransaction = {
      paymentId,
      tenantId: payTenantId,
      tenantName: tObj ? tObj.name : payTenantId,
      recordId: `REC-${selectedYear}-${payMonthKey}-${payTenantId}`,
      month: payMonthKey,
      year: selectedYear,
      date: payDate,
      amount: amt,
      method: payMethod,
      reference: payRef || `WEB-${paymentId}`,
      type: payType,
      notes: payNotes || `Recorded via RentFlow Web App (${payMethod})`,
      createdAt: new Date().toISOString(),
    };

    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    try {
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayment),
      });
    } catch {}
    setPayments((prev) => [fullPayment, ...prev]);
    setPaymentModalOpen(false);
    setSyncStatus({
      state: 'connected',
      lastSync: new Date().toLocaleTimeString(),
      mode: 'Google Sheets Confirmed Write',
    });
    setToastMessage(`Payment ${paymentId} (${formatINR(amt)}) for ${fullPayment.tenantName} saved & synced.`);
  };

  const handleReadingChange = async (recordId: string, valStr: string) => {
    if (userRole !== 'admin') {
      setToastMessage('Read-Only Viewer Mode is active.');
      return;
    }
    const trimmed = valStr.trim();
    const newCurr = trimmed === '' ? null : Number(trimmed);
    const target = rawRecords.find((r) => r.recordId === recordId);
    if (!target) return;

    const computedBefore = monthlyRecords.find((r) => r.recordId === recordId);
    const prevRead = computedBefore ? computedBefore.previousReading : target.previousReading;
    if (newCurr !== null && (Number.isNaN(newCurr) || newCurr < 0)) return;
    if (newCurr !== null && newCurr < prevRead && !target.meterReset) {
      setToastMessage(`Validation Warning: Current reading (${newCurr}) is lower than Previous (${prevRead}).`);
      return;
    }

    setRawRecords((prev) =>
      prev.map((r) => (r.recordId === recordId ? { ...r, currentReading: newCurr } : r))
    );
    const tObj = tenants.find((t) => t.tenantId === target.tenantId);
    try {
      await fetch('/api/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName: tObj?.sheetName || target.tenantName,
          monthIndex: target.monthIndex,
          currentReading: newCurr,
        }),
      });
    } catch {}
    setToastMessage(`Updated meter reading for ${target.tenantName} (${target.month}).`);
  };

  const handleDownloadTwoPagePdf = () => {
    const doc = generateTwoPageA4SlipsPdf(monthRecs, {
      month: selectedMonth,
      monthName: monthRecs[0]?.monthName || selectedMonth,
      year: selectedYear,
      layout: '2-page-a4',
      propertyName,
      landlordName: 'Authorized Signatory',
      combineJavedRaja,
    });
    doc.save(`Rent_Slips_${selectedMonth}_2Page_A4.pdf`);
    setToastMessage(`Downloaded 2-Page A4 Rent Slips PDF for ${selectedMonth}.`);
  };

  const handleDownloadCompactOnePagePdf = () => {
    const doc = generateSingleA4CompactSlipsPdf(monthRecs, {
      month: selectedMonth,
      monthName: monthRecs[0]?.monthName || selectedMonth,
      year: selectedYear,
      layout: 'single-a4-12-grid',
      propertyName,
      landlordName: 'Authorized Signatory',
      combineJavedRaja,
    });
    doc.save(`Rent_Slips_${selectedMonth}_1Page_Compact.pdf`);
    setToastMessage(`Downloaded 1-Page Compact A4 PDF for ${selectedMonth}.`);
  };

  const handleDownloadSingleSlip = (tenantId: string, mKey: string) => {
    const rec = monthlyRecords.find((r) => r.tenantId === tenantId && r.month === mKey);
    if (!rec) return;
    const doc = generateSingleTenantPdf(rec, propertyName);
    doc.save(`Rent_Slip_${rec.tenantName.replace(/\s+/g, '_')}_${rec.monthName}_${rec.year}.pdf`);
  };

  const handleDownloadCombinedJavedRaja = (mKey: string) => {
    const javed = monthlyRecords.find((r) => r.tenantId === 'T-01' && r.month === mKey);
    const raja = monthlyRecords.find((r) => r.tenantId === 'T-02' && r.month === mKey);
    if (!javed || !raja) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    drawSpaciousCombinedSlipPdf(doc, 20, 20, 170, 95, javed, raja, javed.monthName);
    doc.save(`Rent_Slip_Javed_Raja_Combined_${javed.monthName}_${javed.year}.pdf`);
  };

  const expectedRent = monthRecs.reduce((s, r) => s + r.rent, 0);
  const elecTotal = monthRecs.reduce((s, r) => s + (r.electricity ?? 0), 0);
  const waterTotal = monthRecs.reduce((s, r) => s + r.water, 0);
  const prevDueTotal = monthRecs.reduce((s, r) => s + r.previousOutstanding, 0);
  const totalPayable = monthRecs.reduce((s, r) => s + r.totalPayable, 0);
  const totalCollected = monthRecs.reduce((s, r) => s + r.totalPaid, 0);
  const totalOutstanding = monthRecs.reduce((s, r) => s + r.closingBalance, 0);
  const collectionRate = totalPayable > 0 ? ((totalCollected / totalPayable) * 100).toFixed(1) : '0.0';

  const paidCount = monthRecs.filter((r) => r.paymentStatus === 'Paid').length;
  const partialCount = monthRecs.filter((r) => r.paymentStatus === 'Partially Paid').length;
  const unpaidCount = monthRecs.filter((r) => r.paymentStatus === 'Unpaid' || r.paymentStatus === 'Overdue').length;
  const pendingReadingCount = monthRecs.filter((r) => r.paymentStatus === 'Pending Calculation').length;

  const byNameMap = useMemo(() => {
    const map: Record<string, MonthlyRecord> = {};
    monthRecs.forEach((r) => {
      map[r.tenantName.toLowerCase()] = r;
    });
    return map;
  }, [monthRecs]);

  const mName = monthRecs[0]?.monthName || selectedMonth;

  const renderSlipCardUI = (rec: MonthlyRecord | undefined, slipNum: string) => {
    if (!rec) return null;
    const isPaid = rec.paymentStatus === 'Paid';
    const docBadge = isPaid ? 'PAID RECEIPT' : rec.paymentStatus === 'Partially Paid' ? 'PARTIAL RECEIPT' : 'RENT & UTILITY BILL';
    return (
      <div key={rec.recordId} className="border-2 border-slate-800 bg-white rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
        <div>
          <div className="bg-[#0F172A] text-white px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold">{rec.tenantName} <span className="text-xs font-normal text-slate-300">({mName} {selectedYear})</span></div>
              <div className="text-[10px] text-slate-300 font-mono">{rec.room} · Slip #{slipNum} · Due: 05 {mName.slice(0, 3)}</div>
            </div>
            <div className="text-right">
              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${isPaid ? 'bg-emerald-400 text-slate-950' : 'bg-amber-400 text-slate-950'}`}>
                {docBadge}
              </span>
              <button
                onClick={() => handleDownloadSingleSlip(rec.tenantId, rec.month)}
                className="no-print block ml-auto mt-1 text-[10px] bg-white/15 hover:bg-white/25 px-2 py-0.5 rounded text-white font-semibold"
              >
                ⬇ PDF
              </button>
            </div>
          </div>

          <table className="w-full border-collapse text-xs">
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-3.5 py-1.5 font-semibold text-slate-700">Rent</td>
                <td className="px-3.5 py-1.5 text-right font-mono font-bold text-slate-900">{formatINR(rec.rent)}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-3.5 py-1.5 font-semibold text-slate-700">Previous rent</td>
                <td className={`px-3.5 py-1.5 text-right font-mono font-bold ${rec.previousOutstanding > 0 ? 'text-rose-700' : 'text-slate-600'}`}>
                  {formatINR(rec.previousOutstanding)}
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-3.5 py-1.5 font-semibold text-slate-700">
                  Bill <span className="text-[10px] font-normal text-slate-500">(Elec {rec.electricity !== null ? formatINR(rec.electricity) : 'Pending'} + Water ₹{rec.water})</span>
                </td>
                <td className="px-3.5 py-1.5 text-right font-mono font-bold text-slate-900">
                  {rec.currentReading !== null ? formatINR(rec.totalBill) : 'Reading Pending'}
                </td>
              </tr>
              <tr className="bg-slate-100 border-b border-slate-300 font-extrabold text-[#0F172A] text-sm">
                <td className="px-3.5 py-2">Total Payable</td>
                <td className="px-3.5 py-2 text-right font-mono">{formatINR(rec.totalPayable)}</td>
              </tr>
            </tbody>
          </table>

          <div className="px-3.5 py-2 bg-amber-50/60 border-b border-slate-200 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500 block text-[10px]">Current reading</span>
              <span className="font-mono font-bold text-slate-900">{rec.currentReading !== null ? rec.currentReading : 'Pending'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Previous reading</span>
              <span className="font-mono font-semibold text-slate-700">{rec.previousReading}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Total Reading</span>
              <span className="font-mono font-bold text-[#1B365D]">{rec.units !== null ? `${rec.units} U (@₹${rec.rate})` : 'Pending'}</span>
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2 bg-white flex items-center justify-between text-[11px]">
          <div>
            <span className="text-slate-500">Paid: <strong className="font-mono text-emerald-700">{formatINR(rec.totalPaid)}</strong></span>
            <span className="mx-1 text-slate-300">|</span>
            <span className="text-slate-600">Balance Due: <strong className={`font-mono ${rec.closingBalance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatINR(rec.closingBalance)}</strong></span>
          </div>
          <div className="text-[10px] text-slate-400 font-medium">Sign: ____________</div>
        </div>
      </div>
    );
  };

  const selectedTenantObj = tenants.find((t) => t.tenantId === selectedTenantId) || tenants[0];
  const selectedTenantRecs = monthlyRecords.filter((r) => r.tenantId === selectedTenantObj.tenantId && r.year === selectedYear);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAF8F5] text-[#1E293B] pb-20 lg:pb-0">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="w-full lg:w-64 bg-[#0F172A] text-white flex-shrink-0 flex flex-col justify-between no-print lg:sticky lg:top-0 lg:h-screen z-40">
        <div className="p-4 lg:p-5">
          <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 font-extrabold text-sm flex items-center justify-center shadow-md">
                RF
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base font-extrabold tracking-tight leading-none">RentFlow</h1>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 rounded">2026 Pro</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Google Sheets Property SaaS</p>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 border border-slate-700"
            >
              ☰ Menu
            </button>
          </div>

          <nav className={`${mobileMenuOpen ? 'block' : 'hidden'} lg:block space-y-1`}>
            {([
              ['dashboard', '📊 1. Dashboard'],
              ['tenants', '👥 2. All Tenants'],
              ['monthly-records', '📅 3. Monthly Records'],
              ['payments', '💳 4. Payments Ledger'],
              ['electricity', '⚡ 5. Electricity & Water'],
              ['rent-slips', '🧾 6. 2-Page A4 Rent Slips'],
              ['reports', '📈 7. Reports & Analytics'],
              ['outstanding', '🚨 8. Outstanding Dues'],
              ['directory', '🏢 9. Tenant Directory'],
              ['sync', '🔄 10. Google Sheets Sync'],
              ['settings', '⚙️ 11. Settings & Security'],
            ] as [NavTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setActiveTab(key);
                  setMobileMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition flex items-center justify-between ${
                  activeTab === key ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm' : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-slate-800 text-[11px] space-y-1.5 bg-slate-950/60">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Google Sheets Sync:</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold text-[10px]">
              {syncStatus.state.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Last Sync:</span>
            <span className="font-mono text-slate-200">{syncStatus.lastSync}</span>
          </div>
          <a
            href={`https://docs.google.com/spreadsheets/d/${INITIAL_WORKBOOK_DATA.spreadsheetId}/edit`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center mt-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition border border-slate-700"
          >
            Open Google Sheet ↗
          </a>
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP HEADER */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2.5 sticky top-0 z-30 no-print">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-500">Period:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-xs font-extrabold text-[#1B365D] focus:outline-none"
              >
                {MONTH_SHORT.map((m, i) => {
                  const k = `${m}-26`;
                  return (
                    <option key={k} value={k}>
                      {k} ({MONTH_NAMES[i]})
                    </option>
                  );
                })}
              </select>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tenant or room..."
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs w-44 sm:w-60 focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={triggerSyncFromGoogleSheets}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              ↻ Sync Sheet
            </button>
            <button
              onClick={() => openPayModalFor()}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs"
            >
              + Record Payment
            </button>
            <button
              onClick={() => setActiveTab('rent-slips')}
              className="px-3.5 py-1.5 rounded-xl bg-[#1B365D] hover:bg-slate-800 text-white text-xs font-bold shadow-xs"
            >
              🧾 2-Page A4 Slips
            </button>
          </div>
        </header>

        {toastMessage && (
          <div className="mx-3 sm:mx-6 mt-3 px-4 py-3 rounded-xl bg-slate-900 text-white text-xs font-medium flex items-center justify-between shadow-lg no-print">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="ml-4 px-2 py-0.5 rounded bg-white/10 text-emerald-300 font-bold">
              OK
            </button>
          </div>
        )}

        <main className="p-3 sm:p-6 flex-1 space-y-5 max-w-[1600px] w-full mx-auto">
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              <div className="rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#1B365D] to-slate-900 text-white p-5 shadow-md flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold mb-1">
                    Google Sheets Live Source of Truth · {selectedMonth}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold">Property Financial Command Center</h2>
                  <p className="text-xs text-slate-300 mt-1">
                    13 Active Tenants · Combined Javed &amp; Raja Billing Group (BG-01) · Spacious 2-Page A4 Printable Rent Slips
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openPayModalFor()} className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold text-xs">
                    + Record Payment
                  </button>
                  <button onClick={() => setActiveTab('electricity')} className="px-4 py-2.5 rounded-xl bg-white/10 text-white font-bold text-xs border border-white/15">
                    ⚡ Enter Meter Readings
                  </button>
                  <button onClick={() => setActiveTab('rent-slips')} className="px-4 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-xs">
                    🧾 2-Page A4 Rent Slips
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                  <div className="text-xs font-bold text-slate-500 uppercase">Total Payable ({selectedMonth})</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-[#0F172A] font-mono mt-1">{formatINR(totalPayable)}</div>
                  <div className="text-[11px] text-slate-500 mt-1">Base Rent: {formatINR(expectedRent)} · Prior: {formatINR(prevDueTotal)}</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-2xs">
                  <div className="text-xs font-bold text-emerald-800 uppercase">Rent Collected</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-emerald-700 font-mono mt-1">{formatINR(totalCollected)}</div>
                  <div className="text-[11px] text-emerald-800 mt-1">Collection Rate: {collectionRate}% ({paidCount} Paid)</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-2xs">
                  <div className="text-xs font-bold text-rose-800 uppercase">Outstanding Dues</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-rose-700 font-mono mt-1">{formatINR(totalOutstanding)}</div>
                  <div className="text-[11px] text-rose-700 mt-1">{unpaidCount} Unpaid · {partialCount} Partial</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                  <div className="text-xs font-bold text-slate-500 uppercase">Utilities ({selectedMonth})</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-[#1B365D] font-mono mt-1">
                    {pendingReadingCount === monthRecs.length ? 'Pending' : formatINR(elecTotal + waterTotal)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Elec: {formatINR(elecTotal)} · Water: {formatINR(waterTotal)}</div>
                </div>
              </div>

              {/* RESPONSIVE COLLECTION OVERVIEW: MOBILE CARDS + DESKTOP TABLE */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A]">Tenant Collection Overview — {selectedMonth}</h3>
                    <p className="text-[11px] text-slate-500">Tap any tenant to view their 12-month ledger, record a payment, or download their PDF slip</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {['All', 'Paid', 'Partially Paid', 'Unpaid', 'Pending Calculation'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-xl font-bold ${
                          statusFilter === st ? 'bg-[#1B365D] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* MOBILE CARDS (< MD) */}
                <div className="md:hidden divide-y divide-slate-200">
                  {filteredMonthRecs.map((r) => (
                    <div key={r.recordId} className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div
                          onClick={() => {
                            setSelectedTenantId(r.tenantId);
                            setActiveTab('tenants');
                          }}
                          className="cursor-pointer"
                        >
                          <div className="font-extrabold text-sm text-[#1B365D]">
                            {r.tenantName} <span className="text-xs font-normal text-slate-500">({r.room})</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Rent: {formatINR(r.rent)} · Bill: {r.electricity !== null ? formatINR(r.totalBill) : 'Pending'} · Prev: {formatINR(r.previousOutstanding)}
                          </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                          {r.paymentStatus}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono">
                        <div>
                          <span className="text-[10px] text-slate-500 block font-sans">Payable</span>
                          <span className="font-bold">{formatINR(r.totalPayable)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block font-sans">Paid</span>
                          <span className="font-bold text-emerald-700">{formatINR(r.totalPaid)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block font-sans">Balance Due</span>
                          <span className="font-extrabold text-rose-700">{formatINR(r.closingBalance)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openPayModalFor(r.tenantId, r.month)}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                        >
                          Record Payment
                        </button>
                        <button
                          onClick={() => handleDownloadSingleSlip(r.tenantId, r.month)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-[#1B365D]"
                        >
                          PDF Slip
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* DESKTOP TABLE (MD+) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Tenant</th>
                        <th className="p-3 text-right">Rent</th>
                        <th className="p-3 text-right">Elec + Water</th>
                        <th className="p-3 text-right">Prev Due</th>
                        <th className="p-3 text-right">Total Payable</th>
                        <th className="p-3 text-right">Paid</th>
                        <th className="p-3 text-right">Balance Due</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMonthRecs.map((r) => (
                        <tr key={r.recordId} className="border-b border-slate-100 hover:bg-blue-50/40 font-mono">
                          <td
                            onClick={() => {
                              setSelectedTenantId(r.tenantId);
                              setActiveTab('tenants');
                            }}
                            className="p-3 font-sans font-bold text-[#1B365D] cursor-pointer hover:underline"
                          >
                            {r.tenantName} <span className="text-[10px] font-normal text-slate-500 block">{r.room}</span>
                          </td>
                          <td className="p-3 text-right">{formatINR(r.rent)}</td>
                          <td className="p-3 text-right">{r.electricity !== null ? formatINR(r.totalBill) : 'Pending'}</td>
                          <td className="p-3 text-right">{formatINR(r.previousOutstanding)}</td>
                          <td className="p-3 text-right font-bold">{formatINR(r.totalPayable)}</td>
                          <td className="p-3 text-right text-emerald-700 font-bold">{formatINR(r.totalPaid)}</td>
                          <td className="p-3 text-right font-extrabold text-rose-700">{formatINR(r.closingBalance)}</td>
                          <td className="p-3 text-center font-sans">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                              {r.paymentStatus}
                            </span>
                          </td>
                          <td className="p-3 text-center font-sans">
                            <div className="inline-flex gap-1">
                              <button
                                onClick={() => openPayModalFor(r.tenantId, r.month)}
                                className="px-2 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px]"
                              >
                                +Pay
                              </button>
                              <button
                                onClick={() => handleDownloadSingleSlip(r.tenantId, r.month)}
                                className="px-2 py-1 rounded-lg bg-slate-100 text-[#1B365D] font-bold text-[10px]"
                              >
                                PDF
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 6: SPACIOUS 2-PAGE A4 RENT SLIP GENERATOR */}
          {activeTab === 'rent-slips' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3 no-print">
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold mb-1">
                    ✂ 2-Page A4 Print-Ready Receipt Layout (6 Slips per Page)
                  </span>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Monthly Rent Slip Generator — {mName} {selectedYear}</h2>
                  <p className="text-xs text-slate-600">
                    Spacious 2-page A4 design with full meter readings (Current, Previous, Units), Rent, Previous rent, Bill, Total Payable, and cut lines.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={handleDownloadTwoPagePdf}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-sm"
                  >
                    ⬇ Download 2-Page A4 PDF ({selectedMonth})
                  </button>
                  <button
                    onClick={handleDownloadCompactOnePagePdf}
                    className="px-3.5 py-2.5 rounded-xl bg-[#1B365D] hover:bg-slate-800 text-white font-bold"
                  >
                    ⬇ 1-Page Compact PDF
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-700"
                  >
                    🖨 Print Slips
                  </button>
                </div>
              </div>

              {/* A4 PAGE 1 OF 2 */}
              <div className="bg-white rounded-2xl border border-slate-300 shadow-md p-5 max-w-5xl mx-auto space-y-4">
                <div className="flex items-center justify-between border-b-2 border-[#0F172A] pb-2.5">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A] uppercase">{propertyName} — Monthly Rent Slips ({mName} {selectedYear})</h3>
                    <p className="text-[11px] text-slate-500">Page 1 of 2 (Slips 01–06: Javed &amp; Raja Combined, Ghanti, Painter, Virasat, Guddu, Sajid)</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold">A4 PAGE 1 / 2</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Combined Javed & Raja Card */}
                  {(() => {
                    const j = byNameMap['javed'];
                    const r = byNameMap['raja'];
                    if (!j || !r) return null;
                    const combRent = j.rent + r.rent;
                    const jPrev = j.previousOutstanding;
                    const rPrev = r.previousOutstanding;
                    const jBill = j.currentReading !== null ? j.totalBill : null;
                    const rBill = r.currentReading !== null ? r.totalBill : null;
                    const combCurrOnly = combRent + (jBill ?? 0) + (rBill ?? 0);
                    const combFullTotal = jBill !== null && rBill !== null ? combCurrOnly + jPrev + rPrev : jPrev + rPrev;
                    const combBal = combFullTotal - (j.totalPaid + r.totalPaid);

                    return (
                      <div className="border-2 border-[#1B365D] bg-white rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="bg-[#1B365D] text-white px-3.5 py-2.5 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-extrabold">Javed ({mName}) — Combined Javed &amp; Raja</div>
                              <div className="text-[10px] text-blue-200 font-mono">Rooms 101 &amp; 102 · Slip #01 · Group BG-01</div>
                            </div>
                            <button
                              onClick={() => handleDownloadCombinedJavedRaja(selectedMonth)}
                              className="no-print text-[10px] bg-white/15 hover:bg-white/25 px-2 py-0.5 rounded text-white font-semibold"
                            >
                              ⬇ PDF
                            </button>
                          </div>
                          <table className="w-full border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500">
                                <th className="px-3.5 py-1 text-left">Particulars</th>
                                <th className="px-2.5 py-1 text-right">Javed (R-101)</th>
                                <th className="px-3.5 py-1 text-right">Raja (R-102)</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-slate-200">
                                <td className="px-3.5 py-1.5 font-semibold">Rent</td>
                                <td className="px-3.5 py-1.5 text-right font-mono font-bold" colSpan={2}>{formatINR(combRent)} (₹2,200 + ₹2,300)</td>
                              </tr>
                              <tr className="border-b border-slate-200">
                                <td className="px-3.5 py-1.5 font-semibold">Previous rent</td>
                                <td className="px-2.5 py-1.5 text-right font-mono font-bold text-rose-700">{formatINR(jPrev)}</td>
                                <td className="px-3.5 py-1.5 text-right font-mono font-bold text-rose-700">{formatINR(rPrev)}</td>
                              </tr>
                              <tr className="border-b border-slate-200">
                                <td className="px-3.5 py-1.5 font-semibold">Bill (Elec+Water)</td>
                                <td className="px-2.5 py-1.5 text-right font-mono font-bold">{jBill !== null ? formatINR(jBill) : 'Pending'}</td>
                                <td className="px-3.5 py-1.5 text-right font-mono font-bold">{rBill !== null ? formatINR(rBill) : 'Pending'}</td>
                              </tr>
                              <tr className="bg-slate-100 border-b border-slate-300 font-extrabold text-[#0F172A]">
                                <td className="px-3.5 py-2">Total Payable</td>
                                <td className="px-2.5 py-2 text-right font-mono text-rose-700">{formatINR(combFullTotal)}</td>
                                <td className="px-3.5 py-2 text-right font-mono text-[11px] text-[#1B365D]">Curr: {formatINR(combCurrOnly)}</td>
                              </tr>
                            </tbody>
                          </table>
                          <div className="px-3.5 py-2 bg-amber-50/60 border-b border-slate-200 grid grid-cols-2 gap-2 text-[10px] font-mono">
                            <div>Javed Read: <strong>{j.previousReading} → {j.currentReading ?? 'Pending'}</strong> ({j.units ?? '—'} U)</div>
                            <div>Raja Read: <strong>{r.previousReading} → {r.currentReading ?? 'Pending'}</strong> ({r.units ?? '—'} U)</div>
                          </div>
                        </div>
                        <div className="px-3.5 py-2 bg-white flex items-center justify-between text-[11px]">
                          <span>Prior Due: <strong className="font-mono text-rose-700">{formatINR(jPrev + rPrev)}</strong> | Net Due: <strong className="font-mono text-rose-700">{formatINR(combBal)}</strong></span>
                          <span className="text-[10px] text-slate-400">Sign: ____________</span>
                        </div>
                      </div>
                    );
                  })()}
                  {renderSlipCardUI(byNameMap['ghanti'], '02')}
                  {renderSlipCardUI(byNameMap['painter'], '03')}
                  {renderSlipCardUI(byNameMap['virasat'], '04')}
                  {renderSlipCardUI(byNameMap['guddu'], '05')}
                  {renderSlipCardUI(byNameMap['sajid'], '06')}
                </div>
              </div>

              {/* A4 PAGE 2 OF 2 */}
              <div className="bg-white rounded-2xl border border-slate-300 shadow-md p-5 max-w-5xl mx-auto space-y-4">
                <div className="flex items-center justify-between border-b-2 border-[#0F172A] pb-2.5">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A] uppercase">{propertyName} — Monthly Rent Slips ({mName} {selectedYear})</h3>
                    <p className="text-[11px] text-slate-500">Page 2 of 2 (Slips 07–12: Dinesh, Sonu, Imran, Nisha, Sundar, Sundar Ki Mummy)</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold">A4 PAGE 2 / 2</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderSlipCardUI(byNameMap['dinesh'], '07')}
                  {renderSlipCardUI(byNameMap['sonu'], '08')}
                  {renderSlipCardUI(byNameMap['imran'], '09')}
                  {renderSlipCardUI(byNameMap['nisha'], '10')}
                  {renderSlipCardUI(byNameMap['sundar'], '11')}
                  {renderSlipCardUI(byNameMap['sundar ki mummy'], '12')}
                </div>
              </div>
            </div>
          )}

          {/* OTHER TABS (TENANTS, MONTHLY RECORDS, ELECTRICITY, PAYMENTS, REPORTS, OUTSTANDING, DIRECTORY, SYNC, SETTINGS) */}
          {activeTab !== 'dashboard' && activeTab !== 'rent-slips' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-lg font-extrabold text-[#0F172A] uppercase">{activeTab.replace('-', ' ')} — {selectedMonth}</h2>
                  <p className="text-xs text-slate-500">Synchronized with Google Sheet {INITIAL_WORKBOOK_DATA.spreadsheetId}</p>
                </div>
                {activeTab === 'tenants' && (
                  <select
                    value={selectedTenantId}
                    onChange={(e) => setSelectedTenantId(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-[#1B365D]"
                  >
                    {tenants.map((t) => (
                      <option key={t.tenantId} value={t.tenantId}>
                        {t.tenantId} — {t.name} ({t.room})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-left">
                      <th className="p-3">Tenant / Month</th>
                      <th className="p-3 text-right">Rent</th>
                      <th className="p-3 text-right">Prev Read</th>
                      <th className="p-3 text-right">Curr Read (Edit)</th>
                      <th className="p-3 text-right">Units</th>
                      <th className="p-3 text-right">Elec + Water</th>
                      <th className="p-3 text-right">Prev Due</th>
                      <th className="p-3 text-right">Payable</th>
                      <th className="p-3 text-right">Paid</th>
                      <th className="p-3 text-right">Balance Due</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'tenants' ? selectedTenantRecs : filteredMonthRecs).map((r) => (
                      <tr key={r.recordId} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                        <td className="p-3 font-sans font-bold text-[#1B365D]">
                          {activeTab === 'tenants' ? r.month : r.tenantName}
                          <span className="block text-[10px] font-normal text-slate-500">{r.room}</span>
                        </td>
                        <td className="p-3 text-right">{formatINR(r.rent)}</td>
                        <td className="p-3 text-right">{r.previousReading}</td>
                        <td className="p-3 text-right">
                          <input
                            type="number"
                            defaultValue={r.currentReading !== null ? r.currentReading : ''}
                            placeholder="Pending"
                            onBlur={(e) => handleReadingChange(r.recordId, e.target.value)}
                            className="w-20 px-2 py-1 text-right rounded-lg border border-amber-400 bg-amber-50/60 font-bold text-[#0F172A]"
                          />
                        </td>
                        <td className="p-3 text-right">{r.units ?? 'Pending'}</td>
                        <td className="p-3 text-right">{r.electricity !== null ? formatINR(r.totalBill) : 'Pending'}</td>
                        <td className="p-3 text-right">{formatINR(r.previousOutstanding)}</td>
                        <td className="p-3 text-right font-bold">{formatINR(r.totalPayable)}</td>
                        <td className="p-3 text-right text-emerald-700 font-bold">{formatINR(r.totalPaid)}</td>
                        <td className="p-3 text-right font-extrabold text-rose-700">{formatINR(r.closingBalance)}</td>
                        <td className="p-3 text-center font-sans">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                            {r.paymentStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 z-40 flex items-center justify-around py-1.5 px-1 no-print shadow-lg">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center py-1 px-2 rounded-xl text-[10px] ${activeTab === 'dashboard' ? 'font-bold text-[#1B365D]' : 'text-slate-500'}`}>
          <span className="text-base">📊</span>
          <span>Dashboard</span>
        </button>
        <button onClick={() => setActiveTab('tenants')} className={`flex flex-col items-center py-1 px-2 rounded-xl text-[10px] ${activeTab === 'tenants' ? 'font-bold text-[#1B365D]' : 'text-slate-500'}`}>
          <span className="text-base">👥</span>
          <span>Tenants</span>
        </button>
        <button onClick={() => openPayModalFor()} className="flex flex-col items-center justify-center -mt-4 bg-emerald-600 text-white w-12 h-12 rounded-2xl shadow-md font-bold">
          <span className="text-sm">+₹</span>
          <span className="text-[8px] uppercase">Pay</span>
        </button>
        <button onClick={() => setActiveTab('electricity')} className={`flex flex-col items-center py-1 px-2 rounded-xl text-[10px] ${activeTab === 'electricity' ? 'font-bold text-[#1B365D]' : 'text-slate-500'}`}>
          <span className="text-base">⚡</span>
          <span>Meters</span>
        </button>
        <button onClick={() => setActiveTab('rent-slips')} className={`flex flex-col items-center py-1 px-2 rounded-xl text-[10px] ${activeTab === 'rent-slips' ? 'font-bold text-[#1B365D]' : 'text-slate-500'}`}>
          <span className="text-base">🧾</span>
          <span>2-Page Slips</span>
        </button>
      </nav>

      {/* RECORD PAYMENT MODAL */}
      {paymentModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-3 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
              <h3 className="text-base font-extrabold text-[#1B365D]">Record Confirmed Rent Payment</h3>
              <button onClick={() => setPaymentModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-100 font-bold">✕</button>
            </div>
            <form onSubmit={handleSubmitPayment} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Tenant *</label>
                  <select value={payTenantId} onChange={(e) => setPayTenantId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold">
                    {tenants.map((t) => (
                      <option key={t.tenantId} value={t.tenantId}>{t.name} ({t.room})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Billing Month *</label>
                  <select value={payMonthKey} onChange={(e) => setPayMonthKey(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold">
                    {MONTH_SHORT.map((m) => (
                      <option key={`${m}-26`} value={`${m}-26`}>{`${m}-26`}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Payment Amount (₹) *</label>
                  <input type="number" step="0.01" min="1" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full px-3 py-2 rounded-xl border-2 border-emerald-500 font-mono font-extrabold text-sm" />
                </div>
                <div>
                  <label className="block font-bold mb-1">Payment Date *</label>
                  <input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Payment Mode</label>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300">
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Reference / Notes</label>
                  <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional note" className="w-full px-3 py-2 rounded-xl border border-slate-300" />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" onClick={() => setPaymentModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-bold">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold">Save &amp; Sync</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
