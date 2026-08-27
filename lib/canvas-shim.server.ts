import 'server-only';

import path from 'path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const KOREAN_FONT_FAMILY = 'NotoSansKREmbed';
let shimInstalled = false;

/**
 * acroform-fill.ts 의 document.createElement('canvas') 호출을
 * @napi-rs/canvas 로 연결합니다.
 */
export function ensureServerCanvasShim() {
  if (shimInstalled) {
    return;
  }

  const fontPath = path.join(
    process.cwd(),
    'public',
    'fonts',
    'NotoSansKR-Regular.otf'
  );
  GlobalFonts.registerFromPath(fontPath, KOREAN_FONT_FAMILY);
  (
    globalThis as { __TNG_SERVER_KOREAN_FONT__?: boolean }
  ).__TNG_SERVER_KOREAN_FONT__ = true;

  // DOM 타입과 napi canvas 타입이 달라 any 로 주입
  const g = globalThis as any;

  g.FontFace = class {
    family: string;
    source: string;
    constructor(family: string, source: string) {
      this.family = family;
      this.source = source;
    }
    async load() {
      return this;
    }
  };

  g.document = {
    createElement(tag: string) {
      if (tag === 'canvas') {
        return createCanvas(300, 150);
      }
      return { style: {} };
    },
    fonts: {
      add() {
        return this;
      },
      ready: Promise.resolve(),
    },
  };

  shimInstalled = true;
}

export { createCanvas, loadImage, KOREAN_FONT_FAMILY };
