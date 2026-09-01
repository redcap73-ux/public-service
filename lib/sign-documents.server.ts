import 'server-only';

import { createHash } from 'crypto';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import type { IdentityFormValues } from '@/lib/acroform-fill';
import {
  createCanvas,
  ensureServerCanvasShim,
  loadImage,
} from '@/lib/canvas-shim.server';
import { getObjectFromNcp } from '@/lib/ncp-storage.server';
import { mergePdfByteList } from '@/lib/pdf-merge';

const SIGNATURE_FIELD_ALIASES = [
  'signature',
  'sign',
  '서명',
  'singature',
  'signimage',
  'sign_image',
];

export type ServerSignDocumentInput = {
  filePath: string;
  identity?: IdentityFormValues | null;
  index?: number;
};

function normalizeFieldKey(name: string) {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function fieldStartsWithPrefix(fieldName: string, prefix: string) {
  const name = fieldName.trim().toLowerCase();
  const wanted = prefix.trim().toLowerCase();
  if (!wanted) return false;
  if (name === wanted) return true;
  if (!name.startsWith(wanted) || name.length === wanted.length) return false;
  return /[^a-z]/.test(name.charAt(wanted.length));
}

/** signature_system / signature_system_1 / SignatureSystem2 등 */
function fieldStartsWithSystemPrefix(fieldName: string, prefix: string) {
  if (fieldStartsWithPrefix(fieldName, prefix)) return true;
  const normalizedName = normalizeFieldKey(fieldName);
  const normalizedPrefix = normalizeFieldKey(prefix);
  if (!normalizedPrefix) return false;
  if (normalizedName === normalizedPrefix) return true;
  if (!normalizedName.startsWith(normalizedPrefix)) return false;
  return /[0-9]/.test(normalizedName.charAt(normalizedPrefix.length));
}

function findSignatureFieldNames(fieldNames: string[]) {
  const aliases = new Set(SIGNATURE_FIELD_ALIASES.map(normalizeFieldKey));
  const matched = new Set<string>();

  for (const fieldName of fieldNames) {
    // signature_system* 우선 (name_system과 동일한 접두어 규칙)
    if (fieldStartsWithSystemPrefix(fieldName, 'signature_system')) {
      matched.add(fieldName);
      continue;
    }
    if (fieldStartsWithPrefix(fieldName, 'signature')) {
      matched.add(fieldName);
      continue;
    }
    if (aliases.has(normalizeFieldKey(fieldName))) {
      matched.add(fieldName);
    }
  }

  return [...matched];
}

function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('서명 이미지 형식이 올바르지 않습니다.');
  }
  return Buffer.from(dataUrl.slice(commaIndex + 1), 'base64');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function sha256HexFromBuffer(bytes: Uint8Array) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** 서명 PNG 여백 제거 + 스트로크 강조 */
async function prepareSignaturePng(signatureDataUrl: string) {
  const image = await loadImage(signatureDataUrl);
  const source = createCanvas(image.width, image.height);
  const sourceCtx = source.getContext('2d');
  sourceCtx.clearRect(0, 0, source.width, image.height);
  sourceCtx.drawImage(image, 0, 0);

  const { data, width, height } = sourceCtx.getImageData(
    0,
    0,
    image.width,
    image.height
  );
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
      const isInk =
        a > 10 && (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold);
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

  const trimmed = createCanvas(cropWidth, cropHeight);
  const trimmedCtx = trimmed.getContext('2d');
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

  const bold = createCanvas(cropWidth, cropHeight);
  const boldCtx = bold.getContext('2d');
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

  return bold.toBuffer('image/png');
}

async function stampSignatureOnAcroFormField(
  pdfBytes: ArrayBuffer,
  signaturePng: Buffer
): Promise<Uint8Array | null> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  if (!fields.length) return null;

  const signatureFieldNames = findSignatureFieldNames(
    fields.map((field) => field.getName())
  );
  if (!signatureFieldNames.length) return null;

  const targetFields = signatureFieldNames
    .map((name) => fields.find((item) => item.getName() === name))
    .filter((field): field is NonNullable<typeof field> => Boolean(field));

  if (!targetFields.length) return null;
  if (!targetFields.some((field) => field.acroField.getWidgets().length > 0)) {
    return null;
  }

  const embeddedImage = await pdfDoc.embedPng(signaturePng);
  const pages = pdfDoc.getPages();
  let stampedCount = 0;

  for (const field of targetFields) {
    const widgets = field.acroField.getWidgets();
    for (const widget of widgets) {
      const pageRef = widget.dict.get(PDFName.of('P'));
      let page = pages[0];
      if (pageRef instanceof PDFRef) {
        page = pages.find((candidate) => candidate.ref === pageRef) ?? page;
      }
      if (!page) continue;

      const rect = widget.getRectangle();
      // 여백을 최소화하고 잉크(필기)를 필드 크기에 맞게 최대 확대
      const padding = 1;
      const maxWidth = Math.max(rect.width - padding * 2, 4);
      const maxHeight = Math.max(rect.height - padding * 2, 4);
      const scale = Math.min(
        maxWidth / Math.max(embeddedImage.width, 1),
        maxHeight / Math.max(embeddedImage.height, 1)
      );
      const drawWidth = embeddedImage.width * scale;
      const drawHeight = embeddedImage.height * scale;

      page.drawImage(embeddedImage, {
        x: rect.x + (rect.width - drawWidth) / 2,
        y: rect.y + (rect.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
      stampedCount += 1;
    }

    try {
      form.removeField(field);
    } catch {
      // ignore
    }
  }

  if (!stampedCount) return null;
  return pdfDoc.save();
}

/** AcroForm 서명 필드가 없을 때 마지막 페이지 하단에 서명 삽입 */
async function embedSignatureOnLastPage(
  pdfBytes: ArrayBuffer,
  signaturePng: Buffer
) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  if (!page) {
    throw new Error('PDF 페이지가 없습니다.');
  }

  const embeddedImage = await pdfDoc.embedPng(signaturePng);
  const maxWidth = Math.min(page.getWidth() * 0.35, 180);
  const maxHeight = Math.min(page.getHeight() * 0.12, 64);
  const scale = Math.min(
    maxWidth / embeddedImage.width,
    maxHeight / embeddedImage.height
  );
  const drawWidth = embeddedImage.width * scale;
  const drawHeight = embeddedImage.height * scale;

  page.drawImage(embeddedImage, {
    x: page.getWidth() - drawWidth - 36,
    y: 36,
    width: drawWidth,
    height: drawHeight,
  });

  return pdfDoc.save();
}

export async function generateSignedPdfBytesOnServer(options: {
  filePath: string;
  signatureDataUrl: string;
  identity?: IdentityFormValues | null;
}) {
  const { filePath, signatureDataUrl, identity } = options;

  if (!signatureDataUrl?.startsWith('data:image/')) {
    throw new Error('서명이 없습니다. 먼저 서명해 주세요.');
  }
  if (!filePath.trim()) {
    throw new Error('PDF file_path가 없습니다.');
  }

  ensureServerCanvasShim();
  const { fillAcroFormIdentity } = await import('@/lib/acroform-fill');

  const file = await getObjectFromNcp(filePath);
  if (file.encrypted) {
    throw new Error(
      '암호화된 템플릿 PDF는 이 서버에서 열 수 없습니다. 평문 템플릿 경로를 확인해 주세요.'
    );
  }

  let pdfBytes: ArrayBuffer = toArrayBuffer(file.body);

  if (identity) {
    const filled = await fillAcroFormIdentity(pdfBytes, identity);
    if (filled) {
      pdfBytes = toArrayBuffer(filled.bytes);
    }
  }

  const signaturePng = await prepareSignaturePng(signatureDataUrl);
  const stamped = await stampSignatureOnAcroFormField(pdfBytes, signaturePng);
  const signedBytes =
    stamped ?? (await embedSignatureOnLastPage(pdfBytes, signaturePng));

  return {
    bytes: signedBytes,
    signedHash: sha256HexFromBuffer(signedBytes),
  };
}

export async function buildSignedMergedPdfOnServer(options: {
  signatureDataUrl: string;
  documents: ServerSignDocumentInput[];
}) {
  const { signatureDataUrl, documents } = options;

  if (!documents.length) {
    throw new Error('서명할 동의 문서가 없습니다.');
  }

  // data URL 유효성만 미리 확인 (용량은 route에서 제한)
  dataUrlToBytes(signatureDataUrl);

  const signedParts: Uint8Array[] = [];
  const results: Array<{ index: number; filePath: string; signedHash: string }> =
    [];

  for (const doc of documents) {
    const { bytes, signedHash } = await generateSignedPdfBytesOnServer({
      filePath: doc.filePath,
      signatureDataUrl,
      identity: doc.identity ?? null,
    });
    signedParts.push(bytes);
    results.push({
      index: typeof doc.index === 'number' ? doc.index : results.length,
      filePath: doc.filePath,
      signedHash,
    });
  }

  const mergedBytes =
    signedParts.length === 1
      ? signedParts[0]
      : await mergePdfByteList(signedParts);

  return {
    mergedBytes,
    mergedHash: sha256HexFromBuffer(mergedBytes),
    documents: results,
  };
}
