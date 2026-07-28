'use client';

import { useEffect, useRef, useState } from 'react';

type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string; withCredentials?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`스크립트 로드 실패: ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePdfJs() {
  if (window.pdfjsLib) {
    return window.pdfjsLib;
  }

  await loadScript(`${PDFJS_CDN}/pdf.min.js`);

  const pdfjsLib = window.pdfjsLib;

  if (!pdfjsLib) {
    throw new Error('pdf.js를 초기화하지 못했습니다.');
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return pdfjsLib;
}

type PdfPreviewProps = {
  fileUrl: string;
};

export default function PdfPreview({ fileUrl }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderPdf() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      setLoading(true);
      setLoadError(null);
      container.replaceChildren();

      try {
        const pdfjsLib = await ensurePdfJs();
        const pdf = await pdfjsLib.getDocument({ url: fileUrl }).promise;

        if (cancelled) {
          return;
        }

        const width = Math.max(container.clientWidth, 280);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = width / unscaledViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');

          if (!context) {
            throw new Error('캔버스를 초기화하지 못했습니다.');
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.width = '100%';
          canvas.style.height = 'auto';

          container.appendChild(canvas);
          await page.render({ canvasContext: context, viewport }).promise;

          if (cancelled) {
            return;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : '알 수 없는 오류');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  return (
    <div
      style={{
        width: '100%',
        maxHeight: '70vh',
        overflowX: 'hidden',
        overflowY: 'auto',
        backgroundColor: '#fff',
      }}
    >
      {loading && <p style={{ padding: '1rem', margin: 0 }}>PDF를 불러오는 중...</p>}
      {loadError && (
        <div style={{ padding: '1rem', color: '#842029' }}>
          PDF 미리보기를 불러오지 못했습니다: {loadError}
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}
