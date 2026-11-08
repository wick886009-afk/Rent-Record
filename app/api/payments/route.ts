import { NextRequest, NextResponse } from 'next/server';
import { appendPaymentToGoogleSheet } from '@/lib/google-sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.tenantId || !body.month || !body.amount || Number(body.amount) <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payment payload: tenantId, month, and positive amount are required.' },
        { status: 400 }
      );
    }
    const result = await appendPaymentToGoogleSheet(body);
    return NextResponse.json({
      ok: true,
      syncResult: result,
      payment: body,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save payment to Google Sheets' },
      { status: 500 }
    );
  }
}
