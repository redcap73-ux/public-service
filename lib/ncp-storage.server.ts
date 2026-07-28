import 'server-only';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

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

  return {
    objectKey,
    body: Buffer.from(bytes),
    contentType: response.ContentType || getContentTypeFromKey(objectKey),
    contentLength: response.ContentLength,
    fileName: getFileNameFromKey(objectKey),
  };
}
