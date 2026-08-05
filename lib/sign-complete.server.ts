import 'server-only';

import type {
  CompleteSignRequestBody,
  CompleteSignResponseBody,
  SignEvidencePayload,
} from '@/lib/sign-complete.types';
import { sha256HexFromBuffer, sha256HexFromText } from '@/lib/sign-hash.server';
import { putObjectToNcp } from '@/lib/ncp-storage.server';
import {
  completePublicServiceSignFromServer,
  fetchPublicServiceSignFromServer,
} from '@/lib/public-service.server';

type SignRequestRecord = {
  request_no?: string;
  expires_at?: string;
  status?: string;
  completed_at?: string | null;
  claim_no?: string;
  signer_name?: string;
  signer_role?: string;
};

type SignApiDocument = {
  id?: string | number;
  template_code?: string;
  template_version?: string;
  file_path?: string;
  document_hash?: string;
};

type SignApiResponse = {
  ok?: boolean;
  request?: SignRequestRecord;
  documents?: SignApiDocument[];
};

function getRequestRecord(payload: SignApiResponse): SignRequestRecord {
  return payload.request ?? {};
}

function getApiDocuments(payload: SignApiResponse): SignApiDocument[] {
  return Array.isArray(payload.documents) ? payload.documents : [];
}

function buildSignTransactionId(completedAt: Date) {
  const datePart = completedAt.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = String(Date.now()).slice(-8);
  return `ESIGN-${datePart}-${suffix}`;
}

function buildEvidenceObjectKey(requestNo: string, signTransactionId: string) {
  return `evidence/${requestNo}/${signTransactionId}.json`;
}

export function computeEvidenceHash(evidence: SignEvidencePayload): string {
  return sha256HexFromText(JSON.stringify(evidence));
}

/**
 * finalHash = 서명된 PDF 파일들의 해시로만 구성합니다.
 * - 문서 1개: 해당 signedHash 그대로
 * - 문서 여러 개: 정렬 후 이어 붙인 값의 SHA-256
 */
export function computeFinalHash(signedHashes: string[]): string {
  const sorted = [...signedHashes].filter(Boolean).sort();

  if (sorted.length === 0) {
    throw new CompleteSignError(
      'VALIDATION_FAILED',
      '서명 PDF 해시가 없어 finalHash를 만들 수 없습니다.'
    );
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  return sha256HexFromText(sorted.join(''));
}

function validateEvidenceAgainstSignData(
  payload: SignApiResponse,
  body: CompleteSignRequestBody
) {
  const request = getRequestRecord(payload);
  const apiDocuments = getApiDocuments(payload);
  const { evidence, evidenceHash } = body;

  if (evidence.schemaVersion !== '1.0') {
    throw new CompleteSignError('VALIDATION_FAILED', '지원하지 않는 evidence schemaVersion 입니다.');
  }

  const computedEvidenceHash = computeEvidenceHash(evidence);
  if (computedEvidenceHash !== evidenceHash) {
    throw new CompleteSignError('VALIDATION_FAILED', 'evidenceHash가 일치하지 않습니다.');
  }

  if (request.request_no && evidence.requestNo !== request.request_no) {
    throw new CompleteSignError('VALIDATION_FAILED', 'requestNo가 일치하지 않습니다.');
  }

  if (request.claim_no && evidence.claimNo !== request.claim_no) {
    throw new CompleteSignError('VALIDATION_FAILED', 'claimNo가 일치하지 않습니다.');
  }

  if (request.signer_name && evidence.signer.name !== request.signer_name) {
    throw new CompleteSignError('VALIDATION_FAILED', '서명자 성명이 요청 정보와 일치하지 않습니다.');
  }

  if (request.signer_role && evidence.signer.role !== request.signer_role) {
    throw new CompleteSignError('VALIDATION_FAILED', '서명자 역할이 요청 정보와 일치하지 않습니다.');
  }

  if (evidence.documents.length !== apiDocuments.length) {
    throw new CompleteSignError('VALIDATION_FAILED', '문서 개수가 요청 정보와 일치하지 않습니다.');
  }

  for (const doc of evidence.documents) {
    const apiDoc = apiDocuments.find((item) => String(item.id) === String(doc.id));

    if (!apiDoc) {
      throw new CompleteSignError('VALIDATION_FAILED', `문서 ID ${doc.id}를 찾을 수 없습니다.`);
    }

    if (doc.originalFilePath && apiDoc.file_path && doc.originalFilePath !== apiDoc.file_path) {
      throw new CompleteSignError('VALIDATION_FAILED', `문서 ${doc.id} file_path가 일치하지 않습니다.`);
    }

    if (doc.originalHash && apiDoc.document_hash && doc.originalHash !== apiDoc.document_hash) {
      throw new CompleteSignError('VALIDATION_FAILED', `문서 ${doc.id} originalHash가 일치하지 않습니다.`);
    }

    if (doc.consent === 'agree' && doc.originalFilePath && !doc.signedObjectKey) {
      throw new CompleteSignError(
        'VALIDATION_FAILED',
        `동의 문서 ${doc.id}에 signedObjectKey가 필요합니다.`
      );
    }

    if (doc.consent === 'agree' && doc.originalFilePath && !doc.signedHash) {
      throw new CompleteSignError(
        'VALIDATION_FAILED',
        `동의 문서 ${doc.id}에 signedHash가 필요합니다.`
      );
    }
  }
}

export class CompleteSignError extends Error {
  code: 'VALIDATION_FAILED' | 'TOKEN_EXPIRED' | 'ALREADY_COMPLETED' | 'BACKEND_ERROR';

  status: number;

  constructor(
    code: CompleteSignError['code'],
    message: string,
    status = 422
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function completeSignRequestFromServer(
  body: CompleteSignRequestBody,
  clientIp?: string
): Promise<CompleteSignResponseBody> {
  const signPayload = (await fetchPublicServiceSignFromServer(body.token)) as SignApiResponse;

  if (!signPayload?.ok || !signPayload.request) {
    throw new CompleteSignError('VALIDATION_FAILED', '요청 정보를 찾을 수 없습니다.', 404);
  }

  const request = getRequestRecord(signPayload);

  if (request.status === 'COMPLETED' || request.completed_at) {
    throw new CompleteSignError('ALREADY_COMPLETED', '이미 전자서명이 완료된 요청입니다.', 409);
  }

  const expiresAt = request.expires_at ? new Date(request.expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
    throw new CompleteSignError('TOKEN_EXPIRED', '서명 링크가 만료되었습니다.', 410);
  }

  validateEvidenceAgainstSignData(signPayload, body);

  const completedAt = new Date(body.evidence.completedAt || new Date().toISOString());
  const signTransactionId = buildSignTransactionId(completedAt);
  const evidence: SignEvidencePayload = {
    ...body.evidence,
    completedAt: completedAt.toISOString(),
    client: {
      ...body.evidence.client,
      ip: clientIp ?? body.evidence.client.ip,
    },
  };

  const evidenceHash = computeEvidenceHash(evidence);
  const signedHashes = [
    ...new Set(
      evidence.documents
        .filter((doc) => doc.consent === 'agree')
        .map((doc) => doc.signedHash ?? '')
        .filter(Boolean)
    ),
  ];
  const finalHash = computeFinalHash(signedHashes);
  const evidenceObjectKey = buildEvidenceObjectKey(evidence.requestNo, signTransactionId);
  const signedFilePath =
    evidence.signed_file_path ||
    evidence.documents.find((doc) => doc.consent === 'agree' && doc.signedObjectKey)
      ?.signedObjectKey ||
    '';
  const clientIpValue = evidence.client.ip ?? clientIp ?? '';
  const userAgentValue = evidence.client.userAgent ?? '';

  const evidenceRecord = {
    ...evidence,
    signed_file_path: signedFilePath,
    ip: clientIpValue,
    user_agent: userAgentValue,
    signTransactionId,
    evidenceHash,
    finalHash,
  };

  await putObjectToNcp({
    objectKey: evidenceObjectKey,
    body: Buffer.from(JSON.stringify(evidenceRecord, null, 2), 'utf8'),
    contentType: 'application/json; charset=utf-8',
  });

  let backendSynced = false;

  try {
    await completePublicServiceSignFromServer({
      token: body.token,
      requestNo: evidence.requestNo,
      signTransactionId,
      finalHash,
      evidenceHash,
      completedAt: completedAt.toISOString(),
      evidenceObjectKey,
      signedFilePath,
      name: evidence.signer.name,
      phone: evidence.signer.phone,
      ci: evidence.auth.ci,
      ip: clientIpValue,
      userAgent: userAgentValue,
    });
    backendSynced = true;
  } catch (error) {
    console.warn('[sign-complete] backend sync skipped:', error);
  }

  return {
    ok: true,
    signTransactionId,
    finalHash,
    completedAt: completedAt.toISOString(),
    evidenceObjectKey,
    request: {
      request_no: evidence.requestNo,
      status: 'COMPLETED',
      completed_at: completedAt.toISOString(),
    },
    backendSynced,
  };
}

export function buildSignedObjectKey(requestNo: string) {
  const dateFolder = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return `signed/${dateFolder}/${requestNo}/signed.pdf`;
}

export function verifySignedUploadHash(fileBuffer: Buffer, signedHash: string) {
  const computed = sha256HexFromBuffer(fileBuffer);
  if (computed !== signedHash) {
    throw new CompleteSignError('VALIDATION_FAILED', 'signedHash가 업로드 파일과 일치하지 않습니다.');
  }
}
