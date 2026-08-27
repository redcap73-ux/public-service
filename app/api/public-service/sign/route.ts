import { NextRequest, NextResponse } from 'next/server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

type UpstreamErrorBody = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  request?: Record<string, unknown> | null;
  data?: { request?: Record<string, unknown> | null };
};

function isCompletedConsentMessage(text: string) {
  return /전자서명\s*동의(가)?\s*완료|동의가\s*완료되었습니다|이미\s*전자서명(이)?\s*완료|already.?completed/i.test(
    text
  );
}

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

function resolveCompletedCode(combined: string, requestRecord: Record<string, unknown> | null) {
  if (isRequestAlreadyCompleted(requestRecord) || isCompletedConsentMessage(combined)) {
    return 'ALREADY_COMPLETED';
  }
  return null;
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
  const originalError = parsed?.error || parsed?.message || '';
  const combined = `${parsed?.code || ''} ${originalError} ${message} ${bodyText}`;
  let code = parsed?.code ? String(parsed.code).toUpperCase() : undefined;

  const completedCode = resolveCompletedCode(combined, requestRecord);
  if (completedCode) {
    code = completedCode;
  } else if (!code) {
    if (
      status === 409 ||
      /ALREADY_COMPLETED|이미\s*완료|already.?used|1회\s*사용/i.test(combined)
    ) {
      code = 'ALREADY_COMPLETED';
    } else if (
      status === 410 ||
      /TOKEN_EXPIRED|만료|expired|expire/i.test(combined)
    ) {
      code = 'TOKEN_EXPIRED';
    }
  } else {
    code = String(code).toUpperCase();
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
      // 완료 시각이 포함된 원문 메시지 유지 (예: "2026-08-27 10:51 전자서명 동의가 완료되었습니다.")
      error:
        code === 'ALREADY_COMPLETED'
          ? originalError || '이미 전자서명이 완료된 요청입니다.'
          : originalError || message,
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
    const data = (await fetchPublicServiceSignFromServer(token)) as UpstreamErrorBody & {
      documents?: unknown;
    };

    const combined = `${data?.code || ''} ${data?.error || ''} ${data?.message || ''}`;
    const requestRecord = extractRequestFromBody(data);

    if (resolveCompletedCode(combined, requestRecord)) {
      return NextResponse.json(
        {
          ok: false,
          error: data.error || data.message || '이미 전자서명이 완료된 요청입니다.',
          code: 'ALREADY_COMPLETED',
          request: data.request,
          documents: data.documents,
        },
        { status: 409 }
      );
    }

    if (data && data.ok === false) {
      if (/TOKEN_EXPIRED|만료|expired|expire/i.test(combined)) {
        return NextResponse.json(
          {
            ok: false,
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
