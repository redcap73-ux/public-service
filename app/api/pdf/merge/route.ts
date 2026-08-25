import { NextRequest, NextResponse } from 'next/server';
import { mergePdfByteList } from '@/lib/pdf-merge';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

type SignApiResponse = {
  ok?: boolean;
  request?: {
    status?: string;
    completed_at?: string | null;
    expires_at?: string;
  };
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const token = String(formData.get('token') ?? '').trim();

    if (!token) {
      return NextResponse.json({ error: 'token 값이 필요합니다.' }, { status: 401 });
    }

    const signPayload = (await fetchPublicServiceSignFromServer(
      token
    )) as SignApiResponse;
    const apiRequest = signPayload?.request;

    if (!signPayload?.ok || !apiRequest) {
      return NextResponse.json(
        { error: '요청 정보를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (apiRequest.status === 'COMPLETED' || apiRequest.completed_at) {
      return NextResponse.json(
        {
          error: '이미 전자서명이 완료된 요청입니다.',
          code: 'ALREADY_COMPLETED',
        },
        { status: 409 }
      );
    }

    if (apiRequest.expires_at) {
      const expiresAt = new Date(apiRequest.expires_at);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: '서명 링크가 만료되었습니다.', code: 'TOKEN_EXPIRED' },
          { status: 410 }
        );
      }
    }

    const files = formData
      .getAll('files')
      .filter((item): item is File => item instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { error: '병합할 PDF(files)가 필요합니다.' },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `한 번에 최대 ${MAX_FILES}개까지 병합할 수 있습니다.` },
        { status: 413 }
      );
    }

    let totalBytes = 0;
    const pdfBytesList: Uint8Array[] = [];

    for (const file of files) {
      if (file.size <= 0) {
        return NextResponse.json(
          { error: '빈 PDF 파일은 병합할 수 없습니다.' },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: `PDF 하나당 ${MAX_FILE_BYTES / (1024 * 1024)}MB 이하여야 합니다.`,
          },
          { status: 413 }
        );
      }

      totalBytes += file.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return NextResponse.json(
          {
            error: `병합 요청 총 용량은 ${MAX_TOTAL_BYTES / (1024 * 1024)}MB 이하여야 합니다.`,
          },
          { status: 413 }
        );
      }

      pdfBytesList.push(new Uint8Array(await file.arrayBuffer()));
    }

    const mergedBytes = await mergePdfByteList(pdfBytesList);

    return new NextResponse(Buffer.from(mergedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="signed-merged.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[pdf/merge]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'PDF 병합에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}
