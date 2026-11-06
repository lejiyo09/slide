/**
 * 슬라이드 → 그림(canvas). 편집기·슬라이드 쇼와 같은 SlideView를 화면 밖에 그린 뒤
 * modern-screenshot(SVG foreignObject)으로 그림으로 바꾼다. 글꼴은 fontEmbed가 쓰인 것만 넣는다.
 * 이미지·PDF·비디오 내보내기와 수식/3D 대체 그림에 함께 쓴다.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { domToCanvas, waitUntilLoad } from 'modern-screenshot';
import type { Presentation, Slide } from '../../types/model';
import type { Frame } from '../../engines/animation/effects';
import { SlideView } from '../../engines/rendering/SlideView';
import { loadAssetUrl } from '../../hooks/useAssetUrl';
import { FontEmbedder } from './fontEmbed';
import type { ReactNode } from 'react';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface CaptureOptions {
  /** 슬라이드 원본 크기 대비 배율 (1 = 슬라이드 크기 px) */
  scale?: number;
  background?: string;
}

export class SlideRasterizer {
  private host: HTMLDivElement;
  private root: Root;
  readonly fonts = new FontEmbedder();
  private fontCss = new Map<string, string>();

  constructor(private doc: Presentation) {
    this.host = document.createElement('div');
    this.host.className = 'sl-raster-host';
    this.host.setAttribute('aria-hidden', 'true');
    // 화면 밖 (visibility:hidden은 복제본에도 적용되므로 쓰지 않음)
    Object.assign(this.host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${doc.size.width}px`, height: `${doc.size.height}px`, overflow: 'hidden', pointerEvents: 'none', contain: 'strict' });
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
  }

  get node(): HTMLElement {
    return this.host.firstElementChild as HTMLElement;
  }

  /** 미디어 자산을 미리 읽어 둠 (그리는 즉시 주소가 있도록) */
  private async preload(slide: Slide) {
    const ids = new Set<string>();
    const visit = (o: Slide['objects'][number]) => {
      if (o.type === 'image') ids.add(o.assetId);
      if (o.type === 'media' && o.posterId) ids.add(o.posterId);
      if (o.type === 'group') o.children.forEach(visit);
      if ('fill' in o && o.fill && o.fill.type === 'image') ids.add(o.fill.assetId);
    };
    slide.objects.forEach(visit);
    if (slide.background?.fill?.type === 'image') ids.add(slide.background.fill.assetId);
    await Promise.all([...ids].map((id) => (this.doc.assets[id] ? loadAssetUrl(this.doc.assets[id]) : null)));
  }

  /** 슬라이드(또는 임의 요소)를 그림 */
  async render(slide: Slide, frames?: Map<string, Frame>, content?: ReactNode) {
    await this.preload(slide);
    flushSync(() => this.root.render(content ?? <SlideView slide={slide} doc={this.doc} mode="thumb" frames={frames} />));
    // 자산 주소(useAssetUrl)는 효과에서 채워짐 → 두 프레임 기다린 뒤 이미지 로드 대기
    await nextFrame();
    await nextFrame();
    await waitUntilLoad(this.host, { timeout: 15000 }).catch(() => {});
    await document.fonts.ready;
  }

  /** 지금 그려진 내용을 canvas로 */
  async capture(opts: CaptureOptions = {}, fontKey?: string): Promise<HTMLCanvasElement> {
    const node = this.node;
    let css = fontKey ? this.fontCss.get(fontKey) : undefined;
    if (css === undefined) {
      css = await this.fonts.cssFor(node);
      if (fontKey) this.fontCss.set(fontKey, css);
    }
    return domToCanvas(node, {
      width: this.doc.size.width,
      height: this.doc.size.height,
      scale: opts.scale ?? 1,
      backgroundColor: opts.background ?? '#ffffff',
      font: { cssText: css },
      timeout: 15000,
    });
  }

  destroy() {
    this.root.unmount();
    this.host.remove();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('그림을 만들지 못했습니다.'))), type, quality));
}
