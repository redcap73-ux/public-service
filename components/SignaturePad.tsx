'use client';

import { useEffect, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';

type SignaturePadProps = {
  onSignatureChange?: (dataUrl: string | null) => void;
};

export default function SignaturePad({ onSignatureChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onSignatureChangeRef = useRef(onSignatureChange);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const pad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(0, 0, 0)',
      minWidth: 1.5,
      maxWidth: 3,
    });
    padRef.current = pad;

    const notifyChange = () => {
      const empty = pad.isEmpty();
      setIsEmpty(empty);
      onSignatureChangeRef.current?.(empty ? null : pad.toDataURL('image/png'));
    };

    const resizeCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.floor(container.clientWidth);
      const height = Math.max(Math.round(width * 0.4), 160);

      if (
        lastSizeRef.current.width === width &&
        lastSizeRef.current.height === height &&
        canvas.width === width * ratio &&
        canvas.height === height * ratio
      ) {
        return;
      }

      lastSizeRef.current = { width, height };
      const data = pad.isEmpty() ? null : pad.toData();

      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext('2d');
      context?.setTransform(1, 0, 0, 1, 0, 0);
      context?.scale(ratio, ratio);

      pad.clear();

      if (data && data.length > 0) {
        pad.fromData(data);
      }
    };

    resizeCanvas();
    pad.addEventListener('endStroke', notifyChange);

    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    observer.observe(container);
    window.addEventListener('resize', resizeCanvas);

    return () => {
      pad.off();
      pad.removeEventListener('endStroke', notifyChange);
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      padRef.current = null;
    };
  }, []);

  const handleClear = () => {
    const pad = padRef.current;

    if (!pad) {
      return;
    }

    pad.clear();
    setIsEmpty(true);
    onSignatureChangeRef.current?.(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        width: '100%',
        maxWidth: 'min(100%, 720px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0 }}>서명</h3>
        <button
          type="button"
          onClick={handleClear}
          style={{
            padding: '0.4rem 0.8rem',
            border: '1px solid #666',
            borderRadius: '0.35rem',
            backgroundColor: '#fff',
            color: '#111',
            cursor: 'pointer',
          }}
        >
          지우기
        </button>
      </div>

      <p style={{ margin: 0, color: '#555', fontSize: '0.95rem' }}>
        PC에서는 마우스로, 모바일에서는 손가락으로 서명해 주세요.
      </p>

      <div
        ref={containerRef}
        style={{
          width: '100%',
          border: '1px solid #ccc',
          borderRadius: '0.35rem',
          backgroundColor: '#fff',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        />
      </div>

      <p style={{ margin: 0, color: isEmpty ? '#842029' : '#0f5132', fontSize: '0.9rem' }}>
        {isEmpty ? '서명이 입력되지 않았습니다.' : '서명이 입력되었습니다.'}
      </p>
    </div>
  );
}
