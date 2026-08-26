import 'server-only';

const TEST_URL = 'http://100.65.181.94/api/publicservice/test';
const SIGN_URL = 'http://100.65.181.94/api/publicservice/sign';
const UPDATE_SIGNATURE_URL =
  process.env.PUBLIC_SERVICE_UPDATE_SIGNATURE_URL ??
  'http://100.65.181.94/api/update-signature';
const IDENTITY_PROFILE_URL =
  process.env.PUBLIC_SERVICE_IDENTITY_PROFILE_URL ??
  'http://100.65.181.94/api/publicservice/sign/identity';

function getApiKey() {
  const apiKey = process.env.MY_SECRET_API_KEY;

  if (!apiKey) {
    throw new Error('서버 API 키가 설정되지 않았습니다.');
  }

  return apiKey;
}

async function fetchWithApiKey(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'x-api-key': getApiKey(),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const error = new Error(
      `외부 API 호출 실패: 상태 코드 ${response.status}${
        errorBody ? ` (${errorBody.slice(0, 300)})` : ''
      }`
    ) as Error & { status?: number; body?: string };
    error.status = response.status;
    error.body = errorBody;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export async function fetchPublicServiceTestFromServer() {
  return fetchWithApiKey(TEST_URL);
}

export async function fetchPublicServiceSignFromServer(token: string) {
  const requestUrl = new URL(SIGN_URL);
  requestUrl.searchParams.set('token', token);

  return fetchWithApiKey(requestUrl.toString());
}

export type SignerIdentityProfilePayload = {
  token: string;
  name: string;
  birth?: string;
  gender?: string;
  phone?: string;
  postcode?: string;
  address?: string;
  addressBase?: string;
  addressDetail?: string;
  identityConfirmedAt: string;
};

/** 인적사항 확인 저장 — 외부 publicservice/sign/identity API로 전달 */
export async function saveSignerIdentityProfileFromServer(body: SignerIdentityProfilePayload) {
  return fetchWithApiKey(IDENTITY_PROFILE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function toKstIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return `${parts.replace(' ', 'T')}+09:00`;
}

/**
 * NCP evidence 저장 후 외부 서버로 서명 완료 정보를 전달합니다.
 * 수신 형식:
 * {
 *   token,
 *   evidence: { signedAt, note, name, phone, ci, ... },
 *   evidenceHash
 * }
 */
export async function completePublicServiceSignFromServer(body: {
  token: string;
  requestNo: string;
  signTransactionId: string;
  finalHash: string;
  evidenceHash: string;
  completedAt: string;
  evidenceObjectKey: string;
  signedFilePath?: string;
  name?: string;
  phone?: string;
  ci?: string;
  ip?: string;
  userAgent?: string;
  /** PortOne 본인인증 Transaction ID (identityVerificationId) */
  transactionId?: string;
  birth?: string;
  gender?: string;
  postcode?: string;
  address?: string;
  addressBase?: string;
  addressDetail?: string;
  identityConfirmedAt?: string;
  /** PortOne 본인인증 성공 시각 */
  identityVerifiedAt?: string;
}) {
  const payload = {
    token: body.token,
    evidence: {
      signedAt: toKstIsoString(body.completedAt),
      note: body.signTransactionId,
      requestNo: body.requestNo,
      name: body.name ?? '',
      phone: body.phone ?? '',
      ci: body.ci ?? '',
      birth: body.birth ?? '',
      gender: body.gender ?? '',
      postcode: body.postcode ?? '',
      address: body.address ?? '',
      address_base: body.addressBase ?? '',
      address_detail: body.addressDetail ?? '',
      signer_address: body.address ?? '',
      identity_confirmed_at: body.identityConfirmedAt ?? '',
      identity_verified_at: body.identityVerifiedAt
        ? toKstIsoString(body.identityVerifiedAt)
        : '',
      finalHash: body.finalHash,
      evidenceObjectKey: body.evidenceObjectKey,
      signed_file_path: body.signedFilePath ?? '',
      ip: body.ip ?? '',
      user_agent: body.userAgent ?? '',
      transactionId: body.transactionId ?? '',
    },
    evidenceHash: body.evidenceHash,
  };

  return fetchWithApiKey(UPDATE_SIGNATURE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

