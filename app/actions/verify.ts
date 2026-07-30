'use server';

type VerifiedCustomer = {
  ci?: string;
  name?: string;
  phoneNumber?: string;
  birthDate?: string;
  gender?: string;
};

type PortOneIdentityVerificationResponse = {
  status?: string;
  verifiedCustomer?: VerifiedCustomer;
};

export async function verifyCustomerIdentity(identityVerificationId: string) {
  try {
    if (!process.env.PORTONE_API_SECRET) {
      return { success: false, message: 'PORTONE_API_SECRET 환경 변수가 설정되지 않았습니다.' };
    }

    const response = await fetch(
      `https://api.portone.io/identity-verifications/${encodeURIComponent(identityVerificationId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `PortOne ${process.env.PORTONE_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('포트원 API 에러:', errorData);
      return { success: false, message: '본인인증 정보 조회에 실패했습니다.' };
    }

    const data = (await response.json()) as PortOneIdentityVerificationResponse;

    if (data.status !== 'VERIFIED') {
      return { success: false, message: '본인인증이 완료되지 않았습니다.' };
    }

    const { ci, name, phoneNumber, birthDate } = data.verifiedCustomer ?? {};

    console.log('--- 인증 성공 및 유저 정보 수령 ---');
    console.log('CI (연계정보):', ci);
    console.log('이름:', name);
    console.log('전화번호:', phoneNumber);
    console.log('생년월일:', birthDate);

    return {
      success: true,
      userInfo: {
        name,
        phoneNumber,
        birthDate,
        ci,
      },
    };
  } catch (error) {
    console.error('서버 검증 에러:', error);
    return { success: false, message: '서버 처리 중 오류가 발생했습니다.' };
  }
}
