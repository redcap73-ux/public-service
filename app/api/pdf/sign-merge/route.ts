import { NextRequest, NextResponse } from 'next/server';
import type { IdentityFormValues } from '@/lib/acroform-fill';
import { buildSignedMergedPdfOnServer } from '@/lib/sign-documents.server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_SIGNATURE_CHARS = 2_500_000; // ~1.8MB base64
const MAX_DOCUMENTS = 20;

type SignApiResponse = {
  ok?: boolean;
  request?: {
    status?: string;
    completed_at?: string | null;
    expires_at?: string;
  };
};

type SignMergeBody = {
  token?: string;
  signatureDataUrl?: string;
  documents?: Array<{
    filePath?: string;
    index?: number;
    identity?: IdentityFormValues | null;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SignMergeBody;
    const token = String(body.token ?? '').trim();
    const signatureDataUrl = String(body.signatureDataUrl ?? '').trim();
    const documents = Array.isArray(body.documents) ? body.documents : [];

    if (!token) {
      return NextResponse.json({ error: 'token 값이 필요합니다.' }, { status: 401 });
    }

    if (!signatureDataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'signatureDataUrl(서명 이미지)이 필요합니다.' },
        { status: 400 }
      );
    }

    if (signatureDataUrl.length > MAX_SIGNATURE_CHARS) {
      return NextResponse.json(
        { error: '서명 이미지 용량이 너무 큽니다. 다시 서명한 뒤 시도해 주세요.' },
        { status: 413 }
      );
    }

    if (!documents.length) {
      return NextResponse.json(
        { error: '서명할 documents 목록이 필요합니다.' },
        { status: 400 }
      );
    }

    if (documents.length > MAX_DOCUMENTS) {
      return NextResponse.json(
        { error: `한 번에 최대 ${MAX_DOCUMENTS}개 문서까지 처리할 수 있습니다.` },
        { status: 413 }
      );
    }

    for (const doc of documents) {
      if (!String(doc.filePath ?? '').trim()) {
        return NextResponse.json(
          { error: 'documents[].filePath 값이 필요합니다.' },
          { status: 400 }
        );
      }
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

    const result = await buildSignedMergedPdfOnServer({
      signatureDataUrl,
      documents: documents.map((doc) => ({
        filePath: String(doc.filePath).trim(),
        index: doc.index,
        identity: doc.identity ?? null,
      })),
    });

    return new NextResponse(Buffer.from(result.mergedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="signed-merged.pdf"',
        'Cache-Control': 'no-store',
        'X-Signed-Hash': result.mergedHash,
        'X-Signed-Doc-Count': String(result.documents.length),
      },
    });
  } catch (error) {
    console.error('[pdf/sign-merge]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '서버 서명 PDF 생성에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}
