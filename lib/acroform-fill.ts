import { PDFDocument, PDFName, PDFRef, type PDFPage } from 'pdf-lib';

export type IdentityFormValues = {
  name?: string;
  /** 성명 서명 입력값 — PDF name_system* AcroForm 필드에 매핑 (텍스트 폴백) */
  nameSystem?: string;
  /** 성명 서명 캔버스 PNG data URL — 있으면 name_system*에 이미지로 스탬프 */
  nameSystemDataUrl?: string;
  phoneNumber?: string;
  birthDate?: string;
  ci?: string;
  txId?: string;
  clientIp?: string;
  userAgent?: string;
  /** 우편번호 (본인 인적사항 확인 화면) */
  postcode?: string;
  /** 기본 주소 */
  addressBase?: string;
  /** 상세 주소 */
  addressDetail?: string;
  /** 조합된 전체 주소 (없으면 postcode/base/detail로 생성) */
  address?: string;
  /** 요청 JSON의 created_by — PDF adjuster* 필드에 매핑 */
  adjuster?: string;
  /** 요청 JSON signer_role — PDF my* 필드에 매핑 */
  signerRole?: string;
  /** 요청 JSON의 aphone — PDF aphone* 필드에 매핑 */
  adjustPhone?: string;
  /** 요청 JSON claim_no — PDF snumber* 필드에 매핑 */
  claimNo?: string;
  /** 요청 JSON pol_no — PDF pnumber* 필드에 매핑 */
  polNo?: string;
  /** 요청 JSON prod_nm — PDF ppro* 필드에 매핑 */
  prodNm?: string;
  /** 요청 JSON aadjuster — PDF aadjuster* 필드에 매핑 */
  aadjuster?: string;
  /** 요청 JSON company — PDF company* 필드에 매핑 */
  company?: string;
  /** 요청 JSON babirthday — PDF babirthday* 필드에 매핑 */
  babirthday?: string;
  /** 요청 JSON adjust_juso — PDF adjust_juso* / juminnum_ad* 필드에 매핑 */
  adjustJuso?: string;
  /** 요청 JSON adjudst_jumin(또는 adjust_jumin) — PDF adjust_jumin* / juso_ad* 필드에 매핑 */
  adjustJumin?: string;
  /** pdf_field_name -> 사용자 답변. 예: { text_1: '소개자 없음' } */
  extraFields?: Record<string, string>;
  /** 선택형 답변 문구. PDF 본문 "동의함" 왼쪽 [ ]에 체크를 찍을 때 사용 */
  checkLabels?: string[];
  /** template pdf_field_name 이 year4/year2/month/day/hour/min 인 경우, 같은 접두어 PDF 필드에 현재 시각을 넣습니다. */
  datePrefixes?: Array<'year4' | 'year2' | 'month' | 'day' | 'hour' | 'min'>;
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
const DATE_FIELD_PREFIXES = ['year4', 'year2', 'month', 'day', 'hour', 'min'] as const;
type DateFieldPrefix = (typeof DATE_FIELD_PREFIXES)[number];
const COMPANY_OFFICE_ADDRESS =
  '서울특별시 종로구 창경궁로 109, 세운스퀘어 본관 6층';

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

function findExactFieldName(fieldNames: string[], target: string) {
  const wanted = target.trim();
  if (!wanted) {
    return null;
  }

  if (fieldNames.includes(wanted)) {
    return wanted;
  }

  const normalized = normalizeFieldKey(wanted);
  return fieldNames.find((fieldName) => normalizeFieldKey(fieldName) === normalized) ?? null;
}

function expandFieldNameCandidates(rawName: string) {
  const name = rawName.trim();
  if (!name) {
    return [];
  }

  const candidates = [name, name.replace(/\s+/g, '')];
  const suffixMatch = name.match(/^(.*?)[_-]?(\d+)$/);
  if (suffixMatch?.[1]) {
    const base = suffixMatch[1];
    const index = suffixMatch[2];
    candidates.push(`${base}_${index}`, `${base}${index}`, `${base}-${index}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function resolveExtraFieldName(fieldNames: string[], rawName: string) {
  for (const candidate of expandFieldNameCandidates(rawName)) {
    const matched = findExactFieldName(fieldNames, candidate);
    if (matched) {
      return matched;
    }
  }
  return null;
}

function isNameSystemField(fieldName: string) {
  return fieldStartsWithSystemPrefix(fieldName, 'name_system');
}

/**
 * name_system / signature_system 및 name_system_1, NameSystem2 등 접두어 변형 매칭.
 * 일반 name / signature 접두어와 구분하기 위해 system 접두어를 기준으로 판별합니다.
 */
function fieldStartsWithSystemPrefix(fieldName: string, prefix: string) {
  if (fieldStartsWithPrefix(fieldName, prefix)) {
    return true;
  }

  const normalizedName = normalizeFieldKey(fieldName);
  const normalizedPrefix = normalizeFieldKey(prefix);
  if (!normalizedPrefix) {
    return false;
  }
  if (normalizedName === normalizedPrefix) {
    return true;
  }
  if (!normalizedName.startsWith(normalizedPrefix)) {
    return false;
  }

  // name_system1 / NameSystem2 처럼 구분 없이 숫자가 이어지는 경우
  const next = normalizedName.charAt(normalizedPrefix.length);
  return /[0-9]/.test(next);
}

function fieldStartsWithPrefix(fieldName: string, prefix: string) {
  const name = fieldName.trim().toLowerCase();
  const wanted = prefix.trim().toLowerCase();
  if (!wanted) {
    return false;
  }
  if (name === wanted) {
    return true;
  }
  if (!name.startsWith(wanted) || name.length === wanted.length) {
    return false;
  }
  return /[^a-z]/.test(name.charAt(wanted.length));
}

function fieldStartsWithDatePrefix(fieldName: string, prefix: DateFieldPrefix) {
  return fieldStartsWithPrefix(fieldName, prefix);
}

function matchDatePrefix(name: string): DateFieldPrefix | null {
  const normalized = name.trim().toLowerCase();
  return DATE_FIELD_PREFIXES.find((prefix) => fieldStartsWithDatePrefix(normalized, prefix)) ?? null;
}

function getKstDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const min = parts.find((part) => part.type === 'minute')?.value ?? '';

  return {
    year4: year,
    year2: year.slice(-2),
    month,
    day,
    hour,
    min,
  };
}

function pushPrefixFieldStamps(
  fieldNames: string[],
  prefix: string,
  text: string | undefined,
  toStamp: Array<{ fieldName: string; text: string }>
) {
  const value = String(text ?? '').trim();
  if (!value) {
    return;
  }
  for (const fieldName of fieldNames) {
    if (fieldStartsWithPrefix(fieldName, prefix)) {
      toStamp.push({ fieldName, text: value });
    }
  }
}

function wrapCanvasLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const char of paragraph) {
      const candidate = `${current}${char}`;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = char;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length ? lines : [''];
}

function formatBirthDate(value: string) {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 8) {
    return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  }

  if (digits.length === 6) {
    return digits;
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

/** 화면·PDF 표기용: 사고번호 앞 3자리 제거 */
function formatClaimNoForDisplay(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > 3 ? trimmed.slice(3) : trimmed;
}

/** 회사명 표기 정규화: 티엔지 → 티앤지 */
export function normalizeCompanyName(value: string | undefined | null) {
  return String(value ?? '')
    .replace(/티엔지/g, '티앤지')
    .trim();
}

/** 우편번호 + 기본주소 + 상세주소를 PDF용 한 줄로 조합 */
export function formatIdentityAddress(values: {
  postcode?: string;
  addressBase?: string;
  addressDetail?: string;
  address?: string;
}) {
  const postcode = values.postcode?.trim() ?? '';
  const base = values.addressBase?.trim() ?? '';
  const detail = values.addressDetail?.trim() ?? '';
  const street = [base, detail].filter(Boolean).join(' ');

  if (postcode && street) {
    return `(${postcode}) ${street}`;
  }
  if (street) {
    return street;
  }
  if (postcode) {
    return `(${postcode})`;
  }

  const fallback = values.address?.trim() ?? '';
  if (fallback && postcode && !fallback.includes(postcode)) {
    return `(${postcode}) ${fallback}`;
  }
  return fallback;
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
  // 서버(@napi-rs/canvas GlobalFonts)에서 미리 등록된 경우
  if ((globalThis as { __TNG_SERVER_KOREAN_FONT__?: boolean }).__TNG_SERVER_KOREAN_FONT__) {
    return;
  }

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

/** 성명 서명(name_system)용 — 필드 높이에 맞춰 더 큰 글씨로 스탬프 */
async function renderSignatureStylePng(text: string, width: number, height: number) {
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

  const maxWidth = Math.max(width - 6, 10);
  let fontSize = Math.min(Math.max(height * 0.72, 14), Math.max(height - 2, 14), 36);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = `italic ${fontSize}px "${KOREAN_FONT_FAMILY}", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || fontSize <= 10) {
      break;
    }
    fontSize -= 2;
  }

  ctx.fillText(fitCanvasText(ctx, text, maxWidth), 3, height / 2);

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

function isCheckMarkText(text: string) {
  return ['v', 'V', '✓', '✔'].includes(text.trim());
}

async function renderCenteredMarkPng(_text: string, width: number, height: number) {
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

  const size = Math.min(width, height);
  const pad = size * 0.18;
  const left = (width - size) / 2 + pad;
  const top = (height - size) / 2 + pad;
  const box = size - pad * 2;

  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1.4, box * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(left + box * 0.08, top + box * 0.52);
  ctx.lineTo(left + box * 0.38, top + box * 0.82);
  ctx.lineTo(left + box * 0.92, top + box * 0.18);
  ctx.stroke();

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

export async function renderCheckMarkPng(width: number, height: number) {
  return renderCenteredMarkPng('✓', width, height);
}

async function renderWrappedTextPng(text: string, width: number, height: number) {
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

  const paddingX = 4;
  const paddingY = 3;
  const contentWidth = Math.max(width - paddingX * 2, 10);
  const contentHeight = Math.max(height - paddingY * 2, 10);
  const fontSize = Math.min(11, Math.max(7, Math.min(contentHeight, 14)));

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  ctx.font = `${fontSize}px "${KOREAN_FONT_FAMILY}", sans-serif`;

  const lineHeight = fontSize + 3;
  const maxLines = Math.max(1, Math.floor(contentHeight / lineHeight));
  let lines = wrapCanvasLines(ctx, text, contentWidth);

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = fitCanvasText(ctx, lines[maxLines - 1], contentWidth);
  }

  let y = paddingY;
  for (const line of lines) {
    ctx.fillText(line, paddingX, y);
    y += lineHeight;
  }

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

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('서명 이미지를 읽지 못했습니다.'));
    image.src = dataUrl;
  });
}

/**
 * 캔버스 여백을 제거하고 잉크(필기) 영역만 남깁니다.
 * AcroForm 필드에 넣을 때 실제 서명 글자가 필드 크기에 맞게 커지도록 합니다.
 */
async function trimInkFromDataUrl(dataUrl: string): Promise<Uint8Array> {
  const image = await loadHtmlImage(dataUrl);
  const source = document.createElement('canvas');
  source.width = Math.max(1, image.width);
  source.height = Math.max(1, image.height);
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) {
    throw new Error('서명 이미지를 처리하지 못했습니다.');
  }

  sourceCtx.clearRect(0, 0, source.width, source.height);
  sourceCtx.drawImage(image, 0, 0);

  const { data, width, height } = sourceCtx.getImageData(
    0,
    0,
    source.width,
    source.height
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
    return dataUrlToUint8Array(dataUrl);
  }

  const pad = 4;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + pad * 2);

  const trimmed = document.createElement('canvas');
  trimmed.width = Math.max(1, cropWidth);
  trimmed.height = Math.max(1, cropHeight);
  const trimmedCtx = trimmed.getContext('2d');
  if (!trimmedCtx) {
    return dataUrlToUint8Array(dataUrl);
  }

  trimmedCtx.clearRect(0, 0, trimmed.width, trimmed.height);
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

  const trimmedData = trimmedCtx.getImageData(0, 0, trimmed.width, trimmed.height);
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

  // 스트로크를 약간 두껍게 해 PDF에서도 또렷하게 보이도록 합니다.
  const bold = document.createElement('canvas');
  bold.width = trimmed.width;
  bold.height = trimmed.height;
  const boldCtx = bold.getContext('2d');
  if (!boldCtx) {
    return dataUrlToUint8Array(trimmed.toDataURL('image/png'));
  }
  boldCtx.clearRect(0, 0, bold.width, bold.height);
  for (const [ox, oy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    boldCtx.drawImage(trimmed, ox, oy);
  }

  return dataUrlToUint8Array(bold.toDataURL('image/png'));
}

/** AcroForm 위젯 rect 안에 이미지 비율을 유지한 채 최대 크기로 배치 */
function fitImageInFieldRect(
  imageWidth: number,
  imageHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  padding = 1
) {
  const maxWidth = Math.max(rect.width - padding * 2, 4);
  const maxHeight = Math.max(rect.height - padding * 2, 4);
  const scale = Math.min(maxWidth / Math.max(imageWidth, 1), maxHeight / Math.max(imageHeight, 1));
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return {
    x: rect.x + (rect.width - drawWidth) / 2,
    y: rect.y + (rect.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

/**
 * Stamp an image (e.g. handwritten name) onto an AcroForm field widget.
 * Trims empty canvas margins first so the ink scales up to the field size.
 */
async function stampImageOnField(
  pdfDoc: PDFDocument,
  fieldName: string,
  imageDataUrl: string
) {
  const form = pdfDoc.getForm();
  const field = form.getFields().find((item) => item.getName() === fieldName);
  if (!field) {
    return false;
  }

  let pngBytes: Uint8Array;
  try {
    pngBytes = await trimInkFromDataUrl(imageDataUrl);
  } catch {
    pngBytes = dataUrlToUint8Array(imageDataUrl);
  }
  const embeddedImage = await pdfDoc.embedPng(pngBytes);
  const widgets = field.acroField.getWidgets();
  if (widgets.length === 0) {
    return false;
  }

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const draw = fitImageInFieldRect(
      embeddedImage.width,
      embeddedImage.height,
      rect,
      1
    );

    page.drawImage(embeddedImage, draw);
  }

  try {
    form.removeField(field);
  } catch {
    // ignore
  }
  return true;
}

/**
 * Stamp text as a PNG image so Korean glyphs stay intact in all PDF viewers.
 */
async function stampTextField(
  pdfDoc: PDFDocument,
  fieldName: string,
  text: string,
  options?: { style?: 'default' | 'signature' }
) {
  const form = pdfDoc.getForm();
  const field = form.getTextField(fieldName);
  field.setText(text);

  const widgets = field.acroField.getWidgets();
  const style = options?.style ?? 'default';

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const pngBytes =
      style === 'signature'
        ? await renderSignatureStylePng(text, rect.width, rect.height)
        : await renderSingleLinePng(text, rect.width, rect.height);
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

async function stampMappedTextField(
  pdfDoc: PDFDocument,
  fieldName: string,
  text: string
) {
  const form = pdfDoc.getForm();
  let field;

  try {
    field = form.getTextField(fieldName);
  } catch {
    return false;
  }

  field.setText(text);

  const widgets = field.acroField.getWidgets();
  const useCheckMark = isCheckMarkText(text);
  const useWrapped =
    !useCheckMark &&
    (field.isMultiline() ||
      text.includes('\n') ||
      text.length > 18 ||
      widgets.some((widget) => widget.getRectangle().height > 16));

  if (useWrapped) {
    field.enableMultiline();
  }

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const pngBytes = useCheckMark
      ? await renderCenteredMarkPng(text, rect.width, rect.height)
      : useWrapped
        ? await renderWrappedTextPng(text, rect.width, rect.height)
        : await renderSingleLinePng(text, rect.width, rect.height);
    const image = await pdfDoc.embedPng(pngBytes);

    page.drawImage(image, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  form.removeField(field);
  return true;
}

function checkMarkDrawRect(rect: { x: number; y: number; width: number; height: number }) {
  if (rect.width <= Math.max(rect.height * 1.8, 18)) {
    return rect;
  }

  const size = Math.max(Math.min(rect.height * 0.92, 14), 8);
  return {
    x: rect.x + 1,
    y: rect.y + (rect.height - size) / 2,
    width: size,
    height: size,
  };
}

async function stampMappedExtraField(
  pdfDoc: PDFDocument,
  fieldName: string,
  text: string
) {
  const form = pdfDoc.getForm();
  const field = form.getFields().find((item) => item.getName() === fieldName);
  if (!field) {
    return false;
  }

  try {
    form.getCheckBox(fieldName).check();
  } catch {
    // Radio/text/button fields are stamped as images below.
  }

  const widgets = field.acroField.getWidgets();
  if (widgets.length === 0) {
    return stampMappedTextField(pdfDoc, fieldName, text);
  }

  const useCheckMark = isCheckMarkText(text);
  // 질문 응답 text는 세로 칸/줄바꿈을 반영하도록 체크 표시가 아니면 여러 줄 렌더
  const useWrapped = !useCheckMark;

  if (useWrapped) {
    try {
      const textField = form.getTextField(fieldName);
      textField.enableMultiline();
      textField.setText(text);
    } catch {
      // non-text widgets keep image-only stamping
    }
  }

  for (const widget of widgets) {
    const page = getPageForWidget(pdfDoc, widget);
    if (!page) {
      continue;
    }

    const rect = widget.getRectangle();
    const drawRect = useCheckMark ? checkMarkDrawRect(rect) : rect;
    const pngBytes = useCheckMark
      ? await renderCenteredMarkPng(text, drawRect.width, drawRect.height)
      : useWrapped
        ? await renderWrappedTextPng(text, drawRect.width, drawRect.height)
        : await renderSingleLinePng(text, drawRect.width, drawRect.height);
    const image = await pdfDoc.embedPng(pngBytes);

    page.drawImage(image, {
      x: drawRect.x,
      y: drawRect.y,
      width: drawRect.width,
      height: drawRect.height,
    });
  }

  try {
    form.removeField(field);
  } catch {
    // Keep the stamped image even if the widget cannot be removed.
  }

  return true;
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
  const nameSystem = values.nameSystem?.trim() || name;
  const nameSystemDataUrl = values.nameSystemDataUrl?.trim() || '';
  const useNameSystemImage = nameSystemDataUrl.startsWith('data:image/');
  const phone = values.phoneNumber?.trim();
  const birthDate = values.birthDate?.trim();
  const addressText = formatIdentityAddress(values);
  const adjuster = values.adjuster?.trim();
  const aadjuster = values.aadjuster?.trim();
  const signerRole = values.signerRole?.trim();
  const adjustPhone = values.adjustPhone?.trim();
  const claimNo = formatClaimNoForDisplay(values.claimNo || '');
  const polNo = values.polNo?.trim();
  const prodNm = values.prodNm?.trim();
  const company = normalizeCompanyName(values.company);
  const babirthday = values.babirthday?.trim();
  const adjustJuso = values.adjustJuso?.trim();
  const adjustJumin = values.adjustJumin?.trim();

  const toStamp: Array<{
    fieldName: string;
    text: string;
    style?: 'default' | 'signature';
  }> = [];
  const addressToStamp: Array<{ fieldName: string; text: string }> = [];
  const nameSystemImageFields: string[] = [];

  if (name) {
    const nameTargets = new Set<string>();
    if (nameField && !isNameSystemField(nameField)) {
      nameTargets.add(nameField);
    }
    for (const fieldName of fieldNames) {
      if (fieldStartsWithPrefix(fieldName, 'name') && !isNameSystemField(fieldName)) {
        nameTargets.add(fieldName);
      }
    }
    for (const fieldName of nameTargets) {
      toStamp.push({ fieldName, text: name });
    }
  }

  for (const fieldName of fieldNames) {
    if (!isNameSystemField(fieldName)) {
      continue;
    }
    if (useNameSystemImage) {
      nameSystemImageFields.push(fieldName);
    } else if (nameSystem) {
      toStamp.push({ fieldName, text: nameSystem, style: 'signature' });
    }
  }

  if (phone) {
    const phoneText = formatPhoneNumber(phone);
    const phoneTargets = new Set<string>();
    if (phoneField) {
      phoneTargets.add(phoneField);
    }
    for (const fieldName of fieldNames) {
      if (fieldStartsWithPrefix(fieldName, 'phone')) {
        phoneTargets.add(fieldName);
      }
    }
    for (const fieldName of phoneTargets) {
      toStamp.push({ fieldName, text: phoneText });
    }
  }

  if (birthDate) {
    const birthdayText = formatBirthDate(birthDate);
    const birthdayTargets = new Set<string>();
    if (birthdayField) {
      birthdayTargets.add(birthdayField);
    }
    for (const fieldName of fieldNames) {
      if (fieldStartsWithPrefix(fieldName, 'birthday')) {
        birthdayTargets.add(fieldName);
      }
    }
    for (const fieldName of birthdayTargets) {
      toStamp.push({ fieldName, text: birthdayText });
    }
  }

  if (addressText) {
    for (const fieldName of fieldNames) {
      if (fieldStartsWithPrefix(fieldName, 'address')) {
        addressToStamp.push({ fieldName, text: addressText });
      }
    }
  }

  pushPrefixFieldStamps(fieldNames, 'my', signerRole, toStamp);
  if (adjustPhone) {
    pushPrefixFieldStamps(fieldNames, 'aphone', formatPhoneNumber(adjustPhone), toStamp);
  }
  pushPrefixFieldStamps(fieldNames, 'snumber', claimNo, toStamp);
  pushPrefixFieldStamps(fieldNames, 'pnumber', polNo, toStamp);
  pushPrefixFieldStamps(fieldNames, 'ppro', prodNm, toStamp);
  pushPrefixFieldStamps(fieldNames, 'company', company, toStamp);
  pushPrefixFieldStamps(fieldNames, 'babirthday', babirthday, toStamp);
  pushPrefixFieldStamps(fieldNames, 'adjust_juso', adjustJuso, toStamp);
  pushPrefixFieldStamps(fieldNames, 'juminnum_ad', adjustJuso, toStamp);
  pushPrefixFieldStamps(fieldNames, 'adjust_jumin', adjustJumin, toStamp);
  pushPrefixFieldStamps(fieldNames, 'juso_ad', adjustJumin, toStamp);
  pushPrefixFieldStamps(fieldNames, 'coaddress', COMPANY_OFFICE_ADDRESS, toStamp);
  // aadjuster* 를 adjuster* 보다 먼저 채워 겹침을 피합니다.
  pushPrefixFieldStamps(fieldNames, 'aadjuster', aadjuster, toStamp);
  if (adjuster) {
    for (const fieldName of fieldNames) {
      if (
        fieldStartsWithPrefix(fieldName, 'adjuster') &&
        !fieldStartsWithPrefix(fieldName, 'aadjuster')
      ) {
        toStamp.push({ fieldName, text: adjuster });
      }
    }
  }

  const shouldFillDesc = !!(descField && (values.txId || values.ci || values.clientIp));
  const reservedNames = new Set([
    ...toStamp.map((item) => item.fieldName),
    ...addressToStamp.map((item) => item.fieldName),
    ...nameSystemImageFields,
  ]);
  if (shouldFillDesc && descField) {
    reservedNames.add(descField);
  }
  const extraToStamp: Array<{ fieldName: string; text: string }> = [];

  for (const [rawName, rawValue] of Object.entries(values.extraFields ?? {})) {
    if (matchDatePrefix(rawName)) {
      continue;
    }
    const text = String(rawValue ?? '').trim();
    const fieldName = resolveExtraFieldName(fieldNames, rawName);
    if (!text || !fieldName || reservedNames.has(fieldName)) {
      continue;
    }
    extraToStamp.push({ fieldName, text });
    reservedNames.add(fieldName);
  }

  const dateParts = getKstDateParts();
  const dateToStamp: Array<{ fieldName: string; text: string }> = [];

  for (const fieldName of fieldNames) {
    const prefix = matchDatePrefix(fieldName);
    if (!prefix || reservedNames.has(fieldName)) {
      continue;
    }
    const text = dateParts[prefix];
    if (!text) {
      continue;
    }
    dateToStamp.push({ fieldName, text });
    reservedNames.add(fieldName);
  }

  if (
    toStamp.length === 0 &&
    addressToStamp.length === 0 &&
    nameSystemImageFields.length === 0 &&
    !shouldFillDesc &&
    extraToStamp.length === 0 &&
    dateToStamp.length === 0
  ) {
    return null;
  }

  for (const item of toStamp) {
    await stampTextField(pdfDoc, item.fieldName, item.text, {
      style: item.style ?? 'default',
    });
    filledFields.push(item.fieldName);
  }

  if (useNameSystemImage) {
    for (const fieldName of nameSystemImageFields) {
      const stamped = await stampImageOnField(pdfDoc, fieldName, nameSystemDataUrl);
      if (stamped) {
        filledFields.push(fieldName);
      }
    }
  }

  for (const item of addressToStamp) {
    const stamped = await stampMappedTextField(pdfDoc, item.fieldName, item.text);
    if (stamped) {
      filledFields.push(item.fieldName);
    }
  }

  if (shouldFillDesc && descField) {
    await stampAuditDescField(pdfDoc, descField, values);
    filledFields.push(descField);
  }

  for (const item of extraToStamp) {
    const stamped = await stampMappedExtraField(pdfDoc, item.fieldName, item.text);
    if (stamped) {
      filledFields.push(item.fieldName);
    }
  }

  for (const item of dateToStamp) {
    const stamped = await stampMappedExtraField(pdfDoc, item.fieldName, item.text);
    if (stamped) {
      filledFields.push(item.fieldName);
    }
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
