import { NextRequest, NextResponse } from 'next/server';
import { fetchWorkbookStateFromSheets } from '@/lib/google-sheets';
import fs from 'fs';

const CONFIG_PATH = '/tmp/rentflow_permanent_webhook.json';

function getPersistedWebhookUrl(queryUrl?: string | null): string {
  if (queryUrl && queryUrl.startsWith('https://script.google.com/')) {
    savePersistedWebhookUrl(queryUrl);
    return queryUrl;
  }
  if ((globalThis as any).__rentflowWebhookUrl) {
    return (globalThis as any).__rentflowWebhookUrl;
  }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (parsed?.webhookUrl) {
        (globalThis as any).__rentflowWebhookUrl = parsed.webhookUrl;
        return parsed.webhookUrl;
      }
    }
  } catch {}
  return process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL || '';
}

function savePersistedWebhookUrl(url: string) {
  const clean = String(url || '').trim();
  if (!clean.startsWith('https://script.google.com/')) return;
  (globalThis as any).__rentflowWebhookUrl = clean;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ webhookUrl: clean, updatedAt: new Date().toISOString() }), 'utf-8');
  } catch {}
}

export async function GET(req: NextRequest) {
  try {
    const webhookUrl = getPersistedWebhookUrl(req.nextUrl.searchParams.get('webhookUrl'));
    if (webhookUrl && webhookUrl.startsWith('https://script.google.com/')) {
      const res = await fetch(webhookUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const remoteData = await res.json();
        return NextResponse.json({
          ok: true,
          mode: 'apps-script-live',
          webhookUrl,
          remoteData,
        });
      }
    }
    const state = await fetchWorkbookStateFromSheets();
    return NextResponse.json({
      ok: true,
      mode: state.mode,
      webhookUrl,
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
    const webhookUrl = getPersistedWebhookUrl(body.webhookUrl);
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
        webhookUrl,
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
