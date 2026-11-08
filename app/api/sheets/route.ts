import { NextRequest, NextResponse } from 'next/server';
import { fetchWorkbookStateFromSheets } from '@/lib/google-sheets';

export async function GET(req: NextRequest) {
  try {
    const webhookUrl = req.nextUrl.searchParams.get('webhookUrl') || process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
    if (webhookUrl && webhookUrl.startsWith('https://script.google.com/')) {
      const res = await fetch(webhookUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const remoteData = await res.json();
        return NextResponse.json({
          ok: true,
          mode: 'apps-script-live',
          remoteData,
        });
      }
    }
    const state = await fetchWorkbookStateFromSheets();
    return NextResponse.json({
      ok: true,
      mode: state.mode,
      data: state,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to read Google Sheets state' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const webhookUrl = body.webhookUrl || process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
    if (webhookUrl && webhookUrl.startsWith('https://script.google.com/')) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: body.action,
          secret: body.secret || process.env.GOOGLE_APPS_SCRIPT_SECRET_TOKEN || 'rentflow-webhook-secret-2026',
          payload: body.payload,
        }),
      });
      const data = await res.json().catch(() => ({ ok: res.ok }));
      return NextResponse.json({
        ok: true,
        syncedVia: 'apps-script-webhook',
        response: data,
      });
    }
    return NextResponse.json({
      ok: true,
      syncedVia: 'local-api-fallback',
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to proxy to Apps Script Web App' },
      { status: 500 }
    );
  }
}
