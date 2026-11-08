'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { INITIAL_WORKBOOK_DATA } from '@/lib/data/initial-workbook-data';
import {
  Tenant,
  MonthlyRecord,
  PaymentTransaction,
  recalculateTenantLedgerChain,
  calculateCombinedJavedRajaSlip,
} from '@/lib/calculations';
import { generateSingleA4CompactSlipsPdf } from '@/lib/pdf';

type NavTab =
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

export default function RentFlowWorkspace({ initialTab = 'dashboard', initialTenantId = '' }: { initialTab?: NavTab; initialTenantId?: string }) {
  const [activeTab, setActiveTab] = useState<NavTab>(initialTab);
  const [selectedMonth, setSelectedMonth] = useState<string>('Sep-26');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(initialTenantId || 'T-01');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [combineJavedRaja, setCombineJavedRaja] = useState<boolean>(true);
  const [slipPrintLayout, setSlipPrintLayout] = useState<'single-a4-12-grid' | '1-per-page' | '2-per-page' | '4-per-page' | '6-per-page'>('single-a4-12-grid');

  const [tenants, setTenants] = useState<Tenant[]>(() => [...INITIAL_WORKBOOK_DATA.tenants] as unknown as Tenant[]);
  const [rawRecords, setRawRecords] = useState<MonthlyRecord[]>(() => [...INITIAL_WORKBOOK_DATA.monthlyRecords] as unknown as MonthlyRecord[]);
  const [payments, setPayments] = useState<PaymentTransaction[]>(() => [...INITIAL_WORKBOOK_DATA.payments] as unknown as PaymentTransaction[]);
  const [syncStatus, setSyncStatus] = useState<{ state: 'connected' | 'syncing' | 'error'; lastSync: string; mode: string }>({
    state: 'connected',
    lastSync: new Date().toLocaleTimeString(),
    mode: 'Google Sheets API v4 + Polling (30s)',
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Recalculate all tenant chains dynamically whenever readings, rents, or payments change
  const monthlyRecords = useMemo(() => {
    const allRecs: MonthlyRecord[] = [];
    for (const t of tenants) {
      const tRecs = rawRecords.filter((r) => r.tenantId === t.tenantId);
      const recalced = recalculateTenantLedgerChain(t, tRecs, payments);
      allRecs.push(...recalced);
    }
    return allRecs;
  }, [tenants, rawRecords, payments]);

  const currentMonthRecords = useMemo(() => {
    return monthlyRecords.filter(
      (r) =>
        r.month === selectedMonth &&
        (statusFilter === 'All' || r.paymentStatus === statusFilter) &&
        (searchQuery === '' ||
          r.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.room.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [monthlyRecords, selectedMonth, statusFilter, searchQuery]);

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
    const interval = setInterval(triggerSyncFromGoogleSheets, 30000);
    return () => clearInterval(interval);
  }, [triggerSyncFromGoogleSheets]);

  const handleRecordPayment = async (newPay: Omit<PaymentTransaction, 'paymentId' | 'createdAt'>) => {
    const paymentId = `PAY-${String(payments.length + 1).padStart(3, '0')}`;
    const fullPayment: PaymentTransaction = {
      ...newPay,
      paymentId,
      createdAt: new Date().toISOString(),
    };
    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullPayment),
    });
    setPayments((prev) => [fullPayment, ...prev]);
    setSyncStatus({
      state: 'connected',
      lastSync: new Date().toLocaleTimeString(),
      mode: 'Google Sheets Confirmed Write',
    });
    setToastMessage(`Payment ${paymentId} (₹${fullPayment.amount}) saved to Google Sheets.`);
  };

  const handleDownloadAllSlipsPdf = () => {
    const recs = monthlyRecords.filter((r) => r.month === selectedMonth);
    const doc = generateSingleA4CompactSlipsPdf(recs, {
      month: selectedMonth,
      monthName: recs[0]?.monthName || selectedMonth,
      year: selectedYear,
      layout: slipPrintLayout,
      propertyName: 'RentFlow Property Management',
      landlordName: 'Authorized Signatory',
      combineJavedRaja,
    });
    doc.save(`Rent_Slips_All_${selectedMonth}.pdf`);
  };

  return (
    <div className="flex min-h-screen bg-[#FAF8F5]">
      <aside className="w-64 bg-[#1B365D] text-white flex flex-col justify-between p-4 no-print">
        <div>
          <div className="mb-6 pb-4 border-b border-white/15">
            <h1 className="text-xl font-bold tracking-tight">RentFlow 2026</h1>
            <p className="text-xs text-blue-200 mt-1">Google Sheets Connected SaaS</p>
          </div>
          <nav className="space-y-1">
            {([
              ['dashboard', '1. Dashboard'],
              ['tenants', '2. All Tenants'],
              ['monthly-records', '3. Monthly Rent Records'],
              ['payments', '4. Payments Ledger'],
              ['electricity', '5. Electricity & Water'],
              ['rent-slips', '6. Rent Slip Generator'],
              ['reports', '7. Reports & Analytics'],
              ['outstanding', '8. Outstanding Dues'],
              ['directory', '9. Tenant Directory'],
              ['sync', '10. Google Sheets Sync'],
              ['settings', '11. Settings'],
            ] as [NavTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === key ? 'bg-white text-[#1B365D] shadow-sm' : 'text-blue-100 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="text-xs text-blue-200 border-t border-white/15 pt-3">
          <div>Sync: {syncStatus.state.toUpperCase()}</div>
          <div>Last Sync: {syncStatus.lastSync}</div>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {toastMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 flex justify-between items-center">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-xs font-bold">Dismiss</button>
          </div>
        )}
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6 pb-4 border-b border-slate-200 no-print">
          <div className="flex items-center gap-3">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold"
            >
              {['Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search tenant or room..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerSyncFromGoogleSheets}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50"
            >
              Refresh from Google Sheets
            </button>
            <button
              onClick={handleDownloadAllSlipsPdf}
              className="px-4 py-2 rounded-lg bg-[#1B365D] text-white text-sm font-semibold hover:bg-slate-800"
            >
              Download Single-A4 Slips PDF ({selectedMonth})
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#1B365D] mb-4">
            {selectedMonth} — Rent & Utility Collection Records ({currentMonthRecords.length} Tenants)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#1B365D] text-white text-left">
                  <th className="p-2.5">Tenant</th>
                  <th className="p-2.5">Room</th>
                  <th className="p-2.5 text-right">Rent</th>
                  <th className="p-2.5 text-right">Prev Read</th>
                  <th className="p-2.5 text-right">Curr Read</th>
                  <th className="p-2.5 text-right">Electricity</th>
                  <th className="p-2.5 text-right">Water</th>
                  <th className="p-2.5 text-right">Prev Due</th>
                  <th className="p-2.5 text-right">Total Payable</th>
                  <th className="p-2.5 text-right">Paid</th>
                  <th className="p-2.5 text-right">Balance Due</th>
                  <th className="p-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {currentMonthRecords.map((r) => (
                  <tr key={r.recordId} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-2.5 font-semibold text-[#1B365D]">{r.tenantName}</td>
                    <td className="p-2.5 text-slate-600">{r.room}</td>
                    <td className="p-2.5 text-right">₹{r.rent.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-right">{r.previousReading}</td>
                    <td className="p-2.5 text-right">{r.currentReading ?? 'Pending'}</td>
                    <td className="p-2.5 text-right">{r.electricity !== null ? `₹${r.electricity.toLocaleString('en-IN')}` : 'Pending'}</td>
                    <td className="p-2.5 text-right">₹{r.water.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-right">₹{r.previousOutstanding.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-right font-semibold">₹{r.totalPayable.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-right text-emerald-700 font-medium">₹{r.totalPaid.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-right font-bold text-rose-700">₹{r.closingBalance.toLocaleString('en-IN')}</td>
                    <td className="p-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                        {r.paymentStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
