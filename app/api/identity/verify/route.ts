import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerIdentity } from '@/app/actions/verify';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      identityVerificationId?: string;
      token?: string;
    };
    const identityVerificationId = body.identityVerificationId?.trim();
    const token = body.token?.trim();

    if (!identityVerificationId) {
      return NextResponse.json(
        { success: false, message: 'identityVerificationId 값이 전달되지 않았습니다.' },
        { status: 400 }
      );
    }

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: 'token 값이 전달되지 않았습니다.',
          code: 'TOKEN_REQUIRED',
        },
        { status: 400 }
      );
    }

    const result = await verifyCustomerIdentity(identityVerificationId, token);
    const status =
      result.success
        ? 200
        : result.code === 'IDENTITY_MISMATCH'
          ? 403
          : result.code === 'TOKEN_REQUIRED'
            ? 400
            : 400;

    return NextResponse.json(result, { status: result.success ? 200 : status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : '본인인증 검증 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
