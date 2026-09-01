import 'server-only';

import path from 'path';
import { createCanvas, GlobalFonts, loadImage, Image as NapiImage } from '@napi-rs/canvas';

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

  // acroform-fill trimInkFromDataUrl 가 new Image() 를 쓸 수 있게 합니다.
  g.Image = class {
    width = 0;
    height = 0;
    onload: ((this: this) => void) | null = null;
    onerror: ((this: this, err?: unknown) => void) | null = null;
    private _native: InstanceType<typeof NapiImage> | null = null;

    set src(value: string) {
      void loadImage(value)
        .then((img) => {
          this._native = img;
          this.width = img.width;
          this.height = img.height;
          this.onload?.call(this);
        })
        .catch((err) => {
          this.onerror?.call(this, err);
        });
    }

    // canvas.drawImage 가 native Image 를 받도록 언랩
    valueOf() {
      return this._native;
    }
    get native() {
      return this._native;
    }
  };

  // drawImage가 wrapper를 받더라도 native로 그리도록 패치
  const proto = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
  const originalDrawImage = proto.drawImage;
  proto.drawImage = function patchedDrawImage(
    image: unknown,
    ...rest: unknown[]
  ) {
    const unwrapped =
      image &&
      typeof image === 'object' &&
      'native' in image &&
      (image as { native?: unknown }).native
        ? (image as { native: unknown }).native
        : image;
    return originalDrawImage.call(this, unwrapped, ...rest);
  };

  shimInstalled = true;
}

export { createCanvas, loadImage, KOREAN_FONT_FAMILY };
