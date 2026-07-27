'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { callPublicServiceSignApi } from '@/lib/api';

function SignContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('동의 정보를 가져 오고 있습니다.');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatusMessage('동의 정보를 가져올 수 없습니다.');
      setJsonText(null);
      setError('URL에 token 값을 포함해 주세요. 예: /sign?token=aaa');
      return;
    }

    const currentToken = token;
    let isMounted = true;

    async function loadSignData() {
      setStatusMessage('동의 정보를 가져 오고 있습니다.');
      setError(null);
      setJsonText(null);

      try {
        const result = await callPublicServiceSignApi(currentToken);

        if (!isMounted) {
          return;
        }

        setJsonText(JSON.stringify(result, null, 2));
        setStatusMessage('동의 정보를 가져왔습니다.');
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setStatusMessage('동의 정보를 가져오지 못했습니다.');
        setError(err instanceof Error ? err.message : '서명 API 호출 중 오류가 발생했습니다.');
      }
    }

    loadSignData();

    return () => {
      isMounted = false;
    };
  }, [token]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>고객 동의 및 인증 화면</h1>
      <p style={{ margin: 0 }}>
        <strong>token:</strong> {token ?? '전달되지 않음'}
      </p>
      <p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 'bold' }}>{statusMessage}</p>

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
