import { PDFDocument } from 'pdf-lib';

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

  return merged.save();
}
