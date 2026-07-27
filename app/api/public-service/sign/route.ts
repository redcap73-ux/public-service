import { NextRequest, NextResponse } from 'next/server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

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
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '서명 API 호출 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
