import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';

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

export function keysMatch(input: string, expected: string) {
  const left = Buffer.from(createHmac('sha256', 'signcheck').update(input).digest());
  const right = Buffer.from(createHmac('sha256', 'signcheck').update(expected).digest());
  return left.length === right.length && timingSafeEqual(left, right);
}
