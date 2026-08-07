'use server';

import { headers } from 'next/headers'; // 👈 1. headers 임포트

type VerifiedCustomer = {
  ci?: string;
  name?: string;
  phoneNumber?: string;
  birthDate?: string;
  gender?: string;
};

type PortOneIdentityVerificationResponse = {
  id: string;
  status?: string;
  verifiedCustomer?: VerifiedCustomer;
};

function getClientIp(headerList: Awaited<ReturnType<typeof headers>>) {
  return (
    headerList.get('cf-connecting-ip') ||
    headerList.get('x-forwarded-for')?.split(',')[0].trim() ||
    headerList.get('x-real-ip') ||
    '127.0.0.1'
  );
}

function parseUserAgent(rawUserAgent: string | null) {
  const ua = rawUserAgent ?? '';
  const lower = ua.toLowerCase();

  const device = /iphone|ipad|ipod|android|mobile/i.test(ua) ? '모바일' : 'PC';

  let os = 'Unknown OS';
  if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
  } else if (/android/i.test(ua)) {
    os = 'Android';
  } else if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/mac os x|macintosh/i.test(ua)) {
    os = 'macOS';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  let browser = 'Unknown Browser';
  if (lower.includes('edg/')) {
    browser = 'Edge';
  } else if (lower.includes('samsungbrowser/')) {
    browser = 'Samsung Internet';
  } else if (lower.includes('kakaotalk')) {
    browser = 'KakaoTalk In-App Browser';
  } else if (lower.includes('naver')) {
    browser = 'Naver In-App Browser';
  } else if (lower.includes('whale/')) {
    browser = 'Whale';
  } else if (lower.includes('crios/') || lower.includes('chrome/')) {
    browser = 'Chrome';
  } else if (lower.includes('fxios/') || lower.includes('firefox/')) {
    browser = 'Firefox';
  } else if (lower.includes('safari/') && !lower.includes('chrome/') && !lower.includes('crios/')) {
    browser = 'Safari';
  }

  return `${device} / ${os} / ${browser}`;
}

export async function verifyCustomerIdentity(identityVerificationId: string) {
  try {
    // 👈 2. 클라이언트의 IP 및 User-Agent 추출
    const headerList = await headers();

    const clientIp = getClientIp(headerList);
    const userAgent = parseUserAgent(headerList.get('user-agent'));

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

    const verificationId = data.id || identityVerificationId; 
    const { ci, name, phoneNumber, birthDate, gender } = data.verifiedCustomer ?? {};

    console.log('--- 인증 성공 및 유저 정보 수령 ---');
    console.log('인증 거래 ID:', verificationId);
    console.log('CI (연계정보):', ci);
    console.log('이름:', name);
    console.log('전화번호:', phoneNumber);
    console.log('생년월일:', birthDate);
    console.log('성별:', gender);
    // 👈 3. IP 및 기기 정보 로그 출력
    console.log('접속 IP:', clientIp);
    console.log('기기/브라우저 (User-Agent):', userAgent);

    return {
      success: true,
      userInfo: {
        txId: verificationId,
        name,
        phoneNumber,
        birthDate,
        gender,
        ci,
        clientIp,   // DB 저장 및 PDF 생성용으로 함께 반환
        userAgent,
      },
    };
  } catch (error) {
    console.error('서버 검증 에러:', error);
    return { success: false, message: '서버 처리 중 오류가 발생했습니다.' };
  }
}