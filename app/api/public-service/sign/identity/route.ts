import { NextRequest, NextResponse } from 'next/server';
import {
  saveSignerIdentityProfileFromServer,
  type SignerIdentityProfilePayload,
} from '@/lib/public-service.server';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SignerIdentityProfilePayload;
    const token = body.token?.trim();

    if (!token) {
      return NextResponse.json({ error: 'token 값이 전달되지 않았습니다.' }, { status: 400 });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '성명은 필수입니다.' }, { status: 400 });
    }

    if (!body.address?.trim()) {
      return NextResponse.json({ error: '주소는 필수입니다.' }, { status: 400 });
    }

    if (!body.identityConfirmedAt) {
      return NextResponse.json({ error: 'identityConfirmedAt 값이 필요합니다.' }, { status: 400 });
    }

    const result = await saveSignerIdentityProfileFromServer(body);
    return NextResponse.json({ ok: true, backend: result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '인적사항 저장 API 호출 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
