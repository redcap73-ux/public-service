import { NextRequest, NextResponse } from 'next/server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

function resolveUpstreamError(error: unknown) {
  const message =
    error instanceof Error ? error.message : '서명 API 호출 중 오류가 발생했습니다.';
  const status =
    typeof error === 'object' &&
    error &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
  const bodyText =
    typeof error === 'object' &&
    error &&
    'body' in error &&
    typeof (error as { body?: unknown }).body === 'string'
      ? (error as { body: string }).body
      : '';

  type UpstreamErrorBody = { code?: string; error?: string; message?: string };
  let parsed: UpstreamErrorBody | null = null;
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as UpstreamErrorBody) : null;
  } catch {
    parsed = null;
  }

  const combined = `${parsed?.code || ''} ${parsed?.error || ''} ${parsed?.message || ''} ${message} ${bodyText}`;
  let code = parsed?.code ? String(parsed.code).toUpperCase() : undefined;

  if (!code) {
    // 완료를 만료보다 먼저 판별
    if (
      status === 409 ||
      /ALREADY_COMPLETED|이미\s*완료|already.?completed|already.?used|1회\s*사용/i.test(
        combined
      )
    ) {
      code = 'ALREADY_COMPLETED';
    } else if (
      status === 410 ||
      /TOKEN_EXPIRED|만료|expired|expire/i.test(combined)
    ) {
      code = 'TOKEN_EXPIRED';
    }
  } else {
    const normalized = String(code).toUpperCase();
    code = normalized;
    // 업스트림 code가 만료여도 본문에 완료 신호가 있으면 완료로 보정
    if (
      normalized !== 'ALREADY_COMPLETED' &&
      normalized !== 'USED' &&
      (status === 409 ||
        /ALREADY_COMPLETED|이미\s*완료|already.?completed|already.?used/i.test(
          combined
        ))
    ) {
      code = 'ALREADY_COMPLETED';
    }
  }

  if (code === 'USED') {
    code = 'ALREADY_COMPLETED';
  }

  const responseStatus =
    code === 'TOKEN_EXPIRED'
      ? 410
      : code === 'ALREADY_COMPLETED'
        ? 409
        : status >= 400 && status < 600
          ? status
          : 500;

  return {
    status: responseStatus,
    body: {
      error: parsed?.error || parsed?.message || message,
      code,
    },
  };
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'token 값이 전달되지 않았습니다.' },
      { status: 400 }
    );
  }

  try {
    const data = await fetchPublicServiceSignFromServer(token);
    return NextResponse.json(data);
  } catch (error) {
    const resolved = resolveUpstreamError(error);
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
}
