import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * 앱 레벨 파일 암호화 포맷 (다른 서버 복호화 시 동일하게 사용)
 *
 * layout:
 *   [0..7]   MAGIC "TNGENC01"
 *   [8..19]  IV (12 bytes)
 *   [20..35] Auth Tag (16 bytes)
 *   [36..]   Ciphertext (AES-256-GCM)
 *
 * 환경변수 FILE_ENCRYPTION_KEY:
 *   - AES-256용 32바이트 키
 *   - base64 (권장) 또는 hex(64자)
 *
 * 키 생성 예:
 *   openssl rand -base64 32
 */
export const FILE_ENC_MAGIC = Buffer.from('TNGENC01', 'utf8');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEADER_LENGTH = FILE_ENC_MAGIC.length + IV_LENGTH + TAG_LENGTH;

export function getFileEncryptionKey() {
  const raw = process.env.FILE_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error('FILE_ENCRYPTION_KEY 환경 변수가 설정되지 않았습니다.');
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      'FILE_ENCRYPTION_KEY는 32바이트여야 합니다. openssl rand -base64 32 로 생성하세요.'
    );
  }

  return key;
}

export function hasFileEncryptionKey() {
  return Boolean(process.env.FILE_ENCRYPTION_KEY?.trim());
}

export function isEncryptedPayload(buffer: Buffer) {
  return (
    buffer.length >= HEADER_LENGTH &&
    buffer.subarray(0, FILE_ENC_MAGIC.length).equals(FILE_ENC_MAGIC)
  );
}

export function encryptFileBuffer(plain: Buffer) {
  const key = getFileEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([FILE_ENC_MAGIC, iv, tag, ciphertext]);
}

export function decryptFileBuffer(payload: Buffer) {
  if (!isEncryptedPayload(payload)) {
    throw new Error('암호화된 파일 형식이 아닙니다.');
  }

  const key = getFileEncryptionKey();
  const ivStart = FILE_ENC_MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + TAG_LENGTH;
  const iv = payload.subarray(ivStart, tagStart);
  const tag = payload.subarray(tagStart, dataStart);
  const ciphertext = payload.subarray(dataStart);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
