import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      'viewpub',
      '전자서명시스템고객용.html'
    );
    const html = await readFile(filePath, 'utf-8');

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'HTML 파일을 불러오지 못했습니다.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
