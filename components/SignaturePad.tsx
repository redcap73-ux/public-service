'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import SignaturePadLib from 'signature_pad';
import type { PointGroup } from 'signature_pad';

export type SignaturePadHandle = {
  getSignatureDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
};

type SignaturePadProps = {
  onSignatureChange?: (dataUrl: string | null) => void;
};

function exportStrokesToPng(points: PointGroup[], width: number, height: number) {
  if (!points.length || width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // Solid white background exports more reliably on iOS Safari.
  const pad = new SignaturePadLib(canvas, {
    backgroundColor: 'rgb(255, 255, 255)',
    penColor: 'rgb(0, 0, 0)',
    minWidth: 2.5,
    maxWidth: 5.5,
    throttle: 0,
  });

  pad.fromData(points);
  const dataUrl = pad.toDataURL('image/png');
  pad.off();

  if (!dataUrl.startsWith('data:image/png') || dataUrl.length < 800) {
    return null;
  }

  return dataUrl;
}

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ onSignatureChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onSignatureChangeRef = useRef(onSignatureChange);
    const strokeDataRef = useRef<PointGroup[]>([]);
    const lastGoodDataUrlRef = useRef<string | null>(null);
    const canvasSizeRef = useRef({ width: 300, height: 180 });
    const isDrawingRef = useRef(false);
    const [isEmpty, setIsEmpty] = useState(true);

    useEffect(() => {
      onSignatureChangeRef.current = onSignatureChange;
    }, [onSignatureChange]);

    const syncExport = () => {
      const pad = padRef.current;

      if (!pad || pad.isEmpty()) {
        strokeDataRef.current = [];
        lastGoodDataUrlRef.current = null;
        setIsEmpty(true);
        onSignatureChangeRef.current?.(null);
        return null;
      }

      const points = pad.toData();
      strokeDataRef.current = points;

      const { width, height } = canvasSizeRef.current;
      const dataUrl = exportStrokesToPng(points, width, height);

      if (dataUrl) {
        lastGoodDataUrlRef.current = dataUrl;
        setIsEmpty(false);
        onSignatureChangeRef.current?.(dataUrl);
        return dataUrl;
      }

      setIsEmpty(false);
      onSignatureChangeRef.current?.(lastGoodDataUrlRef.current);
      return lastGoodDataUrlRef.current;
    };

    useImperativeHandle(ref, () => ({
      getSignatureDataUrl: () => {
        // Prefer a fresh offscreen export from stroke points (mobile-safe).
        if (strokeDataRef.current.length > 0) {
          const { width, height } = canvasSizeRef.current;
          const fresh = exportStrokesToPng(strokeDataRef.current, width, height);

          if (fresh) {
            lastGoodDataUrlRef.current = fresh;
            setIsEmpty(false);
            onSignatureChangeRef.current?.(fresh);
            return fresh;
          }
        }

        const synced = syncExport();
        return synced ?? lastGoodDataUrlRef.current;
      },
      clear: () => {
        padRef.current?.clear();
        strokeDataRef.current = [];
        lastGoodDataUrlRef.current = null;
        setIsEmpty(true);
        onSignatureChangeRef.current?.(null);
      },
      isEmpty: () => strokeDataRef.current.length === 0,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;

      if (!canvas || !container) {
        return;
      }

      const pad = new SignaturePadLib(canvas, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        penColor: 'rgb(0, 0, 0)',
        minWidth: 2.5,
        maxWidth: 5.5,
        throttle: 0,
      });
      padRef.current = pad;

      const resizeCanvas = () => {
        if (isDrawingRef.current) {
          return;
        }

        const width = Math.floor(container.clientWidth);
        const height = Math.max(Math.round(width * 0.4), 180);

        if (width <= 0) {
          return;
        }

        // Ignore tiny mobile address-bar resizes that clear strokes.
        const prev = canvasSizeRef.current;
        if (
          canvas.width > 0 &&
          Math.abs(prev.width - width) < 8 &&
          Math.abs(prev.height - height) < 8
        ) {
          return;
        }

        const data = strokeDataRef.current.length > 0 ? strokeDataRef.current : null;

        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.getContext('2d')?.setTransform(1, 0, 0, 1, 0, 0);
        canvasSizeRef.current = { width, height };

        pad.clear();

        if (data && data.length > 0) {
          pad.fromData(data);
          const exported = exportStrokesToPng(data, width, height);
          if (exported) {
            lastGoodDataUrlRef.current = exported;
          }
        }
      };

      resizeCanvas();

      const onBegin = () => {
        isDrawingRef.current = true;
      };
      const onEnd = () => {
        isDrawingRef.current = false;
        syncExport();
      };

      pad.addEventListener('beginStroke', onBegin);
      pad.addEventListener('endStroke', onEnd);

      // Size once more after layout, then stop observing to avoid mobile wipeouts.
      const layoutTimer = setTimeout(resizeCanvas, 100);

      const onOrientation = () => {
        setTimeout(resizeCanvas, 300);
      };
      window.addEventListener('orientationchange', onOrientation);

      return () => {
        clearTimeout(layoutTimer);
        pad.removeEventListener('beginStroke', onBegin);
        pad.removeEventListener('endStroke', onEnd);
        pad.off();
        window.removeEventListener('orientationchange', onOrientation);
        padRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            onClick={() => {
              padRef.current?.clear();
              strokeDataRef.current = [];
              lastGoodDataUrlRef.current = null;
              setIsEmpty(true);
              onSignatureChangeRef.current?.(null);
            }}
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
);

export default SignaturePad;
