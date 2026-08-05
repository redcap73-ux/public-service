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

export async function uploadSignedPdfApi(formData: FormData) {
  const response = await fetch('/api/sign/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? `서명 PDF 업로드 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}

export async function completeSignRequestApi(body: {
  token: string;
  evidence: unknown;
  evidenceHash: string;
}) {
  const response = await fetch('/api/public-service/sign/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? `전자서명 완료 실패: 상태 코드 ${response.status}`);
  }

  return response.json();
}
