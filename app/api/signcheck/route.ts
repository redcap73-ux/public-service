import { NextRequest, NextResponse } from 'next/server';
import {
  attachSigncheckCookie,
  getSigncheckKey,
  isSigncheckRequired,
  isSigncheckUnlocked,
  keysMatch,
} from '@/lib/signcheck.server';

export async function GET() {
  const required = isSigncheckRequired();
  if (!required) {
    return NextResponse.json({ required: false, unlocked: true });
  }

  const unlocked = await isSigncheckUnlocked();
  return NextResponse.json({ required: true, unlocked });
}

export async function POST(request: NextRequest) {
  const secret = getSigncheckKey();
  if (!secret) {
    return NextResponse.json({ ok: true, required: false });
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

  const response = NextResponse.json({ ok: true, required: true, unlocked: true });
  return attachSigncheckCookie(response, secret);
}
