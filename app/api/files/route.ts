import { NextRequest, NextResponse } from 'next/server';
import { getObjectFromNcp } from '@/lib/ncp-storage.server';

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  const download = request.nextUrl.searchParams.get('download') === '1';

  if (!filePath) {
    return NextResponse.json(
      { error: 'path 값이 전달되지 않았습니다.' },
      { status: 400 }
    );
  }

  try {
    const file = await getObjectFromNcp(filePath);
    const dispositionType = download ? 'attachment' : 'inline';
    const encodedFileName = encodeURIComponent(file.fileName);

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.contentLength ?? file.body.length),
        'Content-Disposition': `${dispositionType}; filename*=UTF-8''${encodedFileName}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '파일 조회 중 오류가 발생했습니다.';
    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: string }).name)
        : '';
    const errorCode =
      error && typeof error === 'object' && 'Code' in error
        ? String((error as { Code?: string }).Code)
        : '';

    const notFound =
      errorName === 'NoSuchKey' ||
      errorCode === 'NoSuchKey' ||
      message.includes('NoSuchKey') ||
      message.includes('Not Found') ||
      message.includes('유효하지 않은') ||
      message.includes('비어 있습니다');

    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 }
    );
  }
}
