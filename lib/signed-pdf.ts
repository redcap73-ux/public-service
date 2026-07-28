import { PDFDocument } from 'pdf-lib';

type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer } | { url: string }) => {
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

function getFileNameFromPath(filePath: string, index: number) {
  const rawName = filePath.split('/').pop() || `document-${index + 1}.pdf`;
  const baseName = rawName.toLowerCase().endsWith('.pdf')
    ? rawName.slice(0, -4)
    : rawName;

  return `${baseName}-signed.pdf`;
}

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex < 0) {
    throw new Error('서명 이미지 형식이 올바르지 않습니다.');
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

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

async function ensurePdfJs(): Promise<PdfJsLib> {
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

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('서명 이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
}

/** Crop white margins so ink is flush to the image edges. */
async function trimSignatureToImage(signatureDataUrl: string) {
  const image = await loadImage(signatureDataUrl);
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceCtx = source.getContext('2d');

  if (!sourceCtx) {
    throw new Error('서명 이미지를 처리하지 못했습니다.');
  }

  sourceCtx.drawImage(image, 0, 0);
  const { data, width, height } = sourceCtx.getImageData(0, 0, source.width, source.height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const threshold = 250;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      if (a > 10 && (r < threshold || g < threshold || b < threshold)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('서명 내용이 비어 있습니다. 다시 서명한 뒤 저장해 주세요.');
  }

  const padding = 4;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);

  const trimmed = document.createElement('canvas');
  trimmed.width = cropWidth;
  trimmed.height = cropHeight;
  const trimmedCtx = trimmed.getContext('2d');

  if (!trimmedCtx) {
    throw new Error('서명 이미지를 자르지 못했습니다.');
  }

  trimmedCtx.fillStyle = '#ffffff';
  trimmedCtx.fillRect(0, 0, cropWidth, cropHeight);
  trimmedCtx.drawImage(
    source,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  return loadImage(trimmed.toDataURL('image/png'));
}

/**
 * Rasterize PDF pages, stamp signature on the visual bottom-LEFT of the last page,
 * then rebuild a downloadable PDF. Pixel x=0 is always the visual left edge.
 */
async function embedSignatureOnLastPage(
  pdfBytes: ArrayBuffer,
  signatureDataUrl: string
) {
  const pdfjsLib = await ensurePdfJs();
  // pdf.js may detach the buffer; copy first.
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  const signatureImage = await trimSignatureToImage(signatureDataUrl);
  const pdfDoc = await PDFDocument.create();
  const renderScale = 2;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('PDF 페이지를 렌더링하지 못했습니다.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    if (pageNumber === pdf.numPages) {
      const maxSignatureWidth = Math.min(canvas.width * 0.28, 360);
      const scale = maxSignatureWidth / signatureImage.width;
      const signatureWidth = signatureImage.width * scale;
      const signatureHeight = signatureImage.height * scale;
      // Canvas coordinates: (0,0) = top-left. Place at bottom-RIGHT.
      const rightMargin = Math.round(canvas.width * 0.06);
      const bottomMargin = Math.round(canvas.height * 0.04);
      const x = canvas.width - rightMargin - signatureWidth;
      const y = canvas.height - bottomMargin - signatureHeight;

      context.drawImage(signatureImage, x, y, signatureWidth, signatureHeight);
    }

    const pageImageBytes = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
    const embeddedImage = await pdfDoc.embedJpg(pageImageBytes);
    const pdfPage = pdfDoc.addPage([embeddedImage.width / renderScale, embeddedImage.height / renderScale]);

    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
    });
  }

  return pdfDoc.save();
}

export type SignedDocumentInput = {
  filePath: string;
  fileUrl: string;
  label?: string;
};

export async function downloadSignedDocuments(options: {
  documents: SignedDocumentInput[];
  signatureDataUrl: string;
  onProgress?: (message: string) => void;
}) {
  const { documents, signatureDataUrl, onProgress } = options;

  if (!signatureDataUrl) {
    throw new Error('서명이 없습니다. 먼저 서명해 주세요.');
  }

  if (documents.length === 0) {
    throw new Error('저장할 동의 문서가 없습니다.');
  }

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const label = document.label || `문서 ${index + 1}`;

    onProgress?.(`(${index + 1}/${documents.length}) ${label} 서명본 생성 중...`);

    const response = await fetch(document.fileUrl, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`${label} PDF를 가져오지 못했습니다. (${response.status})`);
    }

    const pdfBytes = await response.arrayBuffer();
    const signedBytes = await embedSignatureOnLastPage(pdfBytes, signatureDataUrl);
    const fileName = getFileNameFromPath(document.filePath, index);

    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    triggerDownload(signedBytes, fileName);
  }

  onProgress?.(`서명된 PDF ${documents.length}개 다운로드를 완료했습니다.`);
}
