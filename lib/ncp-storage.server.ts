import 'server-only';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  encryptFileBuffer,
  hasFileEncryptionKey,
  isEncryptedPayload,
} from '@/lib/file-encryption.server';

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }

  return value;
}

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    endpoint: getRequiredEnv('NCP_ENDPOINT'),
    region: 'kr-standard',
    credentials: {
      accessKeyId: getRequiredEnv('NCP_ACCESS_KEY'),
      secretAccessKey: getRequiredEnv('NCP_SECRET_KEY'),
    },
    forcePathStyle: true,
  });

  return s3Client;
}

export function getNcpBucketName() {
  return getRequiredEnv('NCP_BUCKET_NAME');
}

export function normalizeObjectKey(filePath: string) {
  const key = filePath.trim().replace(/^\/+/, '');

  if (!key) {
    throw new Error('file_path 값이 비어 있습니다.');
  }

  if (key.includes('..') || key.includes('\\')) {
    throw new Error('유효하지 않은 file_path 입니다.');
  }

  return key;
}

export function getFileNameFromKey(objectKey: string) {
  const segments = objectKey.split('/');
  return segments[segments.length - 1] || 'download.pdf';
}

export function getContentTypeFromKey(objectKey: string) {
  const lower = objectKey.toLowerCase();

  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }

  if (lower.endsWith('.png')) {
    return 'image/png';
  }

  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }

  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

export async function getObjectFromNcp(filePath: string) {
  const objectKey = normalizeObjectKey(filePath);
  const client = getS3Client();
  const bucket = getNcpBucketName();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );

  if (!response.Body) {
    throw new Error('NCP에서 파일 본문을 가져오지 못했습니다.');
  }

  const bytes = await response.Body.transformToByteArray();
  // 이 서버는 주로 암호화 저장만 담당.
  // 템플릿 등 기존 평문 객체는 그대로 반환하고, 암호문(TNGENC01)은 복호화하지 않습니다.
  // 복호화·열람은 FILE_ENCRYPTION_KEY를 공유한 다른 서버에서 수행합니다.
  const body = Buffer.from(bytes);

  return {
    objectKey,
    body,
    encrypted: isEncryptedPayload(body),
    contentType: response.ContentType || getContentTypeFromKey(objectKey),
    contentLength: response.ContentLength,
    fileName: getFileNameFromKey(objectKey),
  };
}

export async function putObjectToNcp(options: {
  objectKey: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}) {
  if (!hasFileEncryptionKey()) {
    throw new Error(
      'FILE_ENCRYPTION_KEY가 없어 암호화 저장을 할 수 없습니다. openssl rand -base64 32 로 키를 생성하세요.'
    );
  }

  const objectKey = normalizeObjectKey(options.objectKey);
  const client = getS3Client();
  const bucket = getNcpBucketName();
  const plain =
    options.body instanceof Buffer ? options.body : Buffer.from(options.body);
  const body = encryptFileBuffer(plain);
  const contentType = options.contentType || getContentTypeFromKey(objectKey);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      Metadata: {
        'tng-encrypted': 'aes-256-gcm',
        'tng-enc-version': '1',
      },
    })
  );

  return {
    objectKey,
    sizeBytes: body.length,
    contentType,
    encrypted: true,
  };
}
