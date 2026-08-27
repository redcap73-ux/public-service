import { NextRequest, NextResponse } from 'next/server';
import {
  CompleteSignError,
  buildSignedObjectKey,
  verifySignedUploadHash,
} from '@/lib/sign-complete.server';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';
import { putObjectToNcp } from '@/lib/ncp-storage.server';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const token = String(formData.get('token') ?? '').trim();
    const requestNo = String(formData.get('requestNo') ?? '').trim();
    const signedHash = String(formData.get('signedHash') ?? '').trim();
    const file = formData.get('file');

    if (!token || !requestNo || !signedHash) {
      return NextResponse.json(
        { error: 'token, requestNo, signedHash 값이 필요합니다.' },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file(PDF)이 필요합니다.' }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: '빈 PDF 파일은 업로드할 수 없습니다.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `PDF 크기는 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB 이하여야 합니다.` },
        { status: 413 }
      );
    }

    const signPayload = (await fetchPublicServiceSignFromServer(token)) as {
      ok?: boolean;
      request?: {
        request_no?: string;
        status?: string;
        completed_at?: string | null;
        claim_no?: string;
        signer_name?: string;
      };
    };
    const apiRequest = signPayload?.request;

    if (!signPayload?.ok || !apiRequest) {
      return NextResponse.json({ error: '요청 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (apiRequest.status === 'COMPLETED' || apiRequest.completed_at) {
      return NextResponse.json(
        { error: '이미 전자서명이 완료된 요청입니다.', code: 'ALREADY_COMPLETED' },
        { status: 409 }
      );
    }

    if (apiRequest.request_no && apiRequest.request_no !== requestNo) {
      return NextResponse.json({ error: 'requestNo가 일치하지 않습니다.' }, { status: 422 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    verifySignedUploadHash(fileBuffer, signedHash);

    const objectKey = buildSignedObjectKey(requestNo, {
      claimNo: apiRequest.claim_no,
      signerName: apiRequest.signer_name,
    });
    const uploaded = await putObjectToNcp({
      objectKey,
      body: fileBuffer,
      contentType: 'application/pdf',
    });

    return NextResponse.json({
      ok: true,
      objectKey: uploaded.objectKey,
      signedHash,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
    });
  } catch (error) {
    if (error instanceof CompleteSignError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : '서명 PDF 업로드 중 오류가 발생했습니다.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
