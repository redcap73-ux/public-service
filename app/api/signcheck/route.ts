import { NextRequest, NextResponse } from 'next/server';
import {
  getSigncheckKey,
  isSigncheckRequired,
  keysMatch,
} from '@/lib/signcheck.server';

/** Clear legacy unlock cookie if present from older builds. */
function clearLegacySigncheckCookie(response: NextResponse) {
  response.cookies.set('signcheck', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET() {
  const required = isSigncheckRequired();
  const response = NextResponse.json({
    required,
    // Never persist unlock — client must verify on every visit.
    unlocked: !required,
  });
  return clearLegacySigncheckCookie(response);
}

export async function POST(request: NextRequest) {
  const secret = getSigncheckKey();
  if (!secret) {
    const response = NextResponse.json({ ok: true, required: false });
    return clearLegacySigncheckCookie(response);
  }

  let body: { key?: string };
  try {
    body = (await request.json()) as { key?: string };
  } catch {
    return NextResponse.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
  }

  const key = String(body.key ?? '');
  if (!key || !keysMatch(key, secret)) {
    return NextResponse.json(
      { error: '접속 비밀번호가 올바르지 않습니다.', code: 'SIGNCHECK_INVALID' },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ ok: true, required: true });
  return clearLegacySigncheckCookie(response);
}
