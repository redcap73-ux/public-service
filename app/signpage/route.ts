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
    const configScript = `<script>window.__APP_CONFIG__=${JSON.stringify({
      portone: {
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? '',
        channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY ?? '',
      },
    })};</script>`;
    const renderedHtml = html.includes('</head>')
      ? html.replace('</head>', `${configScript}</head>`)
      : `${configScript}${html}`;

    return new NextResponse(renderedHtml, {
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
