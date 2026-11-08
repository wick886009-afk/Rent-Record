export interface Tenant {
  tenantId: string;
  name: string;
  room: string;
  monthlyRent: number;
  dueDay: number;
  electricityRate: number;
  waterCharge: number;
  waterBillingType: 'Motor' | 'Motor2' | 'Exempt' | string;
  electricityBillingType: string;
  status: 'Active' | 'Vacated' | 'Inactive' | string;
  startDate: string;
  endDate: string;
  contact: string;
  billingGroupId: string;
  sheetName: string;
  initialMeterReading: number;
  openingArrears: number;
  notes: string;
}

export interface MonthlyRecord {
  recordId: string;
  tenantId: string;
  tenantName: string;
  room: string;
  month: string;       // e.g. 'Sep-26'
  monthName: string;   // e.g. 'September'
  monthIndex: number;  // 1..12
  year: number;        // e.g. 2026
  rent: number;
  previousReading: number;
  currentReading: number | null;
  units: number | null;
  rate: number;
  electricity: number | null;
  water: number;
  totalBill: number;
  previousOutstanding: number;
  otherCharges: number;
  credits: number;
  totalPayable: number;
  totalPaid: number;
  closingBalance: number;
  paymentStatus: 'Paid' | 'Partially Paid' | 'Unpaid' | 'Overdue' | 'Advance/Credit' | 'Pending Calculation';
  sourceRow: string;
  meterReset?: boolean;
  remarks?: string;
}

export interface PaymentTransaction {
  paymentId: string;
  tenantId: string;
  tenantName: string;
  recordId: string;
  month: string;
  year: number;
  date: string;
  amount: number;
  method: 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Other' | string;
  reference: string;
  type: 'Payment' | 'Adjustment' | 'Reversal' | 'Credit' | string;
  notes: string;
  createdAt: string;
}

export function roundCurrency(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Core Rent & Utility Calculation Engine
 * Fixes the original workbook's IMSUB/IMPRODUCT bug where blank October readings
 * produced large negative electricity bills.
 */
export function calculateSingleMonthRecord(params: {
  rent: number;
  previousReading: number;
  currentReading: number | null | undefined;
  rate: number;
  water: number;
  previousOutstanding: number;
  otherCharges?: number;
  credits?: number;
  totalPaid: number;
  meterReset?: boolean;
  dueDay?: number;
  isPastDueDate?: boolean;
}): {
  units: number | null;
  electricity: number | null;
  totalBill: number;
  totalPayable: number;
  closingBalance: number;
  paymentStatus: MonthlyRecord['paymentStatus'];
  validationWarning?: string;
} {
  const {
    rent,
    previousReading,
    currentReading,
    rate,
    water,
    previousOutstanding,
    otherCharges = 0,
    credits = 0,
    totalPaid,
    meterReset = false,
    isPastDueDate = false,
  } = params;

  // Missing meter reading guard: never treat blank reading as zero!
  if (currentReading === null || currentReading === undefined || Number.isNaN(Number(currentReading))) {
    const totalPayable = roundCurrency(previousOutstanding - credits);
    const closingBalance = roundCurrency(totalPayable - totalPaid);
    return {
      units: null,
      electricity: null,
      totalBill: roundCurrency(water),
      totalPayable,
      closingBalance,
      paymentStatus: 'Pending Calculation',
    };
  }

  const curr = Number(currentReading);
  const prev = Number(previousReading);

  if (curr < prev && !meterReset) {
    throw new Error(
      `Invalid meter reading: Current reading (${curr}) cannot be lower than Previous reading (${prev}) unless Meter Reset is enabled.`
    );
  }

  const units = meterReset && curr < prev ? curr : roundCurrency(curr - prev);
  const electricity = roundCurrency(units * rate);
  const totalBill = roundCurrency(electricity + water + otherCharges);
  const currentMonthlyCharges = roundCurrency(rent + totalBill);
  const totalPayable = roundCurrency(currentMonthlyCharges + previousOutstanding - credits);
  const closingBalance = roundCurrency(totalPayable - totalPaid);

  let paymentStatus: MonthlyRecord['paymentStatus'] = 'Unpaid';
  if (closingBalance < 0) {
    paymentStatus = 'Advance/Credit';
  } else if (closingBalance === 0) {
    paymentStatus = 'Paid';
  } else if (totalPaid > 0 && closingBalance > 0) {
    paymentStatus = 'Partially Paid';
  } else if (isPastDueDate && closingBalance > 0) {
    paymentStatus = 'Overdue';
  } else {
    paymentStatus = 'Unpaid';
  }

  return {
    units,
    electricity,
    totalBill,
    totalPayable,
    closingBalance,
    paymentStatus,
  };
}

/**
 * Recalculates an entire chronological chain of monthly records for a tenant,
 * automatically carrying forward previous meter readings and unpaid closing balances
 * across months and years without double-charging arrears.
 */
export function recalculateTenantLedgerChain(
  tenant: Tenant,
  records: MonthlyRecord[],
  payments: PaymentTransaction[]
): MonthlyRecord[] {
  const sorted = [...records].sort((a, b) => a.year !== b.year ? a.year - b.year : a.monthIndex - b.monthIndex);
  let runningPrevDue = tenant.openingArrears;
  let lastValidReading = tenant.initialMeterReading;

  return sorted.map((rec, idx) => {
    const prevRead = idx === 0 ? tenant.initialMeterReading : lastValidReading;
    const prevDue = idx === 0 ? tenant.openingArrears : runningPrevDue;

    const monthPayments = payments
      .filter((p) => p.tenantId === tenant.tenantId && p.month === rec.month && p.year === rec.year)
      .reduce((sum, p) => sum + (p.type === 'Reversal' ? -Math.abs(p.amount) : Number(p.amount)), 0);

    const calc = calculateSingleMonthRecord({
      rent: rec.rent,
      previousReading: prevRead,
      currentReading: rec.currentReading,
      rate: rec.rate,
      water: rec.water,
      previousOutstanding: prevDue,
      otherCharges: rec.otherCharges || 0,
      credits: rec.credits || 0,
      totalPaid: roundCurrency(monthPayments),
      meterReset: rec.meterReset,
    });

    if (rec.currentReading !== null && rec.currentReading !== undefined) {
      lastValidReading = Number(rec.currentReading);
    }
    runningPrevDue = calc.closingBalance;

    return {
      ...rec,
      previousReading: prevRead,
      units: calc.units,
      electricity: calc.electricity,
      totalBill: calc.totalBill,
      previousOutstanding: prevDue,
      totalPayable: calc.totalPayable,
      totalPaid: roundCurrency(monthPayments),
      closingBalance: calc.closingBalance,
      paymentStatus: calc.paymentStatus,
    };
  });
}

/**
 * Combined Rent Slip Calculator for Javed & Raja (Group BG-01)
 * Preserves the exact arrangement from Javed!A18:O36 and Total!A1:C5.
 */
export function calculateCombinedJavedRajaSlip(javedRec: MonthlyRecord, rajaRec: MonthlyRecord) {
  const combinedRent = roundCurrency(javedRec.rent + rajaRec.rent); // 2200 + 2300 = 4500
  const javedPrev = roundCurrency(javedRec.previousOutstanding);
  const rajaPrev = roundCurrency(rajaRec.previousOutstanding);
  const javedBill = javedRec.currentReading !== null ? roundCurrency(javedRec.totalBill) : null;
  const rajaBill = rajaRec.currentReading !== null ? roundCurrency(rajaRec.totalBill) : null;

  const currentMonthOnlyTotal = roundCurrency(
    combinedRent + (javedBill ?? 0) + (rajaBill ?? 0)
  );
  const combinedArrears = roundCurrency(javedPrev + rajaPrev);
  const fullCumulativeTotal =
    javedBill !== null && rajaBill !== null
      ? roundCurrency(currentMonthOnlyTotal + combinedArrears)
      : combinedArrears;
  const combinedPaid = roundCurrency(javedRec.totalPaid + rajaRec.totalPaid);
  const combinedBalance = roundCurrency(fullCumulativeTotal - combinedPaid);

  return {
    title: `Javed (${javedRec.monthName})`,
    combinedRent,
    javedPrev,
    rajaPrev,
    javedBill,
    rajaBill,
    currentMonthOnlyTotal,
    combinedArrears,
    fullCumulativeTotal,
    combinedPaid,
    combinedBalance,
  };
}
