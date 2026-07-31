export type PdfJsViewport = {
  width: number;
  height: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
};

export type PdfJsTextItem = {
  str?: string;
  transform: number[];
  width: number;
  height: number;
};

export type PdfJsPage = {
  getViewport: (params: { scale: number }) => PdfJsViewport;
  getTextContent: () => Promise<{ items: Array<PdfJsTextItem | { type?: string }> }>;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfJsViewport;
    annotationMode?: number;
  }) => { promise: Promise<void> };
};

export type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer } | { url: string; withCredentials?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<PdfJsPage>;
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

export async function ensurePdfJs(): Promise<PdfJsLib> {
  const existing = window.pdfjsLib as PdfJsLib | undefined;

  if (existing) {
    return existing;
  }

  await loadScript(`${PDFJS_CDN}/pdf.min.js`);

  const pdfjsLib = window.pdfjsLib as PdfJsLib | undefined;

  if (!pdfjsLib) {
    throw new Error('pdf.js를 초기화하지 못했습니다.');
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return pdfjsLib;
}
