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
