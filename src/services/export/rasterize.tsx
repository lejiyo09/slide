/**
 * 슬라이드 → 그림(canvas). 편집기·슬라이드 쇼와 같은 SlideView를 화면 밖에 그린 뒤
 * modern-screenshot(SVG foreignObject)으로 그림으로 바꾼다. 글꼴은 fontEmbed가 쓰인 것만 넣는다.
 * 이미지·PDF·비디오 내보내기와 수식/3D 대체 그림에 함께 쓴다.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { domToCanvas, waitUntilLoad } from 'modern-screenshot';
import type { Presentation, Slide, SlideObject } from '../../types/model';
import type { Frame } from '../../engines/animation/effects';
import { SlideView } from '../../engines/rendering/SlideView';
import { ObjectView } from '../../engines/rendering/ObjectView';
import { loadAssetUrl } from '../../hooks/useAssetUrl';
import { FontEmbedder } from './fontEmbed';
import type { ReactNode } from 'react';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface CaptureOptions {
  /** 슬라이드 원본 크기 대비 배율 (1 = 슬라이드 크기 px) */
  scale?: number;
  /** 배경색 (null = 투명) */
  background?: string | null;
}

export class SlideRasterizer {
  private host: HTMLDivElement;
  private root: Root;
  readonly fonts = new FontEmbedder();
  private fontCss = new Map<string, string>();

  constructor(private doc: Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>) {
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
  async capture(opts: CaptureOptions = {}, fontKey?: string, size?: { width: number; height: number }): Promise<HTMLCanvasElement> {
    const node = this.node;
    let css = fontKey ? this.fontCss.get(fontKey) : undefined;
    if (css === undefined) {
      css = await this.fonts.cssFor(node);
      if (fontKey) this.fontCss.set(fontKey, css);
    }
    return domToCanvas(node, {
      width: size?.width ?? this.doc.size.width,
      height: size?.height ?? this.doc.size.height,
      scale: opts.scale ?? 1,
      backgroundColor: opts.background === undefined ? '#ffffff' : opts.background,
      font: { cssText: css },
      timeout: 15000,
    });
  }

  /** 그린 슬라이드의 글자 위치 (px, 슬라이드 왼쪽 위 기준) — 그림 PDF의 보이지 않는 글자 층용 */
  textRuns(): TextRun[] {
    return collectTextRuns(this.host);
  }

  destroy() {
    this.root.unmount();
    this.host.remove();
  }
}

export interface TextRun {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** 글자(코드 포인트)마다 [왼쪽, 오른쪽] (px). 공백은 앞 글자 오른쪽~다음 글자 왼쪽 */
  boxes: [number, number][];
}

/**
 * 글자 노드마다 글자 하나씩의 화면 상자(Range)를 재서 같은 줄의 글자를 한 묶음으로 만든다.
 * 줄 바꿈(글자 상자의 위쪽이 줄 높이의 절반 넘게 바뀜)마다 새 묶음. 앞뒤 공백은 빼고 가운데 공백은 남김.
 * 회전한 개체는 화면 상자가 기울어진 글자마다 달라 짧은 묶음으로 나뉜다(검색·복사는 됨).
 */
export function collectTextRuns(root: HTMLElement): TextRun[] {
  const base = root.getBoundingClientRect();
  const out: TextRun[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    if (!value.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let cur: { x0: number; x1: number; top: number; bottom: number; text: string; space: boolean; boxes: [number, number][] } | null = null;
    const flush = () => {
      if (cur && cur.text) out.push({ x: cur.x0 - base.left, y: cur.top - base.top, width: cur.x1 - cur.x0, height: cur.bottom - cur.top, text: cur.text, boxes: cur.boxes.map(([a, b]) => [a - base.left, b - base.left]) });
      cur = null;
    };
    let i = 0;
    for (const ch of value) {
      const len = ch.length;
      range.setStart(node, i);
      range.setEnd(node, i + len);
      i += len;
      if (/\s/.test(ch)) {
        if (cur) cur.space = true;
        continue;
      }
      const rects = range.getClientRects();
      const r = rects[rects.length - 1];
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (cur && (Math.abs(r.top - cur.top) > r.height / 2 || r.left < cur.x0 - 1)) flush();
      if (!cur) {
        cur = { x0: r.left, x1: r.right, top: r.top, bottom: r.bottom, text: ch, space: false, boxes: [[r.left, r.right]] };
        continue;
      }
      if (cur.space) {
        cur.text += ' ';
        cur.boxes.push([cur.x1, r.left]);
      }
      cur.text += ch;
      cur.boxes.push([r.left, r.right]);
      cur.space = false;
      cur.x1 = Math.max(cur.x1, r.right);
      cur.top = Math.min(cur.top, r.top);
      cur.bottom = Math.max(cur.bottom, r.bottom);
    }
    flush();
  }
  range.detach();
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('그림을 만들지 못했습니다.'))), type, quality));
}

/** 개체 하나만 투명 배경 그림으로 (PPTX 수식의 대체 그림 등). 여러 개를 그릴 때 하나로 재사용 */
export function createObjectRenderer(doc: Presentation) {
  let r: SlideRasterizer | null = null;
  return {
    async png(o: SlideObject, scale = 2): Promise<Uint8Array> {
      r ??= new SlideRasterizer(doc);
      const local = { ...o, x: 0, y: 0, rotation: 0 } as SlideObject;
      const content = (
        <div style={{ position: 'relative', width: o.width, height: o.height }}>
          <ObjectView obj={local} assets={doc.assets} theme={doc.theme} mode="thumb" />
        </div>
      );
      await r.render({ id: 'object', objects: [local], notes: '', layout: '' } as unknown as Slide, undefined, content);
      const canvas = await r.capture({ scale, background: null }, undefined, { width: Math.ceil(o.width), height: Math.ceil(o.height) });
      return new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    },
    destroy() {
      r?.destroy();
      r = null;
    },
  };
}
