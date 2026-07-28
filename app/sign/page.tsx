'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { callPublicServiceSignApi } from '@/lib/api';

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

function buildFileApiUrl(filePath: string, download = false) {
  const params = new URLSearchParams({ path: filePath });

  if (download) {
    params.set('download', '1');
  }

  const url = `/api/files?${params.toString()}`;

  if (!download) {
    return `${url}#view=FitH`;
  }

  return url;
}

function SignContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [signData, setSignData] = useState<unknown>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('동의 정보를 가져 오고 있습니다.');
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const documents = useMemo(() => extractDocuments(signData), [signData]);

  useEffect(() => {
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
                      href={buildFileApiUrl(document.file_path, true)}
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
              <h3 style={{ margin: 0 }}>PDF 미리보기</h3>
              <div
                style={{
                  width: '50%',
                  maxWidth: '50%',
                  overflowX: 'hidden',
                  border: '1px solid #ccc',
                  borderRadius: '0.35rem',
                  backgroundColor: '#fff',
                }}
              >
                <iframe
                  key={previewPath}
                  title="PDF 미리보기"
                  src={buildFileApiUrl(previewPath)}
                  style={{
                    display: 'block',
                    width: '100%',
                    minHeight: '70vh',
                    border: 'none',
                    overflow: 'hidden',
                  }}
                />
              </div>
            </div>
          )}
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
