import { NextResponse } from 'next/server';
import { fetchWorkbookStateFromSheets } from '@/lib/google-sheets';

export async function GET() {
  try {
    const state = await fetchWorkbookStateFromSheets();
    return NextResponse.json({
      ok: true,
      data: state,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to read Google Sheets state' },
      { status: 500 }
    );
  }
}
