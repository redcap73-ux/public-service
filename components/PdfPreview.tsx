'use client';

import { useEffect, useRef, useState } from 'react';
import { ensurePdfJs } from '@/lib/pdfjs';

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
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = (width / unscaledViewport.width) * pixelRatio;
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
          // Disable annotation/widget rendering so empty AcroForm signature
          // fields don't show viewer placeholders like "여기에 서명하세요".
          await page.render({
            canvasContext: context,
            viewport,
            annotationMode: 0,
          }).promise;

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
