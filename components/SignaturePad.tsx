'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import SignaturePadLib from 'signature_pad';

export type SignaturePadHandle = {
  getSignatureDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
};

type SignaturePadProps = {
  onSignatureChange?: (dataUrl: string | null) => void;
};

function canvasHasInk(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context || canvas.width === 0 || canvas.height === 0) {
    return false;
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const threshold = 245;
  const step = Math.max(1, Math.floor(data.length / 4 / 40000));

  for (let pixel = 0; pixel < data.length / 4; pixel += step) {
    const index = pixel * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];

    if (a > 20 && (r < threshold || g < threshold || b < threshold)) {
      return true;
    }
  }

  return false;
}

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ onSignatureChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onSignatureChangeRef = useRef(onSignatureChange);
    const lastGoodDataUrlRef = useRef<string | null>(null);
    const isDrawingRef = useRef(false);
    const [isEmpty, setIsEmpty] = useState(true);

    useEffect(() => {
      onSignatureChangeRef.current = onSignatureChange;
    }, [onSignatureChange]);

    const captureFromPad = () => {
      const pad = padRef.current;
      const canvas = canvasRef.current;

      if (!pad || !canvas || pad.isEmpty()) {
        return lastGoodDataUrlRef.current;
      }

      const points = pad.toData();
      pad.clear();
      pad.fromData(points);

      if (!canvasHasInk(canvas)) {
        return lastGoodDataUrlRef.current;
      }

      const dataUrl = pad.toDataURL('image/png');

      if (dataUrl.startsWith('data:image/png') && dataUrl.length > 500) {
        lastGoodDataUrlRef.current = dataUrl;
        return dataUrl;
      }

      return lastGoodDataUrlRef.current;
    };

    useImperativeHandle(ref, () => ({
      getSignatureDataUrl: () => {
        const captured = captureFromPad();

        if (captured) {
          setIsEmpty(false);
          onSignatureChangeRef.current?.(captured);
          return captured;
        }

        return null;
      },
      clear: () => {
        padRef.current?.clear();
        lastGoodDataUrlRef.current = null;
        setIsEmpty(true);
        onSignatureChangeRef.current?.(null);
      },
      isEmpty: () => !(lastGoodDataUrlRef.current || (padRef.current && !padRef.current.isEmpty())),
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;

      if (!canvas || !container) {
        return;
      }

      // 1:1 CSS-to-canvas pixels avoids blank mobile exports from DPR scaling.
      const pad = new SignaturePadLib(canvas, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        penColor: 'rgb(0, 0, 0)',
        minWidth: 2.5,
        maxWidth: 5.5,
        throttle: 0,
      });
      padRef.current = pad;

      const publish = (dataUrl: string | null) => {
        setIsEmpty(!dataUrl);
        onSignatureChangeRef.current?.(dataUrl);
      };

      const notifyChange = () => {
        publish(captureFromPad());
      };

      const resizeCanvas = () => {
        if (isDrawingRef.current) {
          return;
        }

        const width = Math.floor(container.clientWidth);
        const height = Math.max(Math.round(width * 0.4), 180);

        if (width <= 0 || (canvas.width === width && canvas.height === height)) {
          return;
        }

        const data = pad.isEmpty() ? null : pad.toData();

        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        canvas.getContext('2d')?.setTransform(1, 0, 0, 1, 0, 0);
        pad.clear();

        if (data && data.length > 0) {
          pad.fromData(data);

          if (canvasHasInk(canvas)) {
            lastGoodDataUrlRef.current = pad.toDataURL('image/png');
          }
        }
      };

      resizeCanvas();

      const onBegin = () => {
        isDrawingRef.current = true;
      };
      const onEnd = () => {
        isDrawingRef.current = false;
        notifyChange();
      };

      pad.addEventListener('beginStroke', onBegin);
      pad.addEventListener('endStroke', onEnd);

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleResize = () => {
        if (resizeTimer) {
          clearTimeout(resizeTimer);
        }

        resizeTimer = setTimeout(resizeCanvas, 250);
      };

      const observer = new ResizeObserver(scheduleResize);
      observer.observe(container);
      window.addEventListener('orientationchange', scheduleResize);

      return () => {
        if (resizeTimer) {
          clearTimeout(resizeTimer);
        }

        pad.removeEventListener('beginStroke', onBegin);
        pad.removeEventListener('endStroke', onEnd);
        pad.off();
        observer.disconnect();
        window.removeEventListener('orientationchange', scheduleResize);
        padRef.current = null;
      };
      // captureFromPad reads refs only
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
