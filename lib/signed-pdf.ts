import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { fillAcroFormIdentity, type IdentityFormValues } from '@/lib/acroform-fill';
import {
  ensurePdfJs,
  type PdfJsPage,
  type PdfJsTextItem,
  type PdfJsViewport,
} from '@/lib/pdfjs';

const SIGNATURE_FIELD_ALIASES = [
  'signature',
  'sign',
  '서명',
  'singature',
  'signimage',
  'sign_image',
];

function normalizeFieldKey(name: string) {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findSignatureFieldName(fieldNames: string[]) {
  const aliases = SIGNATURE_FIELD_ALIASES.map(normalizeFieldKey);
  return (
    fieldNames.find((fieldName) => aliases.includes(normalizeFieldKey(fieldName))) ?? null
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getFileNameFromPath(filePath: string, index: number) {
  const rawName = filePath.split('/').pop() || `document-${index + 1}.pdf`;
  const baseName = rawName.toLowerCase().endsWith('.pdf')
    ? rawName.slice(0, -4)
    : rawName;

  return `${baseName}-signed.pdf`;
}

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });

  // iOS Safari often ignores <a download>; open the blob URL instead.
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIos) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

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

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('서명 이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
}

/** Crop margins and keep only ink on a transparent background. */
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
  const whiteThreshold = 245;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      const isInk = a > 10 && (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold);

      if (isInk) {
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

  trimmedCtx.clearRect(0, 0, cropWidth, cropHeight);
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

  const trimmedData = trimmedCtx.getImageData(0, 0, cropWidth, cropHeight);
  const pixels = trimmedData.data;

  // Make near-white transparent, keep ink fully opaque for clarity.
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];

    if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
      pixels[index + 3] = 0;
    } else if (pixels[index + 3] > 0) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 255;
    }
  }

  trimmedCtx.putImageData(trimmedData, 0, 0);

  // Thicken strokes by 1px dilation so the stamp looks bolder on the PDF.
  const bold = document.createElement('canvas');
  bold.width = cropWidth;
  bold.height = cropHeight;
  const boldCtx = bold.getContext('2d');

  if (!boldCtx) {
    return loadImage(trimmed.toDataURL('image/png'));
  }

  boldCtx.clearRect(0, 0, cropWidth, cropHeight);

  for (const [ox, oy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ] as const) {
    boldCtx.drawImage(trimmed, ox, oy);
  }

  return loadImage(bold.toDataURL('image/png'));
}

/**
 * Prefer the signature field label "(서명 또는 인)" / "서명" over unrelated body text.
 */
async function findSignatureAnchor(page: PdfJsPage, viewport: PdfJsViewport) {
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((item): item is PdfJsTextItem => {
    return !!item && typeof (item as PdfJsTextItem).str === 'string' && Array.isArray((item as PdfJsTextItem).transform);
  });

  const preferred =
    items.find((item) => (item.str || '').includes('(서명 또는 인)')) ||
    items.find((item) => (item.str || '').trim() === '서명') ||
    [...items].reverse().find((item) => {
      const text = (item.str || '').trim();
      return text.includes('서명') && text.length <= 20;
    });

  if (!preferred) {
    return null;
  }

  const pdfX = preferred.transform[4] ?? 0;
  const pdfY = preferred.transform[5] ?? 0;
  const [viewportX, viewportY] = viewport.convertToViewportPoint(pdfX, pdfY);
  const scaleRatio = viewport.width / page.getViewport({ scale: 1 }).width;
  const fontHeight = Math.abs(preferred.transform[3] || preferred.height || 12) * scaleRatio;
  const label = preferred.str || '서명';
  const fullWidth = preferred.width * scaleRatio;

  // If label is "(서명 또는 인)", target the "서명" portion inside it.
  let targetX = viewportX;
  let targetWidth = fullWidth;

  if (label.includes('(서명 또는 인)')) {
    const prefix = label.slice(0, Math.max(0, label.indexOf('서명')));
    const prefixRatio = label.length > 0 ? prefix.length / label.length : 0;
    const wordRatio = 2 / Math.max(label.length, 1);
    targetX = viewportX + fullWidth * prefixRatio;
    targetWidth = Math.max(fullWidth * wordRatio, fontHeight * 2);
  } else if (label.includes('서명')) {
    const index = label.indexOf('서명');
    const prefixRatio = label.length > 0 ? index / label.length : 0;
    const wordRatio = 2 / Math.max(label.length, 1);
    targetX = viewportX + fullWidth * prefixRatio;
    targetWidth = Math.max(fullWidth * wordRatio, fontHeight * 2);
  }

  return {
    x: targetX,
    y: viewportY,
    width: targetWidth,
    fontHeight,
    label,
  };
}

function drawSignatureNearAnchor(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  signatureImage: HTMLImageElement,
  anchor: { x: number; y: number; width: number; fontHeight: number } | null
) {
  let signatureWidth: number;
  let signatureHeight: number;

  if (anchor) {
    // Fit around the "서명" text box; keep a readable minimum size on mobile PDFs.
    signatureWidth = Math.max(anchor.width * 2.8, anchor.fontHeight * 10, canvas.width * 0.2);
    signatureWidth = Math.min(signatureWidth, canvas.width * 0.42);
    const scale = signatureWidth / signatureImage.width;
    signatureHeight = signatureImage.height * scale;
  } else {
    signatureWidth = Math.min(canvas.width * 0.32, 420);
    const scale = signatureWidth / signatureImage.width;
    signatureHeight = signatureImage.height * scale;
  }

  let x: number;
  let y: number;

  if (anchor) {
    // Center the signature on the "서명" characters.
    x = anchor.x + anchor.width / 2 - signatureWidth / 2;
    y = anchor.y - signatureHeight / 2 - anchor.fontHeight * 0.2;

    const margin = 8;
    x = Math.min(Math.max(margin, x), canvas.width - signatureWidth - margin);
    y = Math.min(Math.max(margin, y), canvas.height - signatureHeight - margin);
  } else {
    const rightMargin = Math.round(canvas.width * 0.06);
    const bottomMargin = Math.round(canvas.height * 0.04);
    x = canvas.width - rightMargin - signatureWidth;
    y = canvas.height - bottomMargin - signatureHeight;
  }

  context.save();
  context.globalAlpha = 1;
  context.drawImage(signatureImage, x, y, signatureWidth, signatureHeight);
  context.restore();
}

/**
 * Rasterize PDF pages, stamp signature near the "서명" label when found,
 * then rebuild a downloadable PDF.
 */
async function embedSignatureOnLastPage(
  pdfBytes: ArrayBuffer,
  signatureDataUrl: string
) {
  const pdfjsLib = await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  const signatureImage = await trimSignatureToImage(signatureDataUrl);
  const pdfDoc = await PDFDocument.create();
  const renderScale = 2;

  const renderedPages: Array<{
    canvas: HTMLCanvasElement;
    anchor: Awaited<ReturnType<typeof findSignatureAnchor>>;
  }> = [];

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
    await page.render({ canvasContext: context, viewport, annotationMode: 0 }).promise;

    const anchor = await findSignatureAnchor(page, viewport);
    renderedPages.push({ canvas, anchor });
  }

  const hasAnchor = renderedPages.some((page) => !!page.anchor);

  for (let index = 0; index < renderedPages.length; index += 1) {
    const { canvas, anchor } = renderedPages[index];
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('PDF 페이지를 렌더링하지 못했습니다.');
    }

    if (anchor) {
      drawSignatureNearAnchor(context, canvas, signatureImage, anchor);
    } else if (!hasAnchor && index === renderedPages.length - 1) {
      drawSignatureNearAnchor(context, canvas, signatureImage, null);
    }

    const pageImageBytes = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
    const embeddedImage = await pdfDoc.embedJpg(pageImageBytes);
    const pdfPage = pdfDoc.addPage([
      embeddedImage.width / renderScale,
      embeddedImage.height / renderScale,
    ]);

    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
    });
  }

  return pdfDoc.save();
}

/**
 * If the PDF has an AcroForm signature-like field, draw the signature image
 * into that widget rect (vector, no full-page rasterization).
 */
async function stampSignatureOnAcroFormField(
  pdfBytes: ArrayBuffer,
  signatureDataUrl: string
): Promise<Uint8Array | null> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  if (fields.length === 0) {
    return null;
  }

  const signatureFieldName = findSignatureFieldName(fields.map((field) => field.getName()));

  if (!signatureFieldName) {
    return null;
  }

  const field = fields.find((item) => item.getName() === signatureFieldName);
  if (!field) {
    return null;
  }

  const widgets = field.acroField.getWidgets();
  if (widgets.length === 0) {
    return null;
  }

  const trimmedSignature = await trimSignatureToImage(signatureDataUrl);
  const signaturePng = dataUrlToBytes(
    (() => {
      const canvas = document.createElement('canvas');
      canvas.width = trimmedSignature.width;
      canvas.height = trimmedSignature.height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('서명 이미지를 준비하지 못했습니다.');
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(trimmedSignature, 0, 0);
      return canvas.toDataURL('image/png');
    })()
  );
  const embeddedImage = await pdfDoc.embedPng(signaturePng);

  for (const widget of widgets) {
    const pageRef = widget.dict.get(PDFName.of('P'));
    const pages = pdfDoc.getPages();
    let page = pages[0];

    if (pageRef instanceof PDFRef) {
      page = pages.find((candidate) => candidate.ref === pageRef) ?? page;
    }

    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const padding = 2;
    const maxWidth = Math.max(rect.width - padding * 2, 10);
    const maxHeight = Math.max(rect.height - padding * 2, 10);
    const scale = Math.min(maxWidth / embeddedImage.width, maxHeight / embeddedImage.height);
    const drawWidth = embeddedImage.width * scale;
    const drawHeight = embeddedImage.height * scale;

    page.drawImage(embeddedImage, {
      x: rect.x + (rect.width - drawWidth) / 2,
      y: rect.y + (rect.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  try {
    form.removeField(field);
  } catch {
    // Signature fields sometimes cannot be removed; stamped image is still visible.
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
  identity?: IdentityFormValues | null;
  onProgress?: (message: string) => void;
}) {
  const { documents, signatureDataUrl, identity, onProgress } = options;

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

    let pdfBytes = await response.arrayBuffer();

    if (identity) {
      onProgress?.(`(${index + 1}/${documents.length}) ${label} 본인정보 반영 중...`);
      const filled = await fillAcroFormIdentity(pdfBytes, identity);
      if (filled) {
        pdfBytes = toArrayBuffer(filled.bytes);
      }
    }

    onProgress?.(`(${index + 1}/${documents.length}) ${label} 서명 넣는 중...`);

    const stamped = await stampSignatureOnAcroFormField(pdfBytes, signatureDataUrl);
    const signedBytes =
      stamped ?? (await embedSignatureOnLastPage(pdfBytes, signatureDataUrl));
    const fileName = getFileNameFromPath(document.filePath, index);

    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    triggerDownload(signedBytes, fileName);
  }

  onProgress?.(`서명된 PDF ${documents.length}개 다운로드를 완료했습니다.`);
}
