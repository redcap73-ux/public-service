import { PDFDocument, PDFName, PDFRef, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

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

let cachedFontBytes: ArrayBuffer | null = null;

async function loadKoreanFontBytes() {
  if (cachedFontBytes) {
    return cachedFontBytes;
  }

  const response = await fetch(KOREAN_FONT_URL, { cache: 'force-cache' });

  if (!response.ok) {
    throw new Error(
      '한글 폰트를 불러오지 못했습니다. public/fonts/NotoSansKR-Regular.otf 를 확인해 주세요.'
    );
  }

  cachedFontBytes = await response.arrayBuffer();
  return cachedFontBytes;
}

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

function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-***-${digits.slice(6)}`;
  }

  return value;
}

function maskCi(value: string) {
  const ci = value.trim();

  if (ci.length <= 20) {
    return `${ci} (마스킹)`;
  }

  return `${ci.slice(0, 10)}...****************...${ci.slice(-8)} (마스킹)`;
}

export function buildAuditTrailText(values: IdentityFormValues) {
  const name = values.name?.trim() || '-';
  const phone = values.phoneNumber?.trim()
    ? maskPhoneNumber(values.phoneNumber)
    : '-';
  const birthDate = values.birthDate?.trim()
    ? formatBirthDate(values.birthDate)
    : '-';
  const txId = values.txId?.trim() || '-';
  const ci = values.ci?.trim() ? maskCi(values.ci) : '-';
  const clientIp = values.clientIp?.trim() || '-';
  const userAgent = values.userAgent?.trim() || '-';

  return [
    '[전자서명 및 본인확인 완료 증적 (Audit Trail)]',
    `• 동의자: ${name} (${phone})   │  생년월일: ${birthDate}`,
    `• 인증수단: 휴대폰 본인확인 (포트원)  │  인증 거래ID: ${txId}`,
    `• CI: ${ci}  │  IP: ${clientIp} (${userAgent})`,
  ].join('\n');
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
 * AcroForm appearance streams often break Hangul (default Courier / bad CJK subset).
 * Stamp visible text onto the page at the field rect, then remove the field widget.
 */
function stampTextField(
  pdfDoc: PDFDocument,
  fieldName: string,
  text: string,
  font: PDFFont,
  options?: { multiline?: boolean; fontSize?: number }
) {
  const form = pdfDoc.getForm();
  const field = form.getTextField(fieldName);

  if (options?.multiline) {
    field.enableMultiline();
  }

  field.setText(text);

  const widgets = field.acroField.getWidgets();

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const lines = options?.multiline ? text.split('\n') : [text];
    const lineCount = Math.max(lines.length, 1);
    const availableHeight = Math.max(rect.height - 4, 8);
    const autoSize = options?.multiline
      ? Math.min(options.fontSize ?? 7, availableHeight / lineCount - 1)
      : Math.min(11, Math.max(8, rect.height - 4));
    const fontSize = Math.max(5.5, autoSize);
    const lineGap = fontSize + 1.2;
    const maxWidth = Math.max(rect.width - 4, 10);

    if (options?.multiline) {
      let y = rect.y + rect.height - fontSize - 2;

      for (const line of lines) {
        if (y < rect.y) {
          break;
        }

        page.drawText(line, {
          x: rect.x + 2,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth,
        });
        y -= lineGap;
      }
    } else {
      page.drawText(text, {
        x: rect.x + 2,
        y: rect.y + (rect.height - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth,
      });
    }
  }

  // Remove so viewers don't redraw a broken AcroForm appearance on top.
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
  pdfDoc.registerFontkit(fontkit);

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
  const auditTrail = buildAuditTrailText(values);

  const toStamp: Array<{
    fieldName: string;
    text: string;
    multiline?: boolean;
    fontSize?: number;
  }> = [];

  if (nameField && name) {
    toStamp.push({ fieldName: nameField, text: name });
  }

  if (phoneField && phone) {
    toStamp.push({ fieldName: phoneField, text: formatPhoneNumber(phone) });
  }

  if (birthdayField && birthDate) {
    toStamp.push({ fieldName: birthdayField, text: formatBirthDate(birthDate) });
  }

  if (descField && (name || phone || birthDate || values.txId || values.ci)) {
    toStamp.push({
      fieldName: descField,
      text: auditTrail,
      multiline: true,
      fontSize: 7,
    });
  }

  if (toStamp.length === 0) {
    return null;
  }

  const font = await pdfDoc.embedFont(await loadKoreanFontBytes(), { subset: true });

  for (const item of toStamp) {
    stampTextField(pdfDoc, item.fieldName, item.text, font, {
      multiline: item.multiline,
      fontSize: item.fontSize,
    });
    filledFields.push(item.fieldName);
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
