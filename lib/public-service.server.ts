import 'server-only';

const TEST_URL = 'http://100.65.181.94/api/publicservice/test';
const SIGN_URL = 'http://100.65.181.94/api/publicservice/sign';

function getApiKey() {
  const apiKey = process.env.MY_SECRET_API_KEY;

  if (!apiKey) {
    throw new Error('서버 API 키가 설정되지 않았습니다.');
  }

  return apiKey;
}

async function fetchWithApiKey(url: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': getApiKey(),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`외부 API 호출 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}

export async function fetchPublicServiceTestFromServer() {
  return fetchWithApiKey(TEST_URL);
}

export async function fetchPublicServiceSignFromServer(token: string) {
  const requestUrl = new URL(SIGN_URL);
  requestUrl.searchParams.set('token', token);

  return fetchWithApiKey(requestUrl.toString());
}
