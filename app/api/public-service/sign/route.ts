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

  let parsed: { code?: string; error?: string; message?: string } | null = null;
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as typeof parsed) : null;
  } catch {
    parsed = null;
  }

  const combined = `${parsed?.code || ''} ${parsed?.error || ''} ${parsed?.message || ''} ${message} ${bodyText}`;
  let code = parsed?.code;

  if (!code) {
    if (
      status === 410 ||
      /TOKEN_EXPIRED|만료|expired|expire/i.test(combined)
    ) {
      code = 'TOKEN_EXPIRED';
    } else if (
      status === 409 ||
      /ALREADY_COMPLETED|이미\s*완료|already.?completed/i.test(combined)
    ) {
      code = 'ALREADY_COMPLETED';
    }
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
