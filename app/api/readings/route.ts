import { NextRequest, NextResponse } from 'next/server';
import { updateMeterReadingInGoogleSheet } from '@/lib/google-sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.sheetName || !body.monthIndex) {
      return NextResponse.json(
        { ok: false, error: 'sheetName and monthIndex are required.' },
        { status: 400 }
      );
    }
    const result = await updateMeterReadingInGoogleSheet({
      sheetName: body.sheetName,
      monthIndex: Number(body.monthIndex),
      currentReading: body.currentReading === '' || body.currentReading === null ? null : Number(body.currentReading),
    });
    return NextResponse.json({ ok: true, syncResult: result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to update meter reading' },
      { status: 500 }
    );
  }
}
