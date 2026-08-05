import 'server-only';

import { createHash } from 'crypto';

export function sha256HexFromBuffer(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256HexFromText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
