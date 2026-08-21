import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const SIGNCHECK_COOKIE = 'signcheck';
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

export function getSigncheckKey() {
  const key =
    process.env.signcheck_key?.trim() ||
    process.env.SIGNCHECK_KEY?.trim() ||
    '';
  return key || null;
}

export function isSigncheckRequired() {
  return Boolean(getSigncheckKey());
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createSigncheckCookieValue(secret: string, now = Date.now()) {
  const exp = String(now + UNLOCK_TTL_MS);
  return `${exp}.${signPayload(exp, secret)}`;
}

export function verifySigncheckCookieValue(
  value: string | undefined,
  secret: string,
  now = Date.now()
) {
  if (!value) return false;

  const [exp, sig] = value.split('.');
  if (!exp || !sig) return false;

  const expected = signPayload(exp, secret);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false;
  }

  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= now) {
    return false;
  }

  return true;
}

export function keysMatch(input: string, expected: string) {
  const left = Buffer.from(createHmac('sha256', 'signcheck').update(input).digest());
  const right = Buffer.from(createHmac('sha256', 'signcheck').update(expected).digest());
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function isSigncheckUnlocked() {
  const secret = getSigncheckKey();
  if (!secret) return true;

  const jar = await cookies();
  return verifySigncheckCookieValue(jar.get(SIGNCHECK_COOKIE)?.value, secret);
}

export function attachSigncheckCookie(response: NextResponse, secret: string) {
  response.cookies.set(SIGNCHECK_COOKIE, createSigncheckCookieValue(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
  return response;
}

export function signcheckUnauthorizedResponse() {
  return NextResponse.json(
    {
      error: '접속 비밀번호 확인이 필요합니다.',
      code: 'SIGNCHECK_REQUIRED',
    },
    { status: 401 }
  );
}
