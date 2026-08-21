import { NextRequest, NextResponse } from 'next/server';
import { getObjectFromNcp, normalizeObjectKey } from '@/lib/ncp-storage.server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

type SignApiDocument = {
  file_path?: string;
};

type SignApiResponse = {
  ok?: boolean;
  request?: {
    expires_at?: string;
    status?: string;
    completed_at?: string | null;
  };
  documents?: SignApiDocument[];
};

function collectAllowedPaths(payload: SignApiResponse) {
  const paths = new Set<string>();

  for (const doc of Array.isArray(payload.documents) ? payload.documents : []) {
    const filePath = doc.file_path?.trim();
    if (!filePath) continue;

    try {
      paths.add(normalizeObjectKey(filePath));
    } catch {
      // ignore invalid document paths from backend
    }
  }

  return paths;
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  const token = request.nextUrl.searchParams.get('token')?.trim();
  const download = request.nextUrl.searchParams.get('download') === '1';

  if (!filePath) {
    return NextResponse.json(
      { error: 'path 값이 전달되지 않았습니다.' },
      { status: 400 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: 'token 값이 전달되지 않았습니다.' },
      { status: 401 }
    );
  }

  let objectKey: string;
  try {
    objectKey = normalizeObjectKey(filePath);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '유효하지 않은 path 입니다.',
      },
      { status: 400 }
    );
  }

  try {
    const signPayload = (await fetchPublicServiceSignFromServer(
      token
    )) as SignApiResponse;

    if (!signPayload?.ok || !signPayload.request) {
      return NextResponse.json(
        { error: '요청 정보를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const apiRequest = signPayload.request;

    if (apiRequest.status === 'COMPLETED' || apiRequest.completed_at) {
      return NextResponse.json(
        {
          error: '이미 전자서명이 완료된 요청입니다.',
          code: 'ALREADY_COMPLETED',
        },
        { status: 409 }
      );
    }

    const expiresAt = apiRequest.expires_at
      ? new Date(apiRequest.expires_at)
      : null;
    if (
      expiresAt &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: '서명 링크가 만료되었습니다.', code: 'TOKEN_EXPIRED' },
        { status: 410 }
      );
    }

    const allowedPaths = collectAllowedPaths(signPayload);
    if (!allowedPaths.has(objectKey)) {
      return NextResponse.json(
        { error: '이 요청에서 접근할 수 없는 파일입니다.' },
        { status: 403 }
      );
    }

    const file = await getObjectFromNcp(objectKey);
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
