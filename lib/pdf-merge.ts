import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * 여러 PDF를 하나의 PDF로 합칩니다. (문서 순서대로 페이지 연결)
 * 브라우저·서버 공통으로 사용합니다.
 */
export async function mergePdfByteList(pdfBytesList: Uint8Array[]) {
  if (pdfBytesList.length === 0) {
    throw new Error('병합할 PDF가 없습니다.');
  }

  if (pdfBytesList.length === 1) {
    return pdfBytesList[0];
  }

  const merged = await PDFDocument.create();

  for (const bytes of pdfBytesList) {
    const source = await PDFDocument.load(bytes);
    const pageIndices = source.getPageIndices();
    const copiedPages = await merged.copyPages(source, pageIndices);

    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }

  return merged.save({ updateFieldAppearances: false });
}

/**
 * 최종 PDF 모든 페이지 하단 왼쪽에 request_no를 표기합니다.
 * Helvetica(WinAnsi)로 그릴 수 없는 문자는 제거합니다.
 */
export async function stampRequestNoFooter(
  pdfBytes: Uint8Array,
  requestNo: string
): Promise<Uint8Array> {
  const text = String(requestNo ?? '')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '');
  if (!text) {
    return pdfBytes;
  }

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 8;
  const marginX = 28;
  const marginY = 16;
  const color = rgb(0.4, 0.45, 0.52);

  for (const page of pdfDoc.getPages()) {
    page.drawText(text, {
      x: marginX,
      y: marginY,
      size: fontSize,
      font,
      color,
    });
  }

  return pdfDoc.save({ updateFieldAppearances: false });
}

/** 동일 PDF를 copies 회 이어 붙여 하나의 PDF로 만듭니다. */
export async function duplicatePdfBytes(pdfBytes: Uint8Array, copies: number) {
  const count = Number.isFinite(copies) ? Math.min(Math.max(Math.floor(copies), 1), 50) : 1;
  if (count <= 1) {
    return pdfBytes;
  }
  return mergePdfByteList(Array.from({ length: count }, () => pdfBytes));
}
