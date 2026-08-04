import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerIdentity } from '@/app/actions/verify';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { identityVerificationId?: string };
    const identityVerificationId = body.identityVerificationId?.trim();

    if (!identityVerificationId) {
      return NextResponse.json(
        { success: false, message: 'identityVerificationId 값이 전달되지 않았습니다.' },
        { status: 400 }
      );
    }

    const result = await verifyCustomerIdentity(identityVerificationId);
    return NextResponse.json(result);
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
