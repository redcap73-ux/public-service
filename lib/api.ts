export async function callPublicServiceApi() {
  const response = await fetch('/api/public-service', {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? `API 호출 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}

export async function callPublicServiceSignApi(token: string) {
  const response = await fetch(`/api/public-service/sign?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? `서명 API 호출 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}

export async function fetchPublicServiceSignFromServer(token: string) {
  const apiKey = process.env.MY_SECRET_API_KEY;

  if (!apiKey) {
    throw new Error('서버 API 키가 설정되지 않았습니다.');
  }

  const requestUrl = new URL('http://100.65.181.94/api/publicservice/sign');
  requestUrl.searchParams.set('token', token);

  const response = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`서명 API 호출 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}
