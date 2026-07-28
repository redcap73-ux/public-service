import { PDFDocument } from 'pdf-lib';

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

/** Crop nearly-white margins so the ink sits flush when placed. */
async function trimSignaturePng(signatureDataUrl: string): Promise<Uint8Array> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('서명 이미지를 불러오지 못했습니다.'));
    img.src = signatureDataUrl;
  });

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
    const fallback = await fetch(signatureDataUrl).then((response) => response.arrayBuffer());
    return new Uint8Array(fallback);
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

  const trimmedDataUrl = trimmed.toDataURL('image/png');
  const trimmedBytes = await fetch(trimmedDataUrl).then((response) => response.arrayBuffer());
  return new Uint8Array(trimmedBytes);
}

async function embedSignatureOnLastPage(
  pdfBytes: ArrayBuffer,
  signatureDataUrl: string
) {
  const sourceDoc = await PDFDocument.load(pdfBytes);

  // Rebuild onto fresh pages so leftover CTM from the source PDF cannot flip/shift coordinates.
  const pdfDoc = await PDFDocument.create();
  const embeddedPages = await pdfDoc.embedPdf(sourceDoc);

  for (const embeddedPage of embeddedPages) {
    const page = pdfDoc.addPage([embeddedPage.width, embeddedPage.height]);
    page.drawPage(embeddedPage, {
      x: 0,
      y: 0,
      width: embeddedPage.width,
      height: embeddedPage.height,
    });
  }

  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];

  if (!lastPage) {
    throw new Error('PDF 페이지를 찾을 수 없습니다.');
  }

  const pngBytes = await trimSignaturePng(signatureDataUrl);
  const signatureImage = await pdfDoc.embedPng(pngBytes);

  const { width: pageWidth } = lastPage.getSize();
  const maxSignatureWidth = Math.min(pageWidth * 0.3, 180);
  const scale = maxSignatureWidth / signatureImage.width;
  const signatureWidth = signatureImage.width * scale;
  const signatureHeight = signatureImage.height * scale;

  // Fresh page coordinates: x=0 is left, y=0 is bottom.
  const leftMargin = 48;
  const bottomMargin = 40;

  lastPage.drawImage(signatureImage, {
    x: leftMargin,
    y: bottomMargin,
    width: signatureWidth,
    height: signatureHeight,
  });

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
