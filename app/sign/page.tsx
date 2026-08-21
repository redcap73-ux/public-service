'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import * as PortOne from '@portone/browser-sdk/v2';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadHandle } from '@/components/SignaturePad';
import { verifyCustomerIdentity } from '@/app/actions/verify';
import { callPublicServiceSignApi } from '@/lib/api';
import { fillAcroFormIdentity } from '@/lib/acroform-fill';
import { downloadSignedDocuments } from '@/lib/signed-pdf';

const PdfPreview = dynamic(() => import('@/components/PdfPreview'), {
  ssr: false,
  loading: () => <p style={{ padding: '1rem', margin: 0 }}>PDF를 불러오는 중...</p>,
});

type SignDocument = {
  file_path: string;
  title?: string;
  name?: string;
  file_name?: string;
  [key: string]: unknown;
};

function extractDocuments(payload: unknown): SignDocument[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const candidates = [root.documents, (root.data as Record<string, unknown> | undefined)?.documents];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.filter((item): item is SignDocument => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as SignDocument).file_path === 'string' &&
        (item as SignDocument).file_path.trim().length > 0
      );
    });
  }

  return [];
}

function getDocumentLabel(document: SignDocument, index: number) {
  return (
    document.title ||
    document.name ||
    document.file_name ||
    document.file_path.split('/').pop() ||
    `문서 ${index + 1}`
  );
}

function buildFileApiUrl(filePath: string, token: string, download = false) {
  const params = new URLSearchParams({ path: filePath, token });

  if (download) {
    params.set('download', '1');
  }

  return `/api/files?${params.toString()}`;
}

function SignContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [signcheckState, setSigncheckState] = useState<'checking' | 'locked' | 'unlocked'>(
    'checking'
  );
  const [signcheckKey, setSigncheckKey] = useState('');
  const [signcheckError, setSigncheckError] = useState<string | null>(null);
  const [isSubmittingSigncheck, setIsSubmittingSigncheck] = useState(false);
  const [signData, setSignData] = useState<unknown>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('접속 확인 중...');
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<{
    name?: string;
    phoneNumber?: string;
    birthDate?: string;
    ci?: string;
    txId?: string;
    clientIp?: string;
    userAgent?: string;
  } | null>(null);
  const [filledPreviewUrls, setFilledPreviewUrls] = useState<Record<string, string>>({});
  const signaturePadRef = useRef<SignaturePadHandle | null>(null);
  const filledPreviewUrlsRef = useRef<Record<string, string>>({});

  const documents = useMemo(() => extractDocuments(signData), [signData]);

  const previewFileUrl = useMemo(() => {
    if (!previewPath || !token) {
      return null;
    }

    return filledPreviewUrls[previewPath] ?? buildFileApiUrl(previewPath, token);
  }, [previewPath, filledPreviewUrls, token]);

  function revokeFilledPreviewUrls(urls: Record<string, string>) {
    for (const url of Object.values(urls)) {
      URL.revokeObjectURL(url);
    }
  }

  async function submitSigncheck() {
    const key = signcheckKey.trim();
    if (!key) {
      setSigncheckError('접속 비밀번호를 입력해 주세요.');
      return;
    }

    setIsSubmittingSigncheck(true);
    setSigncheckError(null);

    try {
      const response = await fetch('/api/signcheck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setSigncheckError(body?.error ?? '접속 비밀번호가 올바르지 않습니다.');
        return;
      }

      setSigncheckState('unlocked');
      setStatusMessage('동의 정보를 가져 오고 있습니다.');
    } catch {
      setSigncheckError('접속 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmittingSigncheck(false);
    }
  }

  async function buildFilledPreviewUrls(
    docs: SignDocument[],
    userInfo: {
      name?: string;
      phoneNumber?: string;
      birthDate?: string;
      ci?: string;
      txId?: string;
      clientIp?: string;
      userAgent?: string;
    }
  ) {
    const nextUrls: Record<string, string> = {};

    if (!token) {
      return 0;
    }

    for (const document of docs) {
      const response = await fetch(buildFileApiUrl(document.file_path, token), {
        cache: 'no-store',
      });

      if (!response.ok) {
        continue;
      }

      const pdfBytes = await response.arrayBuffer();
      const filled = await fillAcroFormIdentity(pdfBytes, userInfo);

      if (!filled) {
        continue;
      }

      const blob = new Blob([new Uint8Array(filled.bytes)], {
        type: 'application/pdf',
      });
      nextUrls[document.file_path] = URL.createObjectURL(blob);
    }

    revokeFilledPreviewUrls(filledPreviewUrlsRef.current);
    filledPreviewUrlsRef.current = nextUrls;
    setFilledPreviewUrls(nextUrls);

    return Object.keys(nextUrls).length;
  }

  async function handleSaveSignedPdfs() {
    // Always re-capture from the pad at save time (mobile state can go stale/blank).
    const capturedSignature =
      signaturePadRef.current?.getSignatureDataUrl() ?? signatureDataUrl;

    if (!capturedSignature) {
      setSaveError('서명이 없습니다. 먼저 서명해 주세요.');
      setSaveMessage(null);
      return;
    }

    setSignatureDataUrl(capturedSignature);
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage('서명된 PDF를 준비하는 중...');

    if (!token) {
      setSaveError('URL에 token 값이 없습니다.');
      setSaveMessage(null);
      setIsSaving(false);
      return;
    }

    try {
      await downloadSignedDocuments({
        documents: documents.map((document, index) => ({
          filePath: document.file_path,
          fileUrl: buildFileApiUrl(document.file_path, token),
          label: getDocumentLabel(document, index),
        })),
        signatureDataUrl: capturedSignature,
        identity: verifiedUser,
        onProgress: setSaveMessage,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '서명 PDF 저장 중 오류가 발생했습니다.');
      setSaveMessage(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteAndVerify() {
    const capturedSignature =
      signaturePadRef.current?.getSignatureDataUrl() ?? signatureDataUrl;

    if (capturedSignature) {
      setSignatureDataUrl(capturedSignature);
    }

    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

    if (!storeId || !channelKey) {
      setVerifyError('본인인증 설정(NEXT_PUBLIC_PORTONE_STORE_ID / CHANNEL_KEY)이 없습니다.');
      setVerifyMessage(null);
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);
    setVerifyMessage('본인인증을 진행합니다...');

    try {
      const response = await PortOne.requestIdentityVerification({
        storeId,
        channelKey,
        identityVerificationId: `verification-${Date.now()}`,
      });

      if (!response) {
        setVerifyError('본인인증 응답이 없습니다.');
        setVerifyMessage(null);
        return;
      }

      if (response.code !== undefined) {
        setVerifyError(`인증 취소/실패: ${response.message ?? response.code}`);
        setVerifyMessage(null);
        return;
      }

      if (!response.identityVerificationId) {
        setVerifyError('본인인증 ID를 받지 못했습니다.');
        setVerifyMessage(null);
        return;
      }

      setVerifyMessage('본인인증 결과를 확인하는 중...');

      if (!token) {
        setVerifyError('URL에 token 값이 없습니다.');
        setVerifyMessage(null);
        return;
      }

      const result = await verifyCustomerIdentity(response.identityVerificationId, token);

      if (!result.success) {
        setVerifyError(result.message ?? '본인인증 검증에 실패했습니다.');
        setVerifyMessage(null);
        return;
      }

      const userInfo = {
        name: result.userInfo?.name,
        phoneNumber: result.userInfo?.phoneNumber,
        birthDate: result.userInfo?.birthDate,
        ci: result.userInfo?.ci,
        txId: result.userInfo?.txId,
        clientIp: result.userInfo?.clientIp,
        userAgent: result.userInfo?.userAgent,
      };
      setVerifiedUser(userInfo);
      setVerifyError(null);

      if (documents.length > 0) {
        setVerifyMessage('본인인증 완료. 미리보기에 정보를 반영하는 중...');
        const filledCount = await buildFilledPreviewUrls(documents, userInfo);
        setVerifyMessage(
          `본인인증이 완료되었습니다. (${userInfo.name ?? '이름 없음'} / ${userInfo.phoneNumber ?? '연락처 없음'} / ${userInfo.birthDate ?? '생년월일 없음'}). ` +
            (filledCount > 0
              ? `AcroForm 문서 ${filledCount}개 미리보기에 반영했습니다. 서명 후 「저장 (서명 PDF 다운로드)」를 눌러 주세요.`
              : 'AcroForm 필드가 있는 문서가 없어 미리보기 반영을 건너뛰었습니다. 서명 후 「저장 (서명 PDF 다운로드)」를 눌러 주세요.')
        );
      } else {
        setVerifyMessage(
          `본인인증이 완료되었습니다. (${userInfo.name ?? '이름 없음'} / ${userInfo.phoneNumber ?? '연락처 없음'} / ${userInfo.birthDate ?? '생년월일 없음'}). 서명 후 「저장 (서명 PDF 다운로드)」를 눌러 주세요.`
        );
      }
    } catch (err) {
      console.error(err);
      setVerifyError(err instanceof Error ? err.message : '본인인증 중 오류가 발생했습니다.');
      setVerifyMessage(null);
    } finally {
      setIsVerifying(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function checkSignAccess() {
      try {
        const response = await fetch('/api/signcheck', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const body = await response.json().catch(() => null);

        if (!isMounted) {
          return;
        }

        if (!response.ok || body?.required) {
          setSigncheckState('locked');
          setStatusMessage('접속 비밀번호를 입력해 주세요.');
          return;
        }

        setSigncheckState('unlocked');
        setStatusMessage('동의 정보를 가져 오고 있습니다.');
      } catch {
        if (!isMounted) {
          return;
        }

        setSigncheckState('locked');
        setStatusMessage('접속 비밀번호를 입력해 주세요.');
      }
    }

    void checkSignAccess();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (signcheckState !== 'unlocked') {
      return;
    }

    if (!token) {
      setStatusMessage('동의 정보를 가져올 수 없습니다.');
      setSignData(null);
      setJsonText(null);
      setPreviewPath(null);
      setError('URL에 token 값을 포함해 주세요. 예: /sign?token=aaa');
      return;
    }

    const currentToken = token;
    let isMounted = true;

    async function loadSignData() {
      setStatusMessage('동의 정보를 가져 오고 있습니다.');
      setError(null);
      setSignData(null);
      setJsonText(null);
      setPreviewPath(null);
      setVerifiedUser(null);
      revokeFilledPreviewUrls(filledPreviewUrlsRef.current);
      filledPreviewUrlsRef.current = {};
      setFilledPreviewUrls({});

      try {
        const result = await callPublicServiceSignApi(currentToken);

        if (!isMounted) {
          return;
        }

        const nextDocuments = extractDocuments(result);

        setSignData(result);
        setJsonText(JSON.stringify(result, null, 2));
        setPreviewPath(nextDocuments[0]?.file_path ?? null);
        setStatusMessage('동의 정보를 가져왔습니다.');
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setStatusMessage('동의 정보를 가져오지 못했습니다.');
        setError(err instanceof Error ? err.message : '서명 API 호출 중 오류가 발생했습니다.');
      }
    }

    void loadSignData();

    return () => {
      isMounted = false;
      revokeFilledPreviewUrls(filledPreviewUrlsRef.current);
      filledPreviewUrlsRef.current = {};
    };
  }, [token, signcheckState]);

  if (signcheckState === 'checking') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          minHeight: '100vh',
          padding: '1rem',
          fontFamily: 'Arial, sans-serif',
          boxSizing: 'border-box',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 'bold' }}>고객 동의 및 인증 화면</h1>
        <p style={{ margin: 0 }}>접속 확인 중...</p>
      </div>
    );
  }

  if (signcheckState === 'locked') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          minHeight: '100vh',
          padding: '1rem',
          fontFamily: 'Arial, sans-serif',
          boxSizing: 'border-box',
          maxWidth: 480,
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 'bold' }}>접속 비밀번호 확인</h1>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
          화면을 열기 전에 접속 비밀번호를 입력해 주세요.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontWeight: 600 }}>접속 비밀번호</span>
          <input
            type="password"
            value={signcheckKey}
            autoComplete="current-password"
            autoFocus
            onChange={(event) => {
              setSigncheckKey(event.target.value);
              setSigncheckError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitSigncheck();
              }
            }}
            style={{
              padding: '0.7rem 0.8rem',
              border: '1px solid #cbd5e1',
              borderRadius: '0.4rem',
              fontSize: '1rem',
            }}
          />
        </label>
        {signcheckError && <p style={{ margin: 0, color: '#842029' }}>{signcheckError}</p>}
        <button
          type="button"
          onClick={() => void submitSigncheck()}
          disabled={isSubmittingSigncheck}
          style={{
            padding: '0.75rem 1.25rem',
            border: 'none',
            borderRadius: '0.35rem',
            backgroundColor: isSubmittingSigncheck ? '#9aa4b2' : '#0052cc',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: isSubmittingSigncheck ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {isSubmittingSigncheck ? '확인 중...' : '확인 후 계속'}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        minHeight: '100vh',
        padding: '1rem',
        fontFamily: 'Arial, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 'bold' }}>고객 동의 및 인증 화면</h1>
      <p style={{ margin: 0 }}>
        <strong>token:</strong> {token ?? '전달되지 않음'}
      </p>
      <p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 'bold' }}>{statusMessage}</p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          maxWidth: 'min(100%, 720px)',
        }}
      >
        <button
          type="button"
          onClick={handleCompleteAndVerify}
          disabled={isVerifying}
          style={{
            padding: '0.75rem 1.25rem',
            border: 'none',
            borderRadius: '0.35rem',
            backgroundColor: isVerifying ? '#9aa4b2' : '#0052cc',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: isVerifying ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {isVerifying ? '본인인증 진행 중...' : '서명 완료 및 본인인증 하기'}
        </button>

        {verifyMessage && (
          <p style={{ margin: 0, color: '#0f5132' }}>{verifyMessage}</p>
        )}

        {verifyError && (
          <p style={{ margin: 0, color: '#842029' }}>{verifyError}</p>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            color: '#842029',
            backgroundColor: '#f8d7da',
            borderRadius: '0.5rem',
          }}
        >
          에러: {error}
        </div>
      )}

      {!error && documents.length > 0 && (
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            padding: '1rem',
            backgroundColor: '#f5f5f5',
            borderRadius: '0.5rem',
          }}
        >
          <h2 style={{ margin: 0 }}>동의 문서</h2>

          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.75rem' }}>
            {documents.map((document, index) => {
              const isSelected = previewPath === document.file_path;
              const label = getDocumentLabel(document, index);

              return (
                <li key={`${document.file_path}-${index}`}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: isSelected ? 700 : 400 }}>{label}</span>
                    <button
                      type="button"
                      onClick={() => setPreviewPath(document.file_path)}
                      style={{
                        padding: '0.4rem 0.8rem',
                        border: '1px solid #333',
                        borderRadius: '0.35rem',
                        backgroundColor: isSelected ? '#333' : '#fff',
                        color: isSelected ? '#fff' : '#111',
                        cursor: 'pointer',
                      }}
                    >
                      미리보기
                    </button>
                    <a
                      href={token ? buildFileApiUrl(document.file_path, token, true) : '#'}
                      style={{
                        padding: '0.4rem 0.8rem',
                        border: '1px solid #0070f3',
                        borderRadius: '0.35rem',
                        backgroundColor: '#0070f3',
                        color: '#fff',
                        textDecoration: 'none',
                      }}
                    >
                      내려받기
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>

          {previewPath && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <h3 style={{ margin: 0 }}>
                PDF 미리보기
                {previewPath && filledPreviewUrls[previewPath] ? ' (본인정보 반영)' : ''}
              </h3>
              <div
                style={{
                  width: '100%',
                  maxWidth: 'min(100%, 720px)',
                  overflowX: 'hidden',
                  border: '1px solid #ccc',
                  borderRadius: '0.35rem',
                  backgroundColor: '#fff',
                }}
              >
                {previewFileUrl && (
                  <PdfPreview key={previewFileUrl} fileUrl={previewFileUrl} />
                )}
              </div>
            </div>
          )}

          <SignaturePad
            ref={signaturePadRef}
            onSignatureChange={(nextSignature) => {
              setSignatureDataUrl(nextSignature);
              setSaveError(null);
              setSaveMessage(null);
              setVerifyError(null);
              setVerifyMessage(null);
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxWidth: 'min(100%, 720px)',
            }}
          >
            <button
              type="button"
              onClick={handleSaveSignedPdfs}
              disabled={isSaving || !signatureDataUrl}
              style={{
                padding: '0.75rem 1.25rem',
                border: 'none',
                borderRadius: '0.35rem',
                backgroundColor: isSaving || !signatureDataUrl ? '#9aa4b2' : '#0b6e4f',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: isSaving || !signatureDataUrl ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              {isSaving ? '저장 중...' : '저장 (서명 PDF 다운로드)'}
            </button>

            {saveMessage && (
              <p style={{ margin: 0, color: '#0f5132' }}>{saveMessage}</p>
            )}

            {saveError && (
              <p style={{ margin: 0, color: '#842029' }}>{saveError}</p>
            )}
          </div>
        </section>
      )}

      {!error && jsonText && documents.length === 0 && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fff3cd',
            borderRadius: '0.5rem',
            color: '#664d03',
          }}
        >
          응답에 documents / file_path 정보가 없습니다.
        </div>
      )}

      {jsonText && !error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#f5f5f5',
            borderRadius: '0.5rem',
          }}
        >
          <h2 style={{ marginTop: 0 }}>응답 JSON</h2>
          <pre
            style={{
              margin: 0,
              padding: '1rem',
              backgroundColor: '#ffffff',
              borderRadius: '0.25rem',
              overflow: 'auto',
            }}
          >
            {jsonText}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SignPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem' }}>동의 정보를 가져 오고 있습니다.</div>}>
      <SignContent />
    </Suspense>
  );
}
