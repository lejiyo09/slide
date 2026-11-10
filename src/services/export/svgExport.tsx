/**
 * SVG로 내보내기 (파일 › 내보내기 › SVG). 그림으로 바꾸지 않는 벡터 파일:
 *  - 도형·자유형(도형 병합 결과)·선: <path>/<line> — 채움 규칙(fill-rule), 색·투명도, 테두리(두께·대시), 구멍·여러 영역 그대로
 *  - 그림: <image> (자르기 = 안쪽 뷰포트, 도형 모양 자르기 = <clipPath>), 뒤집기·회전
 *  - 글자·표·차트·수식 등 HTML로 그리는 개체: <foreignObject> 안에 편집기와 같은 HTML (쓰인 글꼴을 @font-face로 함께)
 *  - 배경: 단색·그라데이션·그림
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import type { Fill, Presentation, Slide, SlideObject, Stroke } from '../../types/model';
import { shapePath, customPath } from '../../engines/rendering/shapeGeometry';
import { ObjectView, dashArray } from '../../engines/rendering/ObjectView';
import { SlideView, designLayers } from '../../engines/rendering/SlideView';
import { resolveTokensDeep } from '../../utils/themeColor';
import { ptToPx } from '../../utils/units';
import { FontEmbedder } from './fontEmbed';

type Doc = Presentation;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => (Math.round(v * 100) / 100).toString();

class Defs {
  items: string[] = [];
  n = 0;
  id(prefix: string) {
    return `${prefix}${++this.n}`;
  }
}

/** 채우기 → fill 속성 (그라데이션·무늬는 defs에) */
function fillAttr(fill: Fill | undefined, doc: Doc, defs: Defs): string {
  if (!fill || fill.type === 'none') return 'fill="none"';
  if (fill.type === 'solid') return `fill="${fill.color}"${fill.opacity !== undefined && fill.opacity < 1 ? ` fill-opacity="${num(fill.opacity)}"` : ''}`;
  if (fill.type === 'gradient') {
    const id = defs.id('g');
    defs.items.push(`<linearGradient id="${id}" gradientTransform="rotate(${num(fill.angle)}, 0.5, 0.5)">${fill.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${s.color}"/>`).join('')}</linearGradient>`);
    return `fill="url(#${id})"`;
  }
  if (fill.type === 'image') {
    const a = doc.assets[fill.assetId];
    if (!a) return 'fill="none"';
    const id = defs.id('p');
    defs.items.push(`<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${esc(a.dataUrl)}" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern>`);
    return `fill="url(#${id})"`;
  }
  // 무늬: 앞색으로 근사
  return `fill="${fill.fg}"`;
}

function strokeAttr(s: Stroke | null | undefined): string {
  if (!s) return 'stroke="none"';
  const dash = dashArray(s);
  return `stroke="${s.color}" stroke-width="${num(ptToPx(s.width))}"${s.opacity !== undefined && s.opacity < 1 ? ` stroke-opacity="${num(s.opacity)}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"`;
}

/** 개체 상자 변환: 이동 + 가운데 기준 회전 (렌더러와 같음) */
const boxTransform = (o: SlideObject) => `translate(${num(o.x)},${num(o.y)})${o.rotation ? ` rotate(${num(o.rotation)},${num(o.width / 2)},${num(o.height / 2)})` : ''}`;
const flipTransform = (o: SlideObject) => (o.flipH || o.flipV ? ` transform="translate(${o.flipH ? num(o.width) : 0},${o.flipV ? num(o.height) : 0}) scale(${o.flipH ? -1 : 1},${o.flipV ? -1 : 1})"` : '');

/** HTML로 그리는 부분 (글자·표·차트 …) → foreignObject (회전 없는 상자 좌표) */
function htmlPart(o: SlideObject, doc: Doc): string {
  const local = { ...o, x: 0, y: 0, rotation: 0 } as SlideObject;
  const html = renderToStaticMarkup(createElement(ObjectView, { obj: local, assets: doc.assets, theme: doc.theme, mode: 'show' }));
  return `<foreignObject x="0" y="0" width="${num(o.width)}" height="${num(o.height)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${num(o.width)}px;height:${num(o.height)}px">${html}</div></foreignObject>`;
}

const hasText = (o: SlideObject) => (o.type === 'text' || o.type === 'shape') && o.text.paragraphs.some((p) => p.runs.some((r) => r.text));

function objectSvg(o: SlideObject, doc: Doc, defs: Defs): string {
  if (o.hidden) return '';
  const op = o.opacity !== undefined && o.opacity < 1 ? ` opacity="${num(o.opacity)}"` : '';
  const open = `<g transform="${boxTransform(o)}"${op} data-name="${esc(o.name || o.type)}">`;
  switch (o.type) {
    case 'shape': {
      const d = shapePath(o.shape, o.width, o.height, o.geometry);
      const rule = o.geometry?.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      const custom = o.shape === 'custom';
      const strokeD = custom ? customPath(o.geometry, o.width, o.height, 'stroke') : d;
      const body = custom
        ? `<path d="${d}" ${fillAttr(o.fill, doc, defs)}${rule} stroke="none"/><path d="${strokeD}" fill="none" ${strokeAttr(o.stroke)}/>`
        : `<path d="${d}" ${fillAttr(o.fill, doc, defs)} ${strokeAttr(o.stroke)}/>`;
      return `${open}<g${flipTransform(o)}>${body}</g>${hasText(o) ? htmlPart({ ...o, fill: { type: 'none' }, stroke: null } as SlideObject, doc) : ''}</g>`;
    }
    case 'text': {
      const bg = o.fill.type !== 'none' || o.stroke ? `<rect width="${num(o.width)}" height="${num(o.height)}" ${fillAttr(o.fill, doc, defs)} ${strokeAttr(o.stroke)}/>` : '';
      return `${open}${bg}${hasText(o) ? htmlPart({ ...o, fill: { type: 'none' }, stroke: null } as SlideObject, doc) : ''}</g>`;
    }
    case 'line': {
      let x1 = 0, y1 = 0, x2 = o.width, y2 = o.height;
      if (o.flipH) [x1, x2] = [x2, x1];
      if (o.flipV) [y1, y2] = [y2, y1];
      const marker = (head: string) => {
        if (head === 'none') return '';
        const id = defs.id('m');
        const shape = head === 'triangle' ? `<path d="M0,0 L10,5 L0,10 Z" fill="${o.stroke.color}"/>` : head === 'arrow' ? `<path d="M1,1 L9,5 L1,9" fill="none" stroke="${o.stroke.color}" stroke-width="2"/>` : `<circle cx="5" cy="5" r="4" fill="${o.stroke.color}"/>`;
        defs.items.push(`<marker id="${id}" viewBox="0 0 10 10" refX="${head === 'oval' ? 5 : 8}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth">${shape}</marker>`);
        return id;
      };
      const ms = marker(o.headStart), me = marker(o.headEnd);
      return `${open}<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${strokeAttr(o.stroke)}${ms ? ` marker-start="url(#${ms})"` : ''}${me ? ` marker-end="url(#${me})"` : ''}/></g>`;
    }
    case 'image': {
      const a = doc.assets[o.assetId];
      if (!a) return '';
      const c = o.crop, fw = Math.max(0.01, 1 - c.left - c.right), fh = Math.max(0.01, 1 - c.top - c.bottom);
      const iw = o.width / fw, ih = o.height / fh;
      let clip = '';
      if (o.clip) {
        const id = defs.id('c');
        defs.items.push(`<clipPath id="${id}"><path d="${customPath(o.clip, o.width, o.height)}"${o.clip.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
        clip = ` clip-path="url(#${id})"`;
      }
      const stroke = o.stroke ? (o.clip ? `<path d="${customPath(o.clip, o.width, o.height)}" fill="none" ${strokeAttr(o.stroke)}/>` : `<rect width="${num(o.width)}" height="${num(o.height)}" fill="none" ${strokeAttr(o.stroke)}/>`) : '';
      return `${open}<g${clip}><svg width="${num(o.width)}" height="${num(o.height)}" overflow="hidden"><g${flipTransform(o)}><image href="${esc(a.dataUrl)}" x="${num(-c.left * iw)}" y="${num(-c.top * ih)}" width="${num(iw)}" height="${num(ih)}" preserveAspectRatio="none"/></g></svg></g>${stroke}</g>`;
    }
    case 'group':
      return `${open}${o.children.map((c) => objectSvg(c, doc, defs)).join('')}</g>`;
    default:
      // 표·차트·수식·미디어 등: 편집기와 같은 HTML
      return `${open}${htmlPart(o, doc)}</g>`;
  }
}

/** 쓰인 글꼴의 @font-face (슬라이드를 화면 밖에 그려 모음) */
async function fontCssFor(doc: Doc, slide: Slide): Promise<string> {
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${doc.size.width}px`, height: `${doc.size.height}px` });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => root.render(createElement(SlideView, { slide, doc, mode: 'show' })));
    return await new FontEmbedder().cssFor(host);
  } catch {
    return '';
  } finally {
    root.unmount();
    host.remove();
  }
}

/** 슬라이드 하나 → SVG 문서 */
export async function slideToSvg(source: Doc, slide: Slide): Promise<string> {
  const doc = resolveTokensDeep(source, source.theme);
  const s = doc.slides.find((x) => x.id === slide.id) ?? resolveTokensDeep(slide, source.theme);
  const defs = new Defs();
  const { bg, layers } = designLayers(s, doc);
  const W = doc.size.width, H = doc.size.height;
  const bgSvg = `<rect width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="${H}" ${fillAttr(bg, doc, defs)}/>`;
  const body = [...layers, ...s.objects].map((o) => objectSvg(o, doc, defs)).join('\n');
  const fonts = await fontCssFor(doc, s);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
    `<title>${esc(doc.title)}</title>\n<defs>${fonts ? `<style>${fonts.replace(/]]>/g, ']]&gt;')}</style>` : ''}${defs.items.join('')}</defs>\n` +
    `<clipPath id="slide"><rect width="${W}" height="${H}"/></clipPath>\n<g clip-path="url(#slide)">${bgSvg}\n${body}</g>\n</svg>\n`
  );
}

/** 현재 슬라이드 또는 모든 슬라이드 (ZIP) */
export async function exportSvg(doc: Doc, slideIds: string[]): Promise<{ blob: Blob; fileName: string; count: number }> {
  const base = (doc.title || '프레젠테이션').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const slides = slideIds.map((id) => doc.slides.find((s) => s.id === id)).filter((s): s is Slide => !!s);
  if (slides.length === 1) {
    const svg = await slideToSvg(doc, slides[0]);
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), fileName: `${base}-슬라이드${doc.slides.indexOf(slides[0]) + 1}.svg`, count: 1 };
  }
  const zip = new JSZip();
  const dir = zip.folder(base)!;
  for (const s of slides) dir.file(`슬라이드${doc.slides.indexOf(s) + 1}.svg`, await slideToSvg(doc, s));
  return { blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), fileName: `${base}-svg.zip`, count: slides.length };
}
