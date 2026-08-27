import { NextRequest, NextResponse } from 'next/server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

type UpstreamErrorBody = {
  code?: string;
  error?: string;
  message?: string;
  request?: Record<string, unknown> | null;
  data?: { request?: Record<string, unknown> | null };
};

function isRequestAlreadyCompleted(req: Record<string, unknown> | null | undefined) {
  if (!req || typeof req !== 'object') return false;

  const truthy = (value: unknown) =>
    value === true ||
    value === 1 ||
    value === '1' ||
    /^(true|y|yes)$/i.test(String(value ?? '').trim());

  if (
    truthy(req.is_completed) ||
    truthy(req.signed) ||
    truthy(req.is_signed) ||
    truthy(req.completed)
  ) {
    return true;
  }

  for (const key of [
    'completed_at',
    'signed_at',
    'sign_completed_at',
    'finished_at',
    'complete_at',
    'signed_completed_at',
  ]) {
    if (req[key]) return true;
  }

  const status = String(
    req.status ?? req.sign_status ?? req.request_status ?? ''
  ).trim();
  const upper = status.toUpperCase();
  if (
    ['COMPLETED', 'SIGNED', 'DONE', 'USED', 'COMPLETE', 'FINISH', 'FINISHED'].includes(
      upper
    )
  ) {
    return true;
  }
  if (/완료|서명\s*완료|처리\s*완료/.test(status)) return true;
  return false;
}

function extractRequestFromBody(parsed: UpstreamErrorBody | null) {
  return parsed?.request || parsed?.data?.request || null;
}

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

  let parsed: UpstreamErrorBody | null = null;
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as UpstreamErrorBody) : null;
  } catch {
    parsed = null;
  }

  const requestRecord = extractRequestFromBody(parsed);
  const combined = `${parsed?.code || ''} ${parsed?.error || ''} ${parsed?.message || ''} ${message} ${bodyText}`;
  let code = parsed?.code ? String(parsed.code).toUpperCase() : undefined;

  // 만료 코드여도 본문에 완료 요청이 있으면 완료로 보정
  if (isRequestAlreadyCompleted(requestRecord)) {
    code = 'ALREADY_COMPLETED';
  } else if (!code) {
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
      error:
        code === 'ALREADY_COMPLETED'
          ? '이미 전자서명이 완료된 요청입니다.'
          : parsed?.error || parsed?.message || message,
      code,
      request: requestRecord || undefined,
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
    const data = (await fetchPublicServiceSignFromServer(token)) as {
      ok?: boolean;
      request?: Record<string, unknown> | null;
      documents?: unknown;
      code?: string;
      error?: string;
      message?: string;
    };

    // HTTP 200이어도 본문이 만료/완료 상태일 수 있음 → 완료 우선
    if (isRequestAlreadyCompleted(data?.request || null)) {
      return NextResponse.json(
        {
          error: '이미 전자서명이 완료된 요청입니다.',
          code: 'ALREADY_COMPLETED',
          request: data.request,
          documents: data.documents,
        },
        { status: 409 }
      );
    }

    if (data && data.ok === false) {
      const combined = `${data.code || ''} ${data.error || ''} ${data.message || ''}`;
      if (
        /ALREADY_COMPLETED|이미\s*완료|already.?completed|already.?used/i.test(combined)
      ) {
        return NextResponse.json(
          {
            error: data.error || data.message || '이미 전자서명이 완료된 요청입니다.',
            code: 'ALREADY_COMPLETED',
            request: data.request,
          },
          { status: 409 }
        );
      }
      if (/TOKEN_EXPIRED|만료|expired|expire/i.test(combined)) {
        return NextResponse.json(
          {
            error: data.error || data.message || '서명 링크가 만료되었습니다.',
            code: 'TOKEN_EXPIRED',
            request: data.request,
          },
          { status: 410 }
        );
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    const resolved = resolveUpstreamError(error);
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
}
