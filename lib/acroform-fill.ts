import { PDFDocument, PDFName, PDFRef, type PDFPage } from 'pdf-lib';

export type IdentityFormValues = {
  name?: string;
  phoneNumber?: string;
  birthDate?: string;
  ci?: string;
  txId?: string;
  clientIp?: string;
  userAgent?: string;
};

export type FillableDocumentInput = {
  filePath: string;
  fileUrl: string;
  label?: string;
};

const NAME_ALIASES = ['name', '성명', '이름', 'username', 'customername', 'user_name'];
const PHONE_ALIASES = [
  'phone',
  'phonenumber',
  'phone_number',
  'tel',
  'mobile',
  'hp',
  'cellphone',
  '전화번호',
  '휴대폰',
  '연락처',
];
const BIRTHDAY_ALIASES = [
  'birthday',
  'birthdate',
  'birth_date',
  'birth',
  'dob',
  '생년월일',
  '생일',
];
const DESC_ALIASES = ['desc', 'description', 'audit', 'audittrail', '증적', '비고', 'remark'];

const KOREAN_FONT_URL = '/fonts/NotoSansKR-Regular.otf';

function normalizeFieldKey(name: string) {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findFieldName(fieldNames: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeFieldKey);

  return (
    fieldNames.find((fieldName) =>
      normalizedAliases.includes(normalizeFieldKey(fieldName))
    ) ?? null
  );
}

function formatBirthDate(value: string) {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  return value;
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return value;
}

function maskCi(value: string) {
  const ci = value.trim();

  if (ci.length <= 16) {
    return ci;
  }

  return `${ci.slice(0, 8)}...${ci.slice(-6)}`;
}

function shortenUserAgent(value: string) {
  // "PC / Windows / Chrome" -> "PC / Chrome"
  const parts = value.split('/').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return `${parts[0]} / ${parts[parts.length - 1]}`;
  }

  return value;
}

type AuditTrailRow = {
  left: string;
  right?: string;
};

export function buildAuditTrailRows(values: IdentityFormValues): AuditTrailRow[] {
  const txId = values.txId?.trim() || '-';
  const ci = values.ci?.trim() ? maskCi(values.ci) : '-';
  const clientIp = values.clientIp?.trim() || '-';
  const userAgent = values.userAgent?.trim()
    ? shortenUserAgent(values.userAgent)
    : '-';

  return [
    { left: '[전자서명 및 본인확인 완료 증적 (Audit Trail)]' },
    { left: '인증수단: 휴대폰 본인확인 (포트원)', right: `인증 거래ID: ${txId}` },
    { left: `CI: ${ci}`, right: `IP: ${clientIp} (${userAgent})` },
  ];
}

export function buildAuditTrailText(values: IdentityFormValues) {
  return buildAuditTrailRows(values)
    .map((row) => (row.right ? `${row.left}  |  ${row.right}` : row.left))
    .join('\n');
}

const KOREAN_FONT_FAMILY = 'NotoSansKREmbed';
let koreanWebFontReady: Promise<void> | null = null;

async function ensureKoreanWebFont() {
  if (typeof document === 'undefined') {
    throw new Error('한글 캔버스 렌더링은 브라우저에서만 가능합니다.');
  }

  if (!koreanWebFontReady) {
    koreanWebFontReady = (async () => {
      const fontFace = new FontFace(KOREAN_FONT_FAMILY, `url(${KOREAN_FONT_URL})`);
      const loaded = await fontFace.load();
      document.fonts.add(loaded);
      await document.fonts.ready;
    })();
  }

  await koreanWebFontReady;
}

function dataUrlToUint8Array(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex < 0) {
    throw new Error('이미지 데이터 형식이 올바르지 않습니다.');
  }

  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  const ellipsis = '...';
  let low = 0;
  let high = text.length;
  let best = ellipsis;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;

    if (ctx.measureText(candidate).width <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

async function renderAuditTrailPng(
  rows: AuditTrailRow[],
  width: number,
  height: number
) {
  await ensureKoreanWebFont();

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('DESC 미리보기 캔버스를 초기화하지 못했습니다.');
  }

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);

  const paddingX = 4;
  const paddingY = 3;
  const contentWidth = Math.max(width - paddingX * 2, 20);
  const contentHeight = Math.max(height - paddingY * 2, 12);
  const lineHeight = contentHeight / Math.max(rows.length, 1);
  const fontSize = Math.min(7.5, Math.max(6, lineHeight - 2));
  const columnGap = 12;
  const leftWidth = contentWidth * 0.55;
  const rightWidth = contentWidth - leftWidth - columnGap;

  ctx.fillStyle = '#222222';
  ctx.textBaseline = 'top';
  ctx.font = `${fontSize}px "${KOREAN_FONT_FAMILY}", sans-serif`;

  let y = paddingY;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row.right) {
      ctx.fillText(fitCanvasText(ctx, row.left, contentWidth), paddingX, y);
    } else {
      ctx.fillText(fitCanvasText(ctx, row.left, leftWidth), paddingX, y);
      ctx.fillText(
        fitCanvasText(ctx, row.right, rightWidth),
        paddingX + leftWidth + columnGap,
        y
      );
    }

    y += lineHeight;
  }

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

async function renderSingleLinePng(text: string, width: number, height: number) {
  await ensureKoreanWebFont();

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('텍스트 캔버스를 초기화하지 못했습니다.');
  }

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);

  const fontSize = Math.min(11, Math.max(8, height - 4));
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontSize}px "${KOREAN_FONT_FAMILY}", sans-serif`;
  ctx.fillText(fitCanvasText(ctx, text, Math.max(width - 4, 10)), 2, height / 2);

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
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

function getFilledFileName(filePath: string, index: number) {
  const rawName = filePath.split('/').pop() || `document-${index + 1}.pdf`;
  const baseName = rawName.toLowerCase().endsWith('.pdf')
    ? rawName.slice(0, -4)
    : rawName;

  return `${baseName}-filled.pdf`;
}

function getPageForWidget(
  pdfDoc: PDFDocument,
  widget: { dict: { get: (name: ReturnType<typeof PDFName.of>) => unknown } }
): PDFPage | null {
  const pages = pdfDoc.getPages();
  const pageRef = widget.dict.get(PDFName.of('P'));

  if (pageRef instanceof PDFRef) {
    const matched = pages.find((page) => page.ref === pageRef);
    if (matched) {
      return matched;
    }
  }

  return pages[0] ?? null;
}

/**
 * Stamp text as a PNG image so Korean glyphs stay intact in all PDF viewers.
 */
async function stampTextField(
  pdfDoc: PDFDocument,
  fieldName: string,
  text: string
) {
  const form = pdfDoc.getForm();
  const field = form.getTextField(fieldName);
  field.setText(text);

  const widgets = field.acroField.getWidgets();

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const pngBytes = await renderSingleLinePng(text, rect.width, rect.height);
    const image = await pdfDoc.embedPng(pngBytes);

    page.drawImage(image, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  form.removeField(field);
}

/**
 * Draw audit trail as a PNG image inside the desc field (viewer-safe Korean).
 */
async function stampAuditDescField(
  pdfDoc: PDFDocument,
  fieldName: string,
  values: IdentityFormValues
) {
  const form = pdfDoc.getForm();
  const field = form.getTextField(fieldName);
  const rows = buildAuditTrailRows(values);
  field.enableMultiline();
  field.setText(buildAuditTrailText(values));

  const widgets = field.acroField.getWidgets();

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const pngBytes = await renderAuditTrailPng(rows, rect.width, rect.height);
    const image = await pdfDoc.embedPng(pngBytes);

    page.drawImage(image, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  form.removeField(field);
}

/**
 * Fill matching AcroForm text fields with identity verification values.
 * Returns null when the PDF has no AcroForm fields.
 */
export async function fillAcroFormIdentity(
  pdfBytes: ArrayBuffer,
  values: IdentityFormValues
): Promise<{ bytes: Uint8Array; filledFields: string[] } | null> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const form = pdfDoc.getForm();
  const fields = form.getFields();

  if (fields.length === 0) {
    return null;
  }

  const fieldNames = fields.map((field) => field.getName());
  const filledFields: string[] = [];

  const nameField = findFieldName(fieldNames, NAME_ALIASES);
  const phoneField = findFieldName(fieldNames, PHONE_ALIASES);
  const birthdayField = findFieldName(fieldNames, BIRTHDAY_ALIASES);
  const descField = findFieldName(fieldNames, DESC_ALIASES);

  const name = values.name?.trim();
  const phone = values.phoneNumber?.trim();
  const birthDate = values.birthDate?.trim();

  const toStamp: Array<{ fieldName: string; text: string }> = [];

  if (nameField && name) {
    toStamp.push({ fieldName: nameField, text: name });
  }

  if (phoneField && phone) {
    toStamp.push({ fieldName: phoneField, text: formatPhoneNumber(phone) });
  }

  if (birthdayField && birthDate) {
    toStamp.push({ fieldName: birthdayField, text: formatBirthDate(birthDate) });
  }

  const shouldFillDesc = !!(descField && (values.txId || values.ci || values.clientIp));

  if (toStamp.length === 0 && !shouldFillDesc) {
    return null;
  }

  for (const item of toStamp) {
    await stampTextField(pdfDoc, item.fieldName, item.text);
    filledFields.push(item.fieldName);
  }

  if (shouldFillDesc && descField) {
    await stampAuditDescField(pdfDoc, descField, values);
    filledFields.push(descField);
  }

  return {
    bytes: await pdfDoc.save(),
    filledFields,
  };
}

export async function fillAndDownloadIdentityDocuments(options: {
  documents: FillableDocumentInput[];
  values: IdentityFormValues;
  onProgress?: (message: string) => void;
}) {
  const { documents, values, onProgress } = options;

  if (documents.length === 0) {
    throw new Error('채울 동의 문서가 없습니다.');
  }

  let filledCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const label = document.label || `문서 ${index + 1}`;

    onProgress?.(`(${index + 1}/${documents.length}) ${label} AcroForm 채우는 중...`);

    const response = await fetch(document.fileUrl, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`${label} PDF를 가져오지 못했습니다. (${response.status})`);
    }

    const pdfBytes = await response.arrayBuffer();
    const filled = await fillAcroFormIdentity(pdfBytes, values);

    if (!filled) {
      skippedCount += 1;
      continue;
    }

    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    triggerDownload(filled.bytes, getFilledFileName(document.filePath, index));
    filledCount += 1;
  }

  if (filledCount === 0) {
    onProgress?.(
      skippedCount > 0
        ? 'AcroForm 필드가 있는 문서가 없어 PDF에 값을 넣지 않았습니다.'
        : '채울 문서가 없습니다.'
    );
    return { filledCount, skippedCount };
  }

  onProgress?.(
    `본인인증 정보로 PDF ${filledCount}개를 채웠습니다.${
      skippedCount > 0 ? ` (AcroForm 없음 ${skippedCount}개 건너뜀)` : ''
    }`
  );

  return { filledCount, skippedCount };
}
