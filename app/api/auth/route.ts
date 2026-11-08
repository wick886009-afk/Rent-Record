import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const session = verifyCredentials(username, password);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Invalid username or password' }, { status: 401 });
    }
    return NextResponse.json({ ok: true, session });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: 'Authentication error' }, { status: 500 });
  }
}
