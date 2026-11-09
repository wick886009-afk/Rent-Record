'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { INITIAL_WORKBOOK_DATA, APPS_SCRIPT_CODE } from '@/lib/data/initial-workbook-data';
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

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Always returns the billing month PRIOR to the current calendar month (e.g. Oct-26 when current month is November 2026)
function getCurrentMonthKeyAndYear(): { monthKey: string; year: number; currCalendarMonthKey: string } {
  const now = new Date();
  const currY = now.getFullYear() >= 2026 ? now.getFullYear() : 2026;
  const currM = now.getMonth(); // 0=Jan .. 10=Nov
  const priorM = currM === 0 ? 11 : currM - 1;
  const priorY = currM === 0 ? Math.max(2026, currY - 1) : currY;
  return {
    monthKey: `${MONTH_SHORT[priorM]}-${String(priorY).slice(-2)}`,
    year: priorY,
    currCalendarMonthKey: `${MONTH_SHORT[currM]}-${String(currY).slice(-2)}`,
  };
}

function normalizeIncomingMonthKey(raw: any): string {
  if (!raw) return 'Oct-26';
  const s = String(raw).trim();
  for (let i = 0; i < MONTH_SHORT.length; i++) {
    const m = MONTH_SHORT[i];
    if (s.toLowerCase().startsWith(m.toLowerCase() + '-')) {
      const yy = s.split('-')[1].slice(0, 2);
      return m + '-' + yy;
    }
  }
  const tokens = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  for (let i = 0; i < MONTH_SHORT.length; i++) {
    const m = MONTH_SHORT[i];
    const idx = tokens.findIndex((t) => t.toLowerCase().slice(0, 3) === m.toLowerCase());
    if (idx !== -1) {
      const nextTok = parseInt(tokens[idx + 1] || '', 10);
      if (nextTok >= 25 && nextTok <= 35) {
        return m + '-' + String(nextTok).padStart(2, '0');
      }
      const yrTok = tokens.find((t) => t.length === 4 && t.startsWith('20'));
      return m + '-' + (yrTok ? yrTok.slice(-2) : '26');
    }
  }
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') {
    const yyIso = s.slice(2, 4);
    const mIdx = parseInt(s.slice(5, 7), 10) - 1;
    const dNum = parseInt(s.slice(8, 10), 10);
    const yy = dNum >= 25 && dNum <= 35 ? String(dNum) : yyIso;
    if (mIdx >= 0 && mIdx < 12) return MONTH_SHORT[mIdx] + '-' + yy;
  }
  return s;
}

function normalizeIncomingDateIso(raw: any): string {
  if (!raw) return getTodayIsoDate();
  const s = String(raw).trim();
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
  const tokens = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  for (let i = 0; i < MONTH_SHORT.length; i++) {
    const m = MONTH_SHORT[i];
    const idx = tokens.findIndex((t) => t.toLowerCase().slice(0, 3) === m.toLowerCase());
    if (idx !== -1 && tokens[idx + 1] && tokens[idx + 2] && tokens[idx + 2].length === 4) {
      const d = String(parseInt(tokens[idx + 1], 10)).padStart(2, '0');
      const mNum = String(i + 1).padStart(2, '0');
      return tokens[idx + 2] + '-' + mNum + '-' + d;
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return s;
}

function savePermanentWebhookStorage(url: string) {
  const clean = String(url || '').trim();
  try {
    localStorage.setItem('rentflow_apps_script_url', clean);
    localStorage.setItem('rentflow_permanent_webhook_v1', clean);
  } catch {}
  try {
    sessionStorage.setItem('rentflow_apps_script_url', clean);
  } catch {}
  try {
    document.cookie = `rentflow_apps_script_url=${encodeURIComponent(clean)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
  try {
    let wn: any = {};
    if (typeof window !== 'undefined' && window.name && window.name.startsWith('{')) {
      wn = JSON.parse(window.name);
    }
    wn.rentflowAppsScriptUrl = clean;
    if (typeof window !== 'undefined') window.name = JSON.stringify(wn);
  } catch {}
}

function loadPermanentWebhookStorage(): string {
  let url = '';
  try {
    url = localStorage.getItem('rentflow_permanent_webhook_v1') || localStorage.getItem('rentflow_apps_script_url') || '';
  } catch {}
  if (!url) {
    try {
      url = sessionStorage.getItem('rentflow_apps_script_url') || '';
    } catch {}
  }
  if (!url && typeof document !== 'undefined') {
    try {
      const m = document.cookie.match(/(?:^|;\s*)rentflow_apps_script_url=([^;]+)/);
      if (m) url = decodeURIComponent(m[1]);
    } catch {}
  }
  if (!url && typeof window !== 'undefined') {
    try {
      if (window.name && window.name.startsWith('{')) {
        const wn = JSON.parse(window.name);
        if (wn?.rentflowAppsScriptUrl) url = wn.rentflowAppsScriptUrl;
      }
    } catch {}
  }
  return String(url || process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || '').trim();
}

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
  const [autoFollowCurrentMonth, setAutoFollowCurrentMonth] = useState<boolean>(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthKeyAndYear().monthKey);
  const [selectedYear, setSelectedYear] = useState<number>(() => getCurrentMonthKeyAndYear().year);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(initialTenantId || 'T-01');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [combineJavedRaja, setCombineJavedRaja] = useState<boolean>(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [connectModalOpen, setConnectModalOpen] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<'admin' | 'viewer'>('admin');
  const [propertyName, setPropertyName] = useState<string>('RentFlow Property Management');
  const [defaultElecRate, setDefaultElecRate] = useState<number>(7);
  const [motor1WaterCharge, setMotor1WaterCharge] = useState<number>(10);
  const [motor2WaterCharge, setMotor2WaterCharge] = useState<number>(25);

  // Live Clock & Today's Date
  const [liveDateTimeStr, setLiveDateTimeStr] = useState<string>('');
  const [appsScriptUrl, setAppsScriptUrl] = useState<string>('');
  const [appsScriptSecret, setAppsScriptSecret] = useState<string>('rentflow-webhook-secret-2026');

  // Payment Modal State (Auto-fetches current date on open!)
  const [payTenantId, setPayTenantId] = useState<string>('T-01');
  const [payMonthKey, setPayMonthKey] = useState<string>(() => getCurrentMonthKeyAndYear().monthKey);
  const [payAmount, setPayAmount] = useState<string>('2500');
  const [payDate, setPayDate] = useState<string>(getTodayIsoDate());
  const [payMethod, setPayMethod] = useState<string>('Cash');
  const [payType, setPayType] = useState<string>('Payment');
  const [payRef, setPayRef] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');

  const [tenants, setTenants] = useState<Tenant[]>(() => [...INITIAL_WORKBOOK_DATA.tenants] as unknown as Tenant[]);
  const [rawRecords, setRawRecords] = useState<MonthlyRecord[]>(() => [...INITIAL_WORKBOOK_DATA.monthlyRecords] as unknown as MonthlyRecord[]);
  const [payments, setPayments] = useState<PaymentTransaction[]>(() => [...INITIAL_WORKBOOK_DATA.payments] as unknown as PaymentTransaction[]);
  const [auditLog, setAuditLog] = useState<Array<{ timestamp: string; user: string; record: string; action: string; oldVal: string; newVal: string }>>([
    { timestamp: '2026-11-08 13:30:00', user: 'System Audit', record: 'All 13 Tenant Sheets (Oct-Dec)', action: 'Formula Repair', oldVal: '=IMSUB(D12,E12) -> Negative Bills', newVal: 'IF(ISBLANK(D12),"Reading Pending",D12-E12)' },
    { timestamp: '2026-11-08 13:32:00', user: 'System Audit', record: 'Javed & Raja (BG-01)', action: 'Combined Slip Preserved', oldVal: 'Javed!A34:C34 Blank in Sep', newVal: 'Curr Only (₹5,360) & Full Total (₹11,350) Linked' },
    { timestamp: '2026-11-08 17:05:00', user: 'Admin', record: 'Rent Slip Engine', action: '2-Page A4 Upgrade', oldVal: '1-Page Cramped Grid', newVal: 'Spacious 2-Page A4 Slips (6 per page)' },
  ]);

  const [syncStatus, setSyncStatus] = useState<{ state: 'connected' | 'syncing' | 'error'; lastSync: string; mode: string }>({
    state: 'connected',
    lastSync: 'Just now',
    mode: 'Google Sheets API v4 + Apps Script Bridge',
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live Clock Ticker + Load Saved State / Apps Script URL
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setLiveDateTimeStr(
        now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) +
          ' · ' +
          now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);

    try {
      const savedUrl = loadPermanentWebhookStorage();
      if (savedUrl) setAppsScriptUrl(savedUrl);
      const savedState = localStorage.getItem('rentflow_state_v2026_oct_v3');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        if (Array.isArray(parsed.rawRecords) && parsed.rawRecords.length > 0) {
          setRawRecords((prev) => {
            const byId = new Map<string, any>();
            parsed.rawRecords.forEach((r: any) => byId.set(r.recordId, r));
            return prev.map((r) => {
              const sr = byId.get(r.recordId);
              if (!sr) return r;
              return {
                ...r,
                currentReading: sr.currentReading !== null && sr.currentReading !== undefined ? sr.currentReading : r.currentReading,
                credits: sr.credits || r.credits,
              };
            });
          });
        }
        if (Array.isArray(parsed.payments) && parsed.payments.length > 0) {
          setPayments((prev) => {
            const payMap = new Map<string, PaymentTransaction>();
            prev.forEach((p) => payMap.set(p.paymentId, p));
            parsed.payments.forEach((p: any) => {
              if (p && p.paymentId && Number(p.amount) > 0) {
                payMap.set(p.paymentId, {
                  ...p,
                  month: normalizeIncomingMonthKey(p.month),
                  date: normalizeIncomingDateIso(p.date),
                });
              }
            });
            return Array.from(payMap.values());
          });
        }
      }
    } catch {}

    return () => clearInterval(timer);
  }, []);

  // Save state changes to localStorage & push to Apps Script Webhook if configured
  const persistStateAndPush = useCallback(
    async (
      nextTenants: Tenant[],
      nextRawRecords: MonthlyRecord[],
      nextPayments: PaymentTransaction[],
      actionName: string,
      recordLabel: string,
      oldVal: string,
      newVal: string,
      payload: any
    ) => {
      try {
        localStorage.setItem(
          'rentflow_state_v2026_oct_v3',
          JSON.stringify({
            tenants: nextTenants,
            rawRecords: nextRawRecords,
            payments: nextPayments,
          })
        );
      } catch {}

      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setAuditLog((prev) => [
        {
          timestamp: nowIso,
          user: userRole === 'admin' ? 'Admin (Web)' : 'Viewer',
          record: recordLabel,
          action: actionName,
          oldVal,
          newVal,
        },
        ...prev,
      ]);

      setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
      try {
        await fetch('/api/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhookUrl: appsScriptUrl,
            secret: appsScriptSecret,
            action: actionName,
            payload,
          }),
        });
        setSyncStatus({
          state: 'connected',
          lastSync: new Date().toLocaleTimeString(),
          mode: appsScriptUrl ? 'Apps Script Live Webhook' : 'Google Sheets API v4',
        });
      } catch {
        setSyncStatus((prev) => ({ ...prev, state: 'connected', lastSync: new Date().toLocaleTimeString() }));
      }
    },
    [appsScriptUrl, appsScriptSecret, userRole]
  );

  // Recalculate all tenant chains dynamically
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

  const applyRemoteSyncData = useCallback((remote: any, sourceLabel: string) => {
    if (!remote) return false;
    let updated = false;
    if (Array.isArray(remote.liveReadings) && remote.liveReadings.length > 0) {
      setRawRecords((prev) => {
        const byId = new Map<string, any>();
        remote.liveReadings.forEach((lr: any) => byId.set(lr.recordId, lr));
        return prev.map((r) => {
          const match = byId.get(r.recordId);
          if (!match) return r;
          return {
            ...r,
            rent: match.rent !== undefined ? Number(match.rent) : r.rent,
            currentReading: match.currentReading,
            water: match.water !== undefined ? Number(match.water) : r.water,
            credits: match.credits !== undefined ? Number(match.credits) : r.credits,
          };
        });
      });
      updated = true;
    }
    if (Array.isArray(remote.payments) && remote.payments.length > 0) {
      setPayments((prev) => {
        const payMap = new Map<string, PaymentTransaction>();
        prev.forEach((p) => payMap.set(p.paymentId, p));
        remote.payments.forEach((p: any, idx: number) => {
          const rawName = String(p.tenantName || '').trim();
          const matchedT =
            tenants.find(
              (t) =>
                t.tenantId === p.tenantId ||
                t.name.toLowerCase() === rawName.toLowerCase() ||
                (t.sheetName && t.sheetName.toLowerCase() === rawName.toLowerCase())
            ) || tenants[0];
          const normMonth = normalizeIncomingMonthKey(p.month);
          const mIdx = Math.max(1, MONTH_SHORT.indexOf(normMonth.split('-')[0]) + 1);
          const normDate = normalizeIncomingDateIso(p.date);
          const pid = String(p.paymentId || `PAY-${String(idx + 1).padStart(3, '0')}`).trim();
          if (Number(p.amount) > 0) {
            payMap.set(pid, {
              paymentId: pid,
              tenantId: matchedT.tenantId,
              tenantName: matchedT.name,
              recordId: `REC-2026-${String(mIdx).padStart(2, '0')}-${matchedT.tenantId}`,
              month: normMonth,
              year: Number(p.year) || 2026,
              date: normDate,
              amount: Number(p.amount) || 0,
              method: String(p.method || 'Cash'),
              reference: String(p.reference || ''),
              type: String(p.type || 'Payment'),
              notes: String(p.notes || ''),
              createdAt: String(p.createdAt || `${normDate}T10:00:00Z`),
            });
          }
        });
        return Array.from(payMap.values());
      });
      updated = true;
    }
    setSyncStatus({
      state: 'connected',
      lastSync: new Date().toLocaleTimeString(),
      mode: sourceLabel,
    });
    return updated;
  }, []);

  const triggerSyncFromGoogleSheets = useCallback(async () => {
    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    try {
      // 1. If Apps Script Web App URL is configured, also try direct CORS fetch from browser first for instant sync
      if (appsScriptUrl && appsScriptUrl.startsWith('https://script.google.com/')) {
        try {
          const directRes = await fetch(appsScriptUrl, { method: 'GET', cache: 'no-store' });
          if (directRes.ok) {
            const directJson = await directRes.json();
            if (directJson && directJson.ok) {
              applyRemoteSyncData(directJson, 'Apps Script Live Two-Way Sync');
              setToastMessage('Pulled latest live meter readings & payments from Google Sheet via Apps Script!');
              return;
            }
          }
        } catch {}
      }

      // 2. Query Next.js Server API Route (/api/sheets)
      const activeUrl = appsScriptUrl || loadPermanentWebhookStorage();
      const q = activeUrl ? `?webhookUrl=${encodeURIComponent(activeUrl)}` : '';
      const res = await fetch(`/api/sheets${q}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.webhookUrl && !appsScriptUrl) {
          setAppsScriptUrl(json.webhookUrl);
          savePermanentWebhookStorage(json.webhookUrl);
        }
        const remotePayload = json.remoteData || json.data;
        if (remotePayload && (remotePayload.liveReadings || remotePayload.mode === 'live-service-account')) {
          applyRemoteSyncData(remotePayload, json.mode === 'apps-script-live' ? 'Apps Script Live Sync' : 'Service Account Live Sync');
          setToastMessage('Synchronized live records from Google Sheets.');
          return;
        }
        setSyncStatus({
          state: 'connected',
          lastSync: new Date().toLocaleTimeString(),
          mode: appsScriptUrl ? 'Apps Script Linked' : 'Local Cache (Connect Apps Script for Live Sheet Sync)',
        });
        setToastMessage(
          appsScriptUrl
            ? 'Checked Google Sheet sync status.'
            : 'Local state active. Click "🔗 Connect Sheet" and paste your Apps Script Web App URL for live 2-way Google Sheet sync.'
        );
      }
    } catch {
      setSyncStatus((prev) => ({ ...prev, state: 'error' }));
    }
  }, [appsScriptUrl, applyRemoteSyncData]);

  useEffect(() => {
    triggerSyncFromGoogleSheets();
    const interval = setInterval(triggerSyncFromGoogleSheets, 30000);
    return () => clearInterval(interval);
  }, [triggerSyncFromGoogleSheets]);

  // Open Record Payment Modal — ALWAYS auto-fetches today's live date!
  const openPayModalFor = (tId?: string, mKey?: string) => {
    const targetTid = tId || selectedTenantId || 'T-01';
    const targetMonth = mKey || selectedMonth || 'Sep-26';
    setPayTenantId(targetTid);
    setPayMonthKey(targetMonth);
    setPayDate(getTodayIsoDate()); // Automatically fetches today's current date!
    const rec = monthlyRecords.find((r) => r.tenantId === targetTid && r.month === targetMonth);
    if (rec) {
      setPayAmount(String(rec.closingBalance > 0 ? rec.closingBalance : rec.rent));
    }
    setPayRef('');
    setPayNotes('');
    setPaymentModalOpen(true);
  };

  const handleJumpToLiveMonth = () => {
    const { monthKey, year } = getCurrentMonthKeyAndYear();
    setSelectedYear(year);
    setSelectedMonth(monthKey);
    setToastMessage(`Jumped to current live calendar period: ${monthKey} (Today: ${getTodayIsoDate()}).`);
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
      date: payDate || getTodayIsoDate(),
      amount: amt,
      method: payMethod,
      reference: payRef || `WEB-${paymentId}`,
      type: payType,
      notes: payNotes || `Recorded on ${payDate || getTodayIsoDate()} (${payMethod})`,
      createdAt: new Date().toISOString(),
    };

    const nextPayments = [fullPayment, ...payments];
    setPayments(nextPayments);
    setPaymentModalOpen(false);

    try {
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayment),
      });
    } catch {}

    await persistStateAndPush(
      tenants,
      rawRecords,
      nextPayments,
      'RECORD_PAYMENT',
      `${fullPayment.tenantName} (${fullPayment.month})`,
      '—',
      `${formatINR(amt)} [${paymentId}]`,
      fullPayment
    );
    setToastMessage(`Payment ${paymentId} (${formatINR(amt)}) dated ${fullPayment.date} saved & synced to Google Sheets.`);
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
      setToastMessage(`Validation Warning: Current reading (${newCurr}) is lower than Previous (${prevRead}). Enable Meter Reset if physical meter rolled over.`);
      return;
    }

    const nextRaw = rawRecords.map((r) => (r.recordId === recordId ? { ...r, currentReading: newCurr } : r));
    setRawRecords(nextRaw);
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

    await persistStateAndPush(
      tenants,
      nextRaw,
      payments,
      'UPDATE_METER_READING',
      `${target.tenantName} (${target.month})`,
      String(target.currentReading ?? 'Pending'),
      String(newCurr ?? 'Pending'),
      { sheetName: tObj?.sheetName || target.tenantName, monthIndex: target.monthIndex, currentReading: newCurr }
    );
    setToastMessage(`Updated meter reading for ${target.tenantName} (${target.month}) to ${newCurr ?? 'Pending'}.`);
  };

  const handleCreditChange = async (recordId: string, valStr: string) => {
    if (userRole !== 'admin') return;
    const newCred = Math.max(0, Number(valStr) || 0);
    const target = rawRecords.find((r) => r.recordId === recordId);
    if (!target) return;
    const nextRaw = rawRecords.map((r) => (r.recordId === recordId ? { ...r, credits: newCred } : r));
    setRawRecords(nextRaw);
    await persistStateAndPush(
      tenants,
      nextRaw,
      payments,
      'UPDATE_CREDIT',
      `${target.tenantName} (${target.month})`,
      formatINR(target.credits || 0),
      formatINR(newCred),
      { recordId, credits: newCred }
    );
    setToastMessage(`Updated credit/adjustment for ${target.tenantName} (${target.month}) to ${formatINR(newCred)}.`);
  };

  const handleMeterResetToggle = (recordId: string, checked: boolean) => {
    if (userRole !== 'admin') return;
    setRawRecords((prev) => prev.map((r) => (r.recordId === recordId ? { ...r, meterReset: checked } : r)));
  };

  const handleTenantRentUpdate = async (tenantId: string, newRentStr: string) => {
    if (userRole !== 'admin') return;
    const newRent = Number(newRentStr);
    if (Number.isNaN(newRent) || newRent <= 0) return;
    const targetTenant = tenants.find((t) => t.tenantId === tenantId);
    if (!targetTenant) return;

    const nextTenants = tenants.map((t) => (t.tenantId === tenantId ? { ...t, monthlyRent: newRent } : t));
    // Update unbilled future months while preserving historical billed months
    const nextRaw = rawRecords.map((r) =>
      r.tenantId === tenantId && r.currentReading === null ? { ...r, rent: newRent } : r
    );
    setTenants(nextTenants);
    setRawRecords(nextRaw);
    await persistStateAndPush(
      nextTenants,
      nextRaw,
      payments,
      'UPDATE_TENANT_RENT',
      `${targetTenant.name} (${tenantId})`,
      formatINR(targetTenant.monthlyRent),
      formatINR(newRent),
      { tenantId, monthlyRent: newRent }
    );
    setToastMessage(`Updated scheduled rent for ${targetTenant.name} to ${formatINR(newRent)} (historical billed months preserved).`);
  };

  const handleTenantStatusUpdate = async (tenantId: string, newStatus: string) => {
    if (userRole !== 'admin') return;
    const targetTenant = tenants.find((t) => t.tenantId === tenantId);
    if (!targetTenant) return;
    const nextTenants = tenants.map((t) => (t.tenantId === tenantId ? { ...t, status: newStatus } : t));
    setTenants(nextTenants);
    await persistStateAndPush(
      nextTenants,
      rawRecords,
      payments,
      'UPDATE_TENANT_STATUS',
      `${targetTenant.name} (${tenantId})`,
      targetTenant.status,
      newStatus,
      { tenantId, status: newStatus }
    );
    setToastMessage(`Updated ${targetTenant.name} status to ${newStatus}.`);
  };

  const handleSaveAppsScriptUrl = (url: string) => {
    const clean = url.trim();
    setAppsScriptUrl(clean);
    savePermanentWebhookStorage(clean);
    setToastMessage(
      clean
        ? 'Permanently saved Google Apps Script Web App URL! All payments & meter readings sync across refreshes.'
        : 'Using permanent connected Google Sheet (1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s).'
    );
  };

  const handleCopyAppsScript = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(APPS_SCRIPT_CODE).catch(() => {});
    }
    setToastMessage('Copied full Google Apps Script (Code.gs) to clipboard!');
  };

  const handleRestoreHistoricalState = () => {
    try {
      localStorage.removeItem('rentflow_state_v2026_oct_v3');
    } catch {}
    setTenants([...INITIAL_WORKBOOK_DATA.tenants] as unknown as Tenant[]);
    setRawRecords([...INITIAL_WORKBOOK_DATA.monthlyRecords] as unknown as MonthlyRecord[]);
    setPayments([...INITIAL_WORKBOOK_DATA.payments] as unknown as PaymentTransaction[]);
    setSelectedYear(2026);
    const prior = getCurrentMonthKeyAndYear();
    setSelectedYear(prior.year);
    setSelectedMonth(prior.monthKey);
    setToastMessage(`Synchronized with latest Google Sheet baseline (13 tenants, 104 payments = ₹360,024, active billing month ${prior.monthKey}).`);
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

  const exportPaymentsCsv = () => {
    const headers = ['Payment ID','Tenant ID','Tenant Name','Month','Date','Amount','Method','Type','Reference','Notes'];
    const rows = payments.map((p) => [
      p.paymentId, p.tenantId, `"${p.tenantName}"`, p.month, p.date, p.amount, p.method, p.type, `"${p.reference || ''}"`, `"${p.notes || ''}"`
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RentFlow_Payments_Ledger_${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
  const selectedTenantObj = tenants.find((t) => t.tenantId === selectedTenantId) || tenants[0];
  const selectedTenantRecs = monthlyRecords.filter((r) => r.tenantId === selectedTenantObj.tenantId && r.year === selectedYear);
  const selectedTenantCurrRec = monthlyRecords.find((r) => r.tenantId === selectedTenantObj.tenantId && r.month === selectedMonth) || selectedTenantRecs[0];
  const selectedTenantPayments = payments.filter((p) => p.tenantId === selectedTenantObj.tenantId);

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

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAF8F5] text-[#1E293B] pb-20 lg:pb-0">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="w-full lg:w-64 bg-[#0F172A] text-white flex-shrink-0 flex flex-col justify-between no-print lg:sticky lg:top-0 lg:h-screen z-40">
        <div className="p-4 lg:p-5 overflow-y-auto">
          <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 font-extrabold text-sm flex items-center justify-center shadow-md">
                RF
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base font-extrabold tracking-tight leading-none">RentFlow</h1>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 rounded">Live 2026</span>
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
              ['dashboard', '📊 1. Dashboard', 'Overview'],
              ['tenants', '👥 2. All Tenants', String(tenants.length)],
              ['monthly-records', '📅 3. Monthly Records', selectedMonth],
              ['payments', '💳 4. Payments Ledger', String(payments.length)],
              ['electricity', '⚡ 5. Electricity & Water', 'Meters'],
              ['rent-slips', '🧾 6. 2-Page A4 Slips', '2-Page'],
              ['reports', '📈 7. Reports & Analytics', 'Annual'],
              ['outstanding', '🚨 8. Outstanding Dues', formatINR(totalOutstanding)],
              ['directory', '🏢 9. Tenant Directory', 'Master'],
              ['sync', '🔄 10. Connect & Sync Sheet', appsScriptUrl ? 'Linked' : 'Setup'],
              ['settings', '⚙️ 11. Settings & Security', userRole.toUpperCase()],
            ] as [NavTab, string, string][]).map(([key, label, badge]) => (
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
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeTab === key ? 'bg-slate-950/20 text-slate-950' : 'bg-white/10 text-slate-300'}`}>
                  {badge}
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-slate-800 text-[11px] space-y-2 bg-slate-950/60">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Sheet Connection:</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold text-[10px]">
              {appsScriptUrl ? 'Apps Script Linked' : syncStatus.state.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Last Sync:</span>
            <span className="font-mono text-slate-200">{syncStatus.lastSync}</span>
          </div>
          <button
            onClick={() => setConnectModalOpen(true)}
            className="w-full py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold transition border border-emerald-500/30 text-center"
          >
            🔗 Connect Apps Script URL
          </button>
          <a
            href={`https://docs.google.com/spreadsheets/d/${INITIAL_WORKBOOK_DATA.spreadsheetId}/edit`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition border border-slate-700"
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
                className="bg-transparent text-xs font-extrabold text-[#1B365D] focus:outline-none cursor-pointer"
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

            <button
              onClick={handleJumpToLiveMonth}
              title="Jump to Current Calendar Month"
              className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1.5 transition"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Today: {liveDateTimeStr || getTodayIsoDate()}</span>
            </button>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tenant, room, ID..."
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs w-44 sm:w-56 focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <a
              href="https://docs.google.com/spreadsheets/d/1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s/edit"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="hidden sm:inline">Sheet Live ↗</span>
            </a>
            <button
              onClick={() => setConnectModalOpen(true)}
              className="px-3 py-1.5 rounded-xl border bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <span>🔗</span>
              <span className="hidden sm:inline">Sheet Linked</span>
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
              🧾 2-Page Slips
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
          {/* ================================================================= */}
          {/* TAB 1: DASHBOARD                                                  */}
          {/* ================================================================= */}
          {activeTab === 'dashboard' && (
            <>
              <div className="rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#1B365D] to-slate-900 text-white p-5 shadow-md flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>Live Calendar Date: {getTodayIsoDate()} · Viewing Period: {selectedMonth}</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold">Property Financial Command Center</h2>
                  <p className="text-xs text-slate-300 mt-1">
                    13 Active Tenants · Combined Javed &amp; Raja Billing Group (BG-01) · Spacious 2-Page A4 Printable Rent Slips
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openPayModalFor()} className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs">
                    + Record Payment (Auto-Today)
                  </button>
                  <button onClick={() => setConnectModalOpen(true)} className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15">
                    🔗 Connect Apps Script
                  </button>
                  <button onClick={() => setActiveTab('rent-slips')} className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs">
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

              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A]">Tenant Collection Overview — {selectedMonth}</h3>
                    <p className="text-[11px] text-slate-500">Tap any tenant to open their full 12-month profile &amp; payment history</p>
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
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px]"
                              >
                                +Pay
                              </button>
                              <button
                                onClick={() => handleDownloadSingleSlip(r.tenantId, r.month)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 text-[#1B365D] font-bold text-[10px]"
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

          {/* ================================================================= */}
          {/* TAB 2: ALL TENANTS & INDIVIDUAL TENANT PROFILE (/tenants/[id])    */}
          {/* ================================================================= */}
          {activeTab === 'tenants' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">
                    Tenant Profile &amp; 12-Month Ledger — {selectedTenantObj.name} ({selectedTenantObj.tenantId})
                  </h2>
                  <p className="text-xs text-slate-600">
                    Room: <strong>{selectedTenantObj.room}</strong> · Worksheet Tab: <span className="font-mono">{selectedTenantObj.sheetName}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedTenantId}
                    onChange={(e) => setSelectedTenantId(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-[#1B365D]"
                  >
                    {tenants.map((t) => (
                      <option key={t.tenantId} value={t.tenantId}>
                        {t.tenantId} — {t.name} ({t.room})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => openPayModalFor(selectedTenantObj.tenantId, selectedMonth)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                  >
                    + Record Payment
                  </button>
                  <button
                    onClick={() => handleDownloadSingleSlip(selectedTenantObj.tenantId, selectedMonth)}
                    className="px-3.5 py-2 rounded-xl bg-[#1B365D] text-white text-xs font-bold"
                  >
                    ⬇ {selectedMonth} Slip PDF
                  </button>
                </div>
              </div>

              {/* TENANT SELECTOR PILLS */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {tenants.map((t) => {
                  const mRec = monthlyRecords.find((r) => r.tenantId === t.tenantId && r.month === selectedMonth);
                  const active = t.tenantId === selectedTenantObj.tenantId;
                  return (
                    <button
                      key={t.tenantId}
                      onClick={() => setSelectedTenantId(t.tenantId)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                        active ? 'bg-[#0F172A] text-white border-[#0F172A]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {t.name} <span className="font-mono opacity-75">({mRec ? formatINR(mRec.closingBalance) : '₹0'})</span>
                    </button>
                  );
                })}
              </div>

              {/* SNAPSHOT CARDS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200">
                  <div className="text-slate-500">Monthly Rent</div>
                  <div className="text-lg font-mono font-extrabold text-[#0F172A] mt-0.5">{formatINR(selectedTenantCurrRec?.rent || 0)}</div>
                </div>
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200">
                  <div className="text-slate-500">{selectedMonth} Utility Bill</div>
                  <div className="text-lg font-mono font-extrabold text-[#1B365D] mt-0.5">
                    {selectedTenantCurrRec?.electricity !== null ? formatINR(selectedTenantCurrRec?.totalBill) : 'Reading Pending'}
                  </div>
                </div>
                <div className="bg-white p-3.5 rounded-2xl border border-emerald-200">
                  <div className="text-emerald-800 font-semibold">Paid in {selectedMonth}</div>
                  <div className="text-lg font-mono font-extrabold text-emerald-700 mt-0.5">{formatINR(selectedTenantCurrRec?.totalPaid || 0)}</div>
                </div>
                <div className="bg-white p-3.5 rounded-2xl border border-rose-200">
                  <div className="text-rose-800 font-semibold">Closing Balance Due</div>
                  <div className="text-lg font-mono font-extrabold text-rose-700 mt-0.5">{formatINR(selectedTenantCurrRec?.closingBalance || 0)}</div>
                </div>
              </div>

              {/* 12-MONTH TABLE */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-4 border-b border-slate-200 font-extrabold text-sm text-[#0F172A]">
                  {selectedTenantObj.name} — {selectedYear} Full 12-Month Billing &amp; Meter History
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-2.5">Month</th>
                        <th className="p-2.5 text-right">Rent</th>
                        <th className="p-2.5 text-right">Main Read (Edit)</th>
                        <th className="p-2.5 text-right">Prev Read</th>
                        <th className="p-2.5 text-right">Units</th>
                        <th className="p-2.5 text-right">Elec Bill</th>
                        <th className="p-2.5 text-right">Water</th>
                        <th className="p-2.5 text-right">Prev Due</th>
                        <th className="p-2.5 text-right">Payable</th>
                        <th className="p-2.5 text-right">Paid</th>
                        <th className="p-2.5 text-right">Closing Due</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center">Slip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTenantRecs.map((r) => (
                        <tr key={r.recordId} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="p-2.5 font-sans font-bold text-[#1B365D]">{r.month}</td>
                          <td className="p-2.5 text-right">{formatINR(r.rent)}</td>
                          <td className="p-2.5 text-right">
                            <input
                              key={`${r.recordId}-${r.currentReading ?? 'null'}`}
                              type="number"
                              defaultValue={r.currentReading !== null ? r.currentReading : ''}
                              placeholder="Pending"
                              onBlur={(e) => handleReadingChange(r.recordId, e.target.value)}
                              className="w-20 px-2 py-1 text-right rounded-lg border border-amber-400 bg-amber-50/70 font-bold text-[#0F172A]"
                            />
                          </td>
                          <td className="p-2.5 text-right text-slate-500">{r.previousReading}</td>
                          <td className="p-2.5 text-right">{r.units !== null ? r.units : 'Pending'}</td>
                          <td className="p-2.5 text-right">{r.electricity !== null ? formatINR(r.electricity) : 'Pending'}</td>
                          <td className="p-2.5 text-right">{formatINR(r.water)}</td>
                          <td className="p-2.5 text-right">{formatINR(r.previousOutstanding)}</td>
                          <td className="p-2.5 text-right font-bold">{formatINR(r.totalPayable)}</td>
                          <td className="p-2.5 text-right text-emerald-700 font-bold">{formatINR(r.totalPaid)}</td>
                          <td className="p-2.5 text-right font-extrabold text-rose-700">{formatINR(r.closingBalance)}</td>
                          <td className="p-2.5 text-center font-sans">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                              {r.paymentStatus}
                            </span>
                          </td>
                          <td className="p-2.5 text-center font-sans">
                            <button
                              onClick={() => handleDownloadSingleSlip(r.tenantId, r.month)}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-[#1B365D] font-bold text-[10px]"
                            >
                              PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PAYMENT TRANSACTIONS FOR SELECTED TENANT */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4">
                <h3 className="text-sm font-extrabold text-[#0F172A] mb-3">
                  Recorded Payments for {selectedTenantObj.name} ({selectedTenantPayments.length} Transactions)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 text-left">
                        <th className="p-2.5">Payment ID</th>
                        <th className="p-2.5">Billing Month</th>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5 text-right">Amount</th>
                        <th className="p-2.5">Method</th>
                        <th className="p-2.5">Notes / Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTenantPayments.map((p) => (
                        <tr key={p.paymentId} className="border-b border-slate-100">
                          <td className="p-2.5 font-mono font-bold text-[#1B365D]">{p.paymentId}</td>
                          <td className="p-2.5 font-semibold">{p.month}</td>
                          <td className="p-2.5 font-mono">{p.date}</td>
                          <td className="p-2.5 text-right font-mono font-bold text-emerald-700">{formatINR(p.amount)}</td>
                          <td className="p-2.5">{p.method}</td>
                          <td className="p-2.5 text-slate-600">{p.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: MONTHLY RENT RECORDS                                       */}
          {/* ================================================================= */}
          {activeTab === 'monthly-records' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">{selectedMonth} — Monthly Rent &amp; Billing Records</h2>
                  <p className="text-xs text-slate-600">Edit readings or credits directly; unpaid balances carry forward automatically</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                  >
                    {['All', 'Paid', 'Partially Paid', 'Unpaid', 'Pending Calculation', 'Advance/Credit'].map((st) => (
                      <option key={st} value={st}>Filter: {st}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Tenant</th>
                        <th className="p-3">Room</th>
                        <th className="p-3 text-right">Rent</th>
                        <th className="p-3 text-right">Prev Read</th>
                        <th className="p-3 text-right">Curr Read (Edit)</th>
                        <th className="p-3 text-right">Units</th>
                        <th className="p-3 text-right">Elec Bill</th>
                        <th className="p-3 text-right">Water</th>
                        <th className="p-3 text-right">Prev Due</th>
                        <th className="p-3 text-right">Credits (Edit)</th>
                        <th className="p-3 text-right">Total Payable</th>
                        <th className="p-3 text-right">Paid</th>
                        <th className="p-3 text-right">Closing Due</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMonthRecs.map((r) => (
                        <tr key={r.recordId} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td
                            onClick={() => {
                              setSelectedTenantId(r.tenantId);
                              setActiveTab('tenants');
                            }}
                            className="p-3 font-sans font-bold text-[#1B365D] cursor-pointer hover:underline"
                          >
                            {r.tenantName}
                          </td>
                          <td className="p-3 font-sans text-slate-500">{r.room}</td>
                          <td className="p-3 text-right">{formatINR(r.rent)}</td>
                          <td className="p-3 text-right text-slate-500">{r.previousReading}</td>
                          <td className="p-3 text-right">
                            <input
                              key={`${r.recordId}-${r.currentReading ?? 'null'}`}
                              type="number"
                              defaultValue={r.currentReading !== null ? r.currentReading : ''}
                              placeholder="Pending"
                              onBlur={(e) => handleReadingChange(r.recordId, e.target.value)}
                              className="w-20 px-2 py-1 text-right rounded-lg border border-amber-400 bg-amber-50/70 font-bold text-[#0F172A]"
                            />
                          </td>
                          <td className="p-3 text-right">{r.units !== null ? r.units : 'Pending'}</td>
                          <td className="p-3 text-right">{r.electricity !== null ? formatINR(r.electricity) : 'Pending'}</td>
                          <td className="p-3 text-right">{formatINR(r.water)}</td>
                          <td className="p-3 text-right">{formatINR(r.previousOutstanding)}</td>
                          <td className="p-3 text-right">
                            <input
                              key={`${r.recordId}-cred-${r.credits}`}
                              type="number"
                              defaultValue={r.credits || 0}
                              onBlur={(e) => handleCreditChange(r.recordId, e.target.value)}
                              className="w-16 px-1.5 py-1 text-right rounded-lg border border-slate-300 bg-white"
                            />
                          </td>
                          <td className="p-3 text-right font-bold">{formatINR(r.totalPayable)}</td>
                          <td className="p-3 text-right text-emerald-700 font-bold">{formatINR(r.totalPaid)}</td>
                          <td className="p-3 text-right font-extrabold text-rose-700">{formatINR(r.closingBalance)}</td>
                          <td className="p-3 text-center font-sans">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                              {r.paymentStatus}
                            </span>
                          </td>
                          <td className="p-3 text-center font-sans">
                            <button
                              onClick={() => openPayModalFor(r.tenantId, r.month)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px]"
                            >
                              +Pay
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: CENTRAL PAYMENTS LEDGER                                    */}
          {/* ================================================================= */}
          {activeTab === 'payments' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Central Payments Ledger ({payments.length} Confirmed Transactions)</h2>
                  <p className="text-xs text-slate-600">
                    Append-only transaction ledger synced with <span className="font-mono">Payments Ledger</span> tab · Total Collected:{' '}
                    <strong className="font-mono text-emerald-700">
                      {formatINR(payments.reduce((s, p) => s + (p.type === 'Reversal' ? -Math.abs(p.amount) : Number(p.amount)), 0))}
                    </strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openPayModalFor()} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                    + Record Payment (Auto-Today)
                  </button>
                  <button onClick={exportPaymentsCsv} className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold">
                    ⬇ Export CSV
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Payment ID</th>
                        <th className="p-3">Tenant</th>
                        <th className="p-3">Billing Month</th>
                        <th className="p-3">Payment Date</th>
                        <th className="p-3 text-right">Amount (₹)</th>
                        <th className="p-3">Mode</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Reference</th>
                        <th className="p-3">Provenance / Notes</th>
                        <th className="p-3 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments
                        .filter(
                          (p) =>
                            searchQuery === '' ||
                            p.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.paymentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.month.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                        .map((p) => (
                          <tr key={p.paymentId} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-3 font-mono font-bold text-[#1B365D]">{p.paymentId}</td>
                            <td className="p-3 font-bold">{p.tenantName}</td>
                            <td className="p-3 font-semibold">{p.month}</td>
                            <td className="p-3 font-mono">{p.date}</td>
                            <td className="p-3 text-right font-mono font-extrabold text-emerald-700">{formatINR(p.amount)}</td>
                            <td className="p-3">{p.method}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">{p.type}</span>
                            </td>
                            <td className="p-3 font-mono text-slate-500">{p.reference}</td>
                            <td className="p-3 text-slate-600">{p.notes}</td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => handleDownloadSingleSlip(p.tenantId, p.month)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#1B365D] font-bold text-[10px]"
                              >
                                PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 5: ELECTRICITY & WATER METER MANAGEMENT                       */}
          {/* ================================================================= */}
          {activeTab === 'electricity' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Electricity &amp; Water Meter Entry — {selectedMonth}</h2>
                  <p className="text-xs text-slate-600">
                    Walk-around mobile &amp; desktop sub-meter sheet. Blank readings remain <strong>Reading Pending</strong> without negative bills.
                  </p>
                </div>
                <div className="text-xs bg-blue-50 border border-blue-200 text-blue-950 px-3.5 py-2 rounded-xl font-semibold">
                  Rate: <strong>₹{defaultElecRate}/Unit</strong> · Motor Group 1: <strong>₹{motor1WaterCharge}</strong> · Motor2 Group 2: <strong>₹{motor2WaterCharge}</strong>
                </div>
              </div>

              {/* MOBILE WALK-AROUND METER CARDS (< MD) */}
              <div className="md:hidden grid grid-cols-1 gap-3">
                {monthRecs.map((r) => (
                  <div key={r.recordId} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-extrabold text-sm text-[#0F172A]">{r.tenantName}</span>
                        <span className="text-slate-500 ml-1">({r.room})</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${r.currentReading !== null ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                        {r.currentReading !== null ? `Verified (${r.units} U)` : 'Reading Pending'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Previous Reading</span>
                        <span className="font-mono font-extrabold text-base text-slate-700">{r.previousReading}</span>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[#1B365D] block">New Main Reading</label>
                        <input
                          key={`${r.recordId}-mob-${r.currentReading ?? 'null'}`}
                          type="number"
                          defaultValue={r.currentReading !== null ? r.currentReading : ''}
                          placeholder="Enter reading"
                          onBlur={(e) => handleReadingChange(r.recordId, e.target.value)}
                          className="w-full mt-0.5 px-3 py-2 rounded-xl border-2 border-amber-400 bg-amber-50 font-mono font-extrabold text-base text-[#0F172A]"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 pt-0.5">
                      <span>Elec: <strong className="font-mono text-slate-900">{r.electricity !== null ? formatINR(r.electricity) : 'Pending'}</strong></span>
                      <span>Water: <strong className="font-mono text-slate-900">{formatINR(r.water)}</strong></span>
                      <span>Total Bill: <strong className="font-mono text-[#1B365D]">{r.electricity !== null ? formatINR(r.totalBill) : formatINR(r.water)}</strong></span>
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP METER TABLE */}
              <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Tenant</th>
                        <th className="p-3">Room</th>
                        <th className="p-3 text-right">Previous Reading</th>
                        <th className="p-3 text-right">Current Reading (Input)</th>
                        <th className="p-3 text-center">Meter Reset</th>
                        <th className="p-3 text-right">Units Consumed</th>
                        <th className="p-3 text-right">Rate</th>
                        <th className="p-3 text-right">Electricity Bill</th>
                        <th className="p-3 text-right">Water Charge</th>
                        <th className="p-3 text-right">Total Utility Bill</th>
                        <th className="p-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthRecs.map((r) => (
                        <tr key={r.recordId} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="p-3 font-sans font-bold text-[#1B365D]">{r.tenantName}</td>
                          <td className="p-3 font-sans text-slate-500">{r.room}</td>
                          <td className="p-3 text-right">{r.previousReading}</td>
                          <td className="p-3 text-right">
                            <input
                              key={`${r.recordId}-desk-${r.currentReading ?? 'null'}`}
                              type="number"
                              defaultValue={r.currentReading !== null ? r.currentReading : ''}
                              placeholder="Enter reading"
                              onBlur={(e) => handleReadingChange(r.recordId, e.target.value)}
                              className="w-28 px-2.5 py-1.5 text-right rounded-xl border border-amber-400 bg-amber-50/70 font-bold text-[#0F172A]"
                            />
                          </td>
                          <td className="p-3 text-center font-sans">
                            <input
                              type="checkbox"
                              checked={Boolean(r.meterReset)}
                              onChange={(e) => handleMeterResetToggle(r.recordId, e.target.checked)}
                            />
                          </td>
                          <td className="p-3 text-right font-bold">{r.units !== null ? `${r.units} U` : 'Pending'}</td>
                          <td className="p-3 text-right">₹{r.rate}</td>
                          <td className="p-3 text-right font-semibold">{r.electricity !== null ? formatINR(r.electricity) : 'Reading Pending'}</td>
                          <td className="p-3 text-right">{formatINR(r.water)}</td>
                          <td className="p-3 text-right font-extrabold text-[#1B365D]">{r.electricity !== null ? formatINR(r.totalBill) : formatINR(r.water)}</td>
                          <td className="p-3 text-center font-sans">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${r.currentReading !== null ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                              {r.currentReading !== null ? 'Verified' : 'Reading Pending'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 6: SPACIOUS 2-PAGE A4 RENT SLIP GENERATOR                     */}
          {/* ================================================================= */}
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

          {/* ================================================================= */}
          {/* TAB 7: REPORTS & ANALYTICS                                        */}
          {/* ================================================================= */}
          {activeTab === 'reports' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Financial Reports &amp; Annual Performance ({selectedYear})</h2>
                  <p className="text-xs text-slate-600">Consolidated month-by-month expected rent, electricity, water, collections, and closing arrears</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Month</th>
                        <th className="p-3 text-right">Expected Base Rent</th>
                        <th className="p-3 text-right">Total Units</th>
                        <th className="p-3 text-right">Electricity Billed</th>
                        <th className="p-3 text-right">Water Billed</th>
                        <th className="p-3 text-right">Total Net Payable</th>
                        <th className="p-3 text-right">Total Collected</th>
                        <th className="p-3 text-right">Closing Arrears</th>
                        <th className="p-3 text-right">Collection %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MONTH_SHORT.map((m, idx) => {
                        const mKey = `${m}-26`;
                        const mRecs = monthlyRecords.filter((r) => r.month === mKey);
                        const rent = mRecs.reduce((s, r) => s + r.rent, 0);
                        const units = mRecs.reduce((s, r) => s + (r.units ?? 0), 0);
                        const elec = mRecs.reduce((s, r) => s + (r.electricity ?? 0), 0);
                        const water = mRecs.reduce((s, r) => s + r.water, 0);
                        const payable = mRecs.reduce((s, r) => s + r.totalPayable, 0);
                        const paid = mRecs.reduce((s, r) => s + r.totalPaid, 0);
                        const due = mRecs.reduce((s, r) => s + r.closingBalance, 0);
                        const rate = payable > 0 ? ((paid / payable) * 100).toFixed(1) : '0.0';
                        return (
                          <tr key={mKey} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                            <td className="p-3 font-sans font-bold text-[#1B365D]">{mKey} ({MONTH_NAMES[idx]})</td>
                            <td className="p-3 text-right">{formatINR(rent)}</td>
                            <td className="p-3 text-right">{units} U</td>
                            <td className="p-3 text-right">{formatINR(elec)}</td>
                            <td className="p-3 text-right">{formatINR(water)}</td>
                            <td className="p-3 text-right font-bold">{formatINR(payable)}</td>
                            <td className="p-3 text-right text-emerald-700 font-bold">{formatINR(paid)}</td>
                            <td className="p-3 text-right font-extrabold text-rose-700">{formatINR(due)}</td>
                            <td className="p-3 text-right font-semibold">{rate}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 8: OUTSTANDING DUES TRACKER                                   */}
          {/* ================================================================= */}
          {activeTab === 'outstanding' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Outstanding Dues &amp; Arrears Tracker — {selectedMonth}</h2>
                  <p className="text-xs text-slate-600">
                    Tenants with unpaid balances totaling <strong className="font-mono text-rose-700">{formatINR(totalOutstanding)}</strong>
                  </p>
                </div>
                <button onClick={() => openPayModalFor()} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                  + Record Arrears Payment
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {monthRecs
                  .filter((r) => r.closingBalance > 0)
                  .sort((a, b) => b.closingBalance - a.closingBalance)
                  .map((r) => (
                    <div key={r.recordId} className="bg-white rounded-2xl border border-rose-200 p-4 shadow-2xs flex flex-col justify-between space-y-3 text-xs">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-sm font-extrabold text-[#0F172A]">{r.tenantName}</h3>
                          <p className="text-[11px] text-slate-500">{r.room} · {r.month}</p>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.paymentStatus)}`}>
                          {r.paymentStatus}
                        </span>
                      </div>
                      <div className="space-y-1.5 bg-rose-50/50 p-3 rounded-xl border border-rose-100 font-mono">
                        <div className="flex justify-between"><span className="font-sans text-slate-600">Previous Arrears:</span><span className="font-semibold">{formatINR(r.previousOutstanding)}</span></div>
                        <div className="flex justify-between"><span className="font-sans text-slate-600">Current Rent + Bill:</span><span className="font-semibold">{r.electricity !== null ? formatINR(r.rent + r.totalBill) : 'Reading Pending'}</span></div>
                        <div className="flex justify-between"><span className="font-sans text-slate-600">Paid in {r.month}:</span><span className="font-semibold text-emerald-700">{formatINR(r.totalPaid)}</span></div>
                        <div className="flex justify-between pt-1.5 border-t border-rose-200 text-sm font-extrabold text-rose-700">
                          <span className="font-sans">Closing Balance Due:</span>
                          <span>{formatINR(r.closingBalance)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openPayModalFor(r.tenantId, r.month)} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white font-bold">
                          Record Payment
                        </button>
                        <button onClick={() => handleDownloadSingleSlip(r.tenantId, r.month)} className="px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#1B365D]">
                          Slip PDF
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 9: MASTER TENANT DIRECTORY                                    */}
          {/* ================================================================= */}
          {activeTab === 'directory' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-[#0F172A]">Master Tenant Directory (13 Active Tenants — Zero Security Deposit)</h2>
                <p className="text-xs text-slate-600">Synchronized with <span className="font-mono">Tenant Directory!A1:P17</span>. Edit scheduled monthly rent or status inline.</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white text-left">
                        <th className="p-3">Tenant ID</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Room</th>
                        <th className="p-3 text-right">Monthly Rent (₹)</th>
                        <th className="p-3 text-right">Elec Rate</th>
                        <th className="p-3 text-right">Water (₹)</th>
                        <th className="p-3">Water Group</th>
                        <th className="p-3 text-right">Jan Opening Read</th>
                        <th className="p-3 text-right">Opening Arrears</th>
                        <th className="p-3">Rent Slip Mode</th>
                        <th className="p-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.map((t) => (
                        <tr key={t.tenantId} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3 font-mono font-bold text-[#1B365D]">{t.tenantId}</td>
                          <td
                            onClick={() => {
                              setSelectedTenantId(t.tenantId);
                              setActiveTab('tenants');
                            }}
                            className="p-3 font-bold text-[#1B365D] cursor-pointer hover:underline"
                          >
                            {t.name}
                          </td>
                          <td className="p-3">{t.room}</td>
                          <td className="p-3 text-right">
                            <input
                              key={`${t.tenantId}-rent-${t.monthlyRent}`}
                              type="number"
                              defaultValue={t.monthlyRent}
                              onBlur={(e) => handleTenantRentUpdate(t.tenantId, e.target.value)}
                              className="w-24 px-2.5 py-1 text-right rounded-lg border border-slate-300 bg-amber-50/50 font-mono font-bold"
                            />
                          </td>
                          <td className="p-3 text-right font-mono">₹{t.electricityRate}/U</td>
                          <td className="p-3 text-right font-mono">₹{t.waterCharge}</td>
                          <td className="p-3">{t.waterBillingType}</td>
                          <td className="p-3 text-right font-mono">{t.initialMeterReading}</td>
                          <td className="p-3 text-right font-mono">{formatINR(t.openingArrears)}</td>
                          <td className="p-3 text-slate-600">{t.billingGroupId === 'BG-01' ? 'Combined (Javed & Raja)' : 'Individual Slip'}</td>
                          <td className="p-3 text-center">
                            <select
                              value={t.status}
                              onChange={(e) => handleTenantStatusUpdate(t.tenantId, e.target.value)}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 text-[11px] font-bold"
                            >
                              <option value="Active">Active</option>
                              <option value="Vacated">Vacated</option>
                              <option value="Inactive">Inactive</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 10: GOOGLE SHEETS & APPS SCRIPT CONNECTION HUB                */}
          {/* ================================================================= */}
          {activeTab === 'sync' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A]">Connect Google Sheet with Google Apps Script (Two-Way Live Sync)</h2>
                  <p className="text-xs text-slate-600">
                    Link your Google Sheet (<span className="font-mono">{INITIAL_WORKBOOK_DATA.spreadsheetId}</span>) in 3 simple steps — no complex cloud console setup needed!
                  </p>
                </div>
                <button
                  onClick={triggerSyncFromGoogleSheets}
                  className="px-4 py-2 rounded-xl bg-[#1B365D] text-white text-xs font-bold shadow-xs"
                >
                  ↻ Test &amp; Sync Sheet Now
                </button>
              </div>

              {/* 3-STEP APPS SCRIPT WIZARD */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <div className="inline-block px-2.5 py-0.5 rounded-md bg-blue-100 text-blue-900 font-bold text-[10px]">STEP 1 OF 3</div>
                  <h3 className="text-sm font-extrabold text-[#0F172A]">Open Your Google Sheet &amp; Apps Script</h3>
                  <p className="text-slate-600 leading-relaxed">
                    1. Click below to open your connected Google Sheet.<br />
                    2. In the top menu bar, click <strong>Extensions &rarr; Apps Script</strong>.<br />
                    3. Delete any default code in <span className="font-mono">Code.gs</span>.
                  </p>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${INITIAL_WORKBOOK_DATA.spreadsheetId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-2.5 px-4 rounded-xl bg-[#1B365D] hover:bg-slate-800 text-white font-bold"
                  >
                    Open Connected Google Sheet ↗
                  </a>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <div className="inline-block px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold text-[10px]">STEP 2 OF 3</div>
                  <h3 className="text-sm font-extrabold text-[#0F172A]">Copy &amp; Deploy Code.gs as Web App</h3>
                  <p className="text-slate-600 leading-relaxed">
                    1. Click <strong>Copy Full Code.gs</strong> below and paste it into Apps Script.<br />
                    2. Click <strong>Save (💾)</strong>, then click <strong>Deploy &rarr; New deployment</strong>.<br />
                    3. Select type: <strong>Web app</strong>, set <em>Execute as: Me</em> and <em>Who has access: Anyone</em>, then click <strong>Deploy</strong>.
                  </p>
                  <button
                    onClick={handleCopyAppsScript}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs"
                  >
                    📋 Copy Full Code.gs Script
                  </button>
                </div>

                <div className="bg-white rounded-2xl border border-emerald-300 p-4 shadow-2xs space-y-3">
                  <div className="inline-block px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-900 font-bold text-[10px]">STEP 3 OF 3</div>
                  <h3 className="text-sm font-extrabold text-[#0F172A]">Paste Deployed Web App URL Here</h3>
                  <p className="text-slate-600">
                    Paste the generated <span className="font-mono">https://script.google.com/macros/s/.../exec</span> URL below and click <strong>Save &amp; Connect</strong>:
                  </p>
                  <input
                    type="url"
                    value={appsScriptUrl}
                    onChange={(e) => { setAppsScriptUrl(e.target.value); savePermanentWebhookStorage(e.target.value); }}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs"
                  />
                  <button
                    onClick={() => handleSaveAppsScriptUrl(appsScriptUrl)}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-bold"
                  >
                    🔗 Save &amp; Connect Sheet
                  </button>
                </div>
              </div>

              {/* FULL CODE.GS VIEWER + AUDIT LOG */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-[#0F172A]">Ready-to-Paste Google Apps Script (Code.gs)</h3>
                    <button onClick={handleCopyAppsScript} className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-[#1B365D]">
                      Copy Code
                    </button>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 text-emerald-300 font-mono text-[11px] overflow-x-auto max-h-64 leading-relaxed">
                    {APPS_SCRIPT_CODE}
                  </pre>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-2">
                  <h3 className="text-sm font-extrabold text-[#0F172A]">Live Audit &amp; Sync Log ({auditLog.length} Entries)</h3>
                  <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-xl">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 text-left sticky top-0">
                          <th className="p-2">Timestamp</th>
                          <th className="p-2">Target Record</th>
                          <th className="p-2">Action</th>
                          <th className="p-2">New Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLog.map((a, idx) => (
                          <tr key={idx} className="border-b border-slate-100">
                            <td className="p-2 font-mono text-[10px]">{a.timestamp}</td>
                            <td className="p-2 font-bold text-[#1B365D]">{a.record}</td>
                            <td className="p-2">{a.action}</td>
                            <td className="p-2 font-mono font-bold text-emerald-700">{a.newVal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 11: SETTINGS & SECURITY                                       */}
          {/* ================================================================= */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                <h3 className="text-sm font-extrabold text-[#0F172A] border-b border-slate-100 pb-2">Property &amp; Utility Billing Settings</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Property Name</label>
                    <input
                      type="text"
                      value={propertyName}
                      onChange={(e) => setPropertyName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Default Electricity Rate (₹/U)</label>
                    <input
                      type="number"
                      value={defaultElecRate}
                      onChange={(e) => setDefaultElecRate(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Motor Group 1 Water (₹)</label>
                    <input
                      type="number"
                      value={motor1WaterCharge}
                      onChange={(e) => setMotor1WaterCharge(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Motor2 Group 2 Water (₹)</label>
                    <input
                      type="number"
                      value={motor2WaterCharge}
                      onChange={(e) => setMotor2WaterCharge(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold"
                    />
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-[#0F172A]">Combine Javed &amp; Raja Rent Slip (Group BG-01)</div>
                    <div className="text-[11px] text-slate-500">Preserves combined ₹4,500 base rent and side-by-side bills</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={combineJavedRaja}
                    onChange={(e) => setCombineJavedRaja(e.target.checked)}
                    className="w-4 h-4"
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                <h3 className="text-sm font-extrabold text-[#0F172A] border-b border-slate-100 pb-2">Role Access &amp; Data Reset</h3>
                <div className="flex items-center justify-between">
                  <span>Active Session Role:</span>
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value as 'admin' | 'viewer')}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold"
                  >
                    <option value="admin">Administrator (Full Write + Sync)</option>
                    <option value="viewer">Read-Only Viewer</option>
                  </select>
                </div>
                <p className="text-slate-600 pt-2">
                  Restore the exact verified historical figures from your Google Sheet (98 payments, 13 tenants, Sep-26 closing dues ₹39,767):
                </p>
                <button
                  onClick={handleRestoreHistoricalState}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold"
                >
                  Restore Verified Historical Workbook Data
                </button>
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

      {/* MODAL 1: RECORD PAYMENT (AUTO-FETCHES CURRENT DATE!) */}
      {paymentModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-3 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-extrabold text-[#1B365D]">Record Confirmed Rent Payment</h3>
                <p className="text-[11px] text-slate-500">Payment date automatically set to today ({getTodayIsoDate()})</p>
              </div>
              <button onClick={() => setPaymentModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-100 font-bold">✕</button>
            </div>
            <form onSubmit={handleSubmitPayment} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Tenant *</label>
                  <select
                    value={payTenantId}
                    onChange={(e) => {
                      const tid = e.target.value;
                      setPayTenantId(tid);
                      const rec = monthlyRecords.find((r) => r.tenantId === tid && r.month === payMonthKey);
                      if (rec) setPayAmount(String(rec.closingBalance > 0 ? rec.closingBalance : rec.rent));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  >
                    {tenants.map((t) => (
                      <option key={t.tenantId} value={t.tenantId}>{t.name} ({t.room})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Billing Month *</label>
                  <select
                    value={payMonthKey}
                    onChange={(e) => {
                      const mk = e.target.value;
                      setPayMonthKey(mk);
                      const rec = monthlyRecords.find((r) => r.tenantId === payTenantId && r.month === mk);
                      if (rec) setPayAmount(String(rec.closingBalance > 0 ? rec.closingBalance : rec.rent));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  >
                    {MONTH_SHORT.map((m) => (
                      <option key={`${m}-26`} value={`${m}-26`}>{`${m}-26`}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Payment Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-emerald-500 font-mono font-extrabold text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold">Payment Date (Auto-Today) *</label>
                    <button
                      type="button"
                      onClick={() => setPayDate(getTodayIsoDate())}
                      className="text-[10px] font-bold text-emerald-700 hover:underline"
                    >
                      Reset to Today
                    </button>
                  </div>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Payment Mode</label>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300">
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI (GPay / PhonePe / Paytm)</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Reference / Notes</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Optional note"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" onClick={() => setPaymentModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-bold">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold">Save &amp; Sync to Sheet</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CONNECT GOOGLE SHEET VIA APPS SCRIPT WIZARD */}
      {connectModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-3 no-print">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl border border-slate-200 space-y-4 text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-extrabold text-[#0F172A]">🔗 Connect Google Sheet via Apps Script</h3>
                <p className="text-[11px] text-slate-500">Two-way live sync with your Google Sheet ({INITIAL_WORKBOOK_DATA.spreadsheetId})</p>
              </div>
              <button onClick={() => setConnectModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-100 font-bold">✕</button>
            </div>

            <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="font-bold text-[#1B365D]">How to link your Google Sheet in 60 seconds:</div>
              <ol className="list-decimal list-inside space-y-1 text-slate-700">
                <li>Open your <a href={`https://docs.google.com/spreadsheets/d/${INITIAL_WORKBOOK_DATA.spreadsheetId}/edit`} target="_blank" rel="noopener noreferrer" className="text-blue-700 font-bold underline">Connected Google Sheet ↗</a> and click <strong>Extensions &rarr; Apps Script</strong>.</li>
                <li>Click <strong>Copy Code.gs Script</strong> below, paste it into the Apps Script editor, and save.</li>
                <li>Click <strong>Deploy &rarr; New deployment &rarr; Web app</strong> (Execute as: <em>Me</em>, Access: <em>Anyone</em>).</li>
                <li>Paste the resulting <strong>Web App URL</strong> (<span className="font-mono">https://script.google.com/macros/s/.../exec</span>) below:</li>
              </ol>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCopyAppsScript}
                  className="px-3.5 py-2 rounded-xl bg-[#1B365D] text-white font-bold"
                >
                  📋 Copy Full Code.gs Script
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Deployed Google Apps Script Web App URL</label>
              <input
                type="url"
                value={appsScriptUrl}
                onChange={(e) => { setAppsScriptUrl(e.target.value); savePermanentWebhookStorage(e.target.value); }}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-mono text-xs"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setConnectModalOpen(false);
                  setActiveTab('sync');
                }}
                className="text-blue-700 font-bold hover:underline"
              >
                Open Full Sync &amp; Audit Page &rarr;
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConnectModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-bold">Close</button>
                <button
                  type="button"
                  onClick={() => {
                    handleSaveAppsScriptUrl(appsScriptUrl);
                    setConnectModalOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold"
                >
                  Save &amp; Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
