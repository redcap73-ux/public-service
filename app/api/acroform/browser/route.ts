import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      'viewpub',
      'acroform-fill.bundle.mjs'
    );
    const js = await readFile(filePath, 'utf-8');

    return new NextResponse(js, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'AcroForm 모듈을 불러오지 못했습니다.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
