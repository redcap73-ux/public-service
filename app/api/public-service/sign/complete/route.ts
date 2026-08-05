import { NextRequest, NextResponse } from 'next/server';
import {
  CompleteSignError,
  completeSignRequestFromServer,
} from '@/lib/sign-complete.server';
import type { CompleteSignRequestBody } from '@/lib/sign-complete.types';

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || undefined;
  }

  return request.headers.get('x-real-ip') ?? undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompleteSignRequestBody;

    if (!body?.token || !body?.evidence || !body?.evidenceHash) {
      return NextResponse.json(
        { error: 'token, evidence, evidenceHash 값이 필요합니다.' },
        { status: 400 }
      );
    }

    const result = await completeSignRequestFromServer(body, getClientIp(request));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CompleteSignError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : '전자서명 완료 처리 중 오류가 발생했습니다.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
