import 'server-only';

const TEST_URL = 'http://100.65.181.94/api/publicservice/test';
const SIGN_URL = 'http://100.65.181.94/api/publicservice/sign';
const COMPLETE_URL =
  process.env.PUBLIC_SERVICE_COMPLETE_URL ??
  'http://100.65.181.94/api/publicservice/sign/complete';

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
    throw new Error(`외부 API 호출 실패: 상태 코드 ${response.status}`);
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

export async function completePublicServiceSignFromServer(body: {
  token: string;
  signTransactionId: string;
  finalHash: string;
  evidenceHash: string;
  completedAt: string;
  evidenceObjectKey: string;
  evidence: unknown;
}) {
  return fetchWithApiKey(COMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
