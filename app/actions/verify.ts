'use server';

import { headers } from 'next/headers';
import { fetchPublicServiceSignFromServer } from '@/lib/public-service.server';

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

type SignRequestRecord = {
  signer_name?: string;
  signer_phone?: string;
};

type SignApiResponse = {
  ok?: boolean;
  request?: SignRequestRecord;
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

function normalizePersonName(value?: string | null) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizePhone(value?: string | null) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.startsWith('820') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits;
}

function getVerifiedIdentityMismatchMessage(options: {
  expectedName?: string | null;
  expectedPhone?: string | null;
  verifiedName?: string | null;
  verifiedPhone?: string | null;
}) {
  const expectedName = normalizePersonName(options.expectedName);
  const expectedPhone = normalizePhone(options.expectedPhone);
  const verifiedName = normalizePersonName(options.verifiedName);
  const verifiedPhone = normalizePhone(options.verifiedPhone);

  const nameMismatch =
    Boolean(expectedName) && Boolean(verifiedName) && expectedName !== verifiedName;
  const phoneMismatch =
    Boolean(expectedPhone) && Boolean(verifiedPhone) && expectedPhone !== verifiedPhone;

  if (!nameMismatch && !phoneMismatch) {
    return null;
  }

  if (nameMismatch && phoneMismatch) {
    return '본인인증 성명·연락처가 요청된 서명자 정보와 일치하지 않습니다. 본인 명의로 다시 인증해 주세요.';
  }

  if (nameMismatch) {
    return '본인인증 성명이 요청된 서명자와 일치하지 않습니다. 본인 명의로 다시 인증해 주세요.';
  }

  return '본인인증 연락처가 요청된 서명자 연락처와 일치하지 않습니다. 본인 명의로 다시 인증해 주세요.';
}

export async function verifyCustomerIdentity(
  identityVerificationId: string,
  token?: string
) {
  try {
    const headerList = await headers();

    const clientIp = getClientIp(headerList);
    const userAgent = parseUserAgent(headerList.get('user-agent'));
    const requestToken = token?.trim();

    if (!requestToken) {
      return {
        success: false as const,
        message: 'token 값이 전달되지 않았습니다.',
        code: 'TOKEN_REQUIRED',
      };
    }

    if (!process.env.PORTONE_API_SECRET) {
      return {
        success: false as const,
        message: 'PORTONE_API_SECRET 환경 변수가 설정되지 않았습니다.',
      };
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
      return { success: false as const, message: '본인인증 정보 조회에 실패했습니다.' };
    }

    const data = (await response.json()) as PortOneIdentityVerificationResponse;

    if (data.status !== 'VERIFIED') {
      return { success: false as const, message: '본인인증이 완료되지 않았습니다.' };
    }

    const verificationId = data.id || identityVerificationId;
    const customer = data.verifiedCustomer ?? {};
    const ci = customer.ci;
    const name = customer.name;
    const phoneNumber = normalizePhone(
      customer.phoneNumber ||
        (customer as { phone?: string }).phone ||
        (customer as { mobile?: string }).mobile
    );
    const birthDate = customer.birthDate;
    const gender = customer.gender;

    let signPayload: SignApiResponse;
    try {
      signPayload = (await fetchPublicServiceSignFromServer(requestToken)) as SignApiResponse;
    } catch (error) {
      console.error('서명 요청 조회 실패:', error);
      return {
        success: false as const,
        message: '서명 요청 정보를 확인할 수 없습니다.',
        code: 'REQUEST_LOOKUP_FAILED',
      };
    }

    const apiRequest = signPayload?.request;
    if (!signPayload?.ok || !apiRequest) {
      return {
        success: false as const,
        message: '서명 요청 정보를 찾을 수 없습니다.',
        code: 'REQUEST_NOT_FOUND',
      };
    }

    const mismatchMessage = getVerifiedIdentityMismatchMessage({
      expectedName: apiRequest.signer_name,
      expectedPhone: apiRequest.signer_phone,
      verifiedName: name,
      verifiedPhone: phoneNumber,
    });

    if (mismatchMessage) {
      return {
        success: false as const,
        message: mismatchMessage,
        code: 'IDENTITY_MISMATCH',
      };
    }

    return {
      success: true as const,
      userInfo: {
        txId: verificationId,
        name,
        phoneNumber,
        birthDate,
        gender,
        ci,
        clientIp,
        userAgent,
      },
    };
  } catch (error) {
    console.error('서버 검증 에러:', error);
    return { success: false as const, message: '서버 처리 중 오류가 발생했습니다.' };
  }
}
