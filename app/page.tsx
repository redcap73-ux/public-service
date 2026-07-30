'use client';

import { useState } from 'react';
import { callPublicServiceApi } from '@/lib/api';

export default function Home() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApiCall = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callPublicServiceApi();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      gap: '2rem',
      padding: '2rem'
    }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>이 곳은 고객동의 웹 서버입니다.</h1>
      <p style={{ fontSize: '1.125rem', textAlign: 'center', margin: 0 }}>
         이곳에서 고객의 동의 및 인증절차를 진행하는 시스템을 구현 중입니다.
      </p>
      <button 
        onClick={handleApiCall}
        disabled={loading}
        style={{
          padding: '0.75rem 1.5rem',
          fontSize: '1rem',
          backgroundColor: loading ? '#ccc' : '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? '로딩 중...' : '서버 호출'}
      </button>

      {error && (
        <div style={{
          color: 'red',
          padding: '1rem',
          backgroundColor: '#ffebee',
          borderRadius: '0.5rem',
          maxWidth: '600px',
          textAlign: 'center'
        }}>
          에러: {error}
        </div>
      )}

      {data && (
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#f0f0f0',
          borderRadius: '0.5rem',
          maxWidth: '600px',
          wordBreak: 'break-word',
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          <h2 style={{ marginTop: 0 }}>응답 데이터:</h2>
          <pre style={{ 
            backgroundColor: '#fff', 
            padding: '1rem', 
            borderRadius: '0.25rem',
            overflow: 'auto'
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
