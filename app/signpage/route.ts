import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const FORCE_LIGHT_HEAD = [
  '<meta name="color-scheme" content="light" />',
  '<meta name="nightmode" content="disable" />',
  '<meta name="darkmode" content="disable" />',
  '<style>html,body{color-scheme:light only!important;background:#eef3f9!important;color:#1e293b!important;forced-color-adjust:none;-webkit-forced-color-adjust:none}</style>',
  `<script>(function(){try{document.documentElement.style.colorScheme='light only';document.documentElement.style.backgroundColor='#eef3f9';document.documentElement.style.color='#1e293b';var ua=navigator.userAgent||'';var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var needsCounter=/Android|KAKAOTALK|SamsungBrowser|NAVER|Instagram|FBAN|FBAV|Line\\//i.test(ua);if(dark&&needsCounter)document.documentElement.classList.add('counter-force-dark');}catch(e){}})();</script>`,
].join('');

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
    let renderedHtml = html.includes('<head>')
      ? html.replace('<head>', `<head>${FORCE_LIGHT_HEAD}`)
      : `${FORCE_LIGHT_HEAD}${html}`;
    renderedHtml = renderedHtml.includes('</head>')
      ? renderedHtml.replace('</head>', `${configScript}</head>`)
      : `${configScript}${renderedHtml}`;

    return new NextResponse(renderedHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'HTML 파일을 불러오지 못했습니다.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
