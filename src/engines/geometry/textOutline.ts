/**
 * 텍스트를 윤곽선으로 (PowerPoint: 텍스트 상자를 다른 도형과 병합하면 글자가 윤곽선이 됨).
 *  1. 개체를 화면 밖에 실제와 같게 그려(줄 바꿈·맞춤·자간 그대로) 글자(그래핌)마다 화면 상자와 서식을 잰다 (DOM Range)
 *  2. 그 글자에 쓰인 글꼴 파일을 구한다: 내 글꼴·웹 글꼴(FontEmbedder가 쓰는 것과 같은 파일), 없으면 브라우저 로컬 글꼴 API(허용한 경우)
 *     woff/woff2는 sfnt로 풀어 opentype.js 1.3.5(MIT)로 해석
 *  3. 글리프 윤곽을 그 자리(기준선 = 상자 위 + 높이 × 어센더/(어센더−디센더))에 놓고, 밑줄·취소선은 글꼴의 위치·두께로 덧붙임
 *  4. 개체 회전을 적용하고 글자 색별로 합쳐 자유형으로
 * 글꼴 파일을 구할 수 없는 글자가 있으면 바꾸지 않고(가짜 글꼴로 대신하지 않음) 없는 글꼴 이름을 알려 준다.
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import opentype from 'opentype.js';
import paper from 'paper/dist/paper-core';
import type { Presentation, ShapeObject, SlideObject, TextObject } from '../../types/model';
import { ObjectView } from '../rendering/ObjectView';
import { cssColorToHex } from '../../utils/color';
import { FontEmbedder } from '../../services/export/fontEmbed';
import { detectFormat, woff2ToSfnt, woffToSfnt } from '../../services/fonts/sfnt';
import { toShape, type MergedShape } from './shapeBoolean';

type Doc = Pick<Presentation, 'assets' | 'theme'>;

interface Face {
  family: string;
  weight: number;
  italic: boolean;
  range: string | null;
  font: opentype.Font;
}

export interface TextOutlineResult {
  /** 글자 색별 윤곽 (슬라이드 좌표) */
  pieces: (MergedShape & { color: string })[];
  /** 파일을 구하지 못한 글꼴 */
  missing: string[];
}

const fontCache = new Map<string, Promise<opentype.Font | null>>();

async function parseFont(bytes: ArrayBuffer): Promise<opentype.Font | null> {
  try {
    const fmt = detectFormat(bytes);
    let sfnt: ArrayBuffer = bytes;
    if (fmt === 'woff2') sfnt = (await woff2ToSfnt(bytes)).slice().buffer;
    else if (fmt === 'woff') sfnt = (await woffToSfnt(bytes)).slice().buffer;
    return opentype.parse(sfnt);
  } catch {
    return null;
  }
}

function dataUrlBytes(url: string): ArrayBuffer | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const bin = m[1] ? atob(m[2]) : decodeURIComponent(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** @font-face CSS(data: URL) → 글꼴 목록 */
async function facesFromCss(css: string): Promise<Face[]> {
  const out: Face[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const family = /font-family:\s*["']?([^;"']+)["']?/.exec(block)?.[1]?.trim();
    const url = /url\("?(data:[^")]+)"?\)/.exec(block)?.[1];
    if (!family || !url) continue;
    const w = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(block);
    let p = fontCache.get(url);
    if (!p) {
      const bytes = dataUrlBytes(url);
      p = bytes ? parseFont(bytes) : Promise.resolve(null);
      fontCache.set(url, p);
    }
    const font = await p;
    if (font) out.push({ family: family.toLowerCase(), weight: w ? Number(w[1]) : 400, italic: /font-style:\s*italic/.test(block), range: /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? null, font });
  }
  return out;
}

/** 브라우저 로컬 글꼴 API (Chrome: 사용자가 허용한 경우) */
async function localFaces(families: string[]): Promise<Face[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string; style: string; blob(): Promise<Blob> }[]> }).queryLocalFonts;
  if (!q || !families.length) return [];
  try {
    const all = await q();
    const out: Face[] = [];
    for (const f of all) {
      const fam = f.family.toLowerCase();
      if (!families.includes(fam)) continue;
      const font = await parseFont(await (await f.blob()).arrayBuffer());
      if (font) out.push({ family: fam, weight: /bold/i.test(f.style) ? 700 : 400, italic: /italic|oblique/i.test(f.style), range: null, font });
    }
    return out;
  } catch {
    return [];
  }
}

const families = (css: string) => css.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji']);

/** 브라우저가 실제로 불러온 글꼴(@font-face: 내 글꼴·웹 글꼴)인지 */
function loadedFace(fam: string): boolean {
  for (const f of document.fonts as unknown as Iterable<FontFace>) if (f.family.replace(/^["']|["']$/g, '').toLowerCase() === fam && f.status === 'loaded') return true;
  return false;
}

/** 시스템에 설치된 글꼴이 그 글자를 그리는지 (기본 글꼴과 폭이 다르면 그 글꼴로 그려진 것) */
const sysCache = new Map<string, boolean>();
function systemHas(fam: string, ch: string): boolean {
  const key = `${fam}\u0000${ch}`;
  let v = sysCache.get(key);
  if (v === undefined) {
    const g = document.createElement('canvas').getContext('2d');
    v = false;
    if (g) {
      const sample = ch.repeat(8);
      for (const generic of ['monospace', 'serif']) {
        g.font = `64px ${generic}`;
        const a = g.measureText(sample).width;
        g.font = `64px "${fam}", ${generic}`;
        if (Math.abs(g.measureText(sample).width - a) > 0.5) v = true;
      }
    }
    sysCache.set(key, v);
  }
  return v;
}

/**
 * 글자 하나에 쓸 글꼴: 브라우저와 같은 순서로 — 목록에서 실제로 쓸 수 있는(불러왔거나 설치된) 첫 글꼴 중 그 글자가 있는 것.
 * 그 글꼴의 파일이 없으면 null (화면과 다른 글꼴로 대신 그리지 않음), 그때 실제 쓰인 글꼴 이름을 used에.
 */
function pick(faces: Face[], fams: string[], ch: string, weight: number, italic: boolean, used?: { name: string }): Face | null {
  for (const f of fams) {
    const cands = faces.filter((x) => x.family === f && x.font.charToGlyphIndex(ch) > 0);
    const available = loadedFace(f) || cands.length > 0 || systemHas(f, ch);
    if (!available) continue; // 브라우저도 건너뜀
    if (cands.length) return cands.sort((a, b) => Math.abs(a.weight - weight) + (a.italic !== italic ? 300 : 0) - (Math.abs(b.weight - weight) + (b.italic !== italic ? 300 : 0)))[0];
    if (loadedFace(f) && !faces.some((x) => x.family === f)) {
      // 불러온 글꼴인데 파일을 못 구함
      if (used) used.name = f;
      return null;
    }
    if (faces.some((x) => x.family === f)) continue; // 그 글꼴에 이 글자가 없음 → 다음 글꼴
    if (used) used.name = f; // 시스템 글꼴 (파일 없음)
    return null;
  }
  if (used) used.name = `${fams[0] ?? '글꼴'} (시스템 기본 글꼴로 대체됨)`;
  return null;
}

/** 개체(텍스트 상자·글자가 있는 도형)의 글자 → 윤곽선 */
export async function textToOutlines(doc: Doc, obj: TextObject | ShapeObject): Promise<TextOutlineResult> {
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${obj.width}px`, height: `${obj.height}px`, pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // 회전·위치 없이 같은 크기로 그림 (글자 상자는 회전 전 좌표로 잼)
    const local = { ...obj, x: 0, y: 0, rotation: 0, flipH: false, flipV: false, fill: { type: 'none' as const }, stroke: null } as SlideObject;
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => root.render(createElement(ObjectView, { obj: local, assets: doc.assets, theme: doc.theme, mode: 'show' })));
    await document.fonts.ready;
    const base = host.getBoundingClientRect();
    const faces = await facesFromCss(await new FontEmbedder().cssFor(host));
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
    const range = document.createRange();
    type Glyph = { ch: string; x: number; top: number; h: number; size: number; fams: string[]; weight: number; italic: boolean; color: string; under: boolean; strike: boolean };
    const glyphs: Glyph[] = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const el = n.parentElement;
      if (!el || !n.data.trim()) continue;
      const cs = getComputedStyle(el);
      const segs = Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(n.data)] : [...n.data].map((segment, index) => ({ segment, index }));
      let idx = 0;
      for (const sg of segs) {
        const from = Seg ? sg.index : idx;
        idx += sg.segment.length;
        if (/^\s+$/.test(sg.segment)) continue;
        range.setStart(n, from);
        range.setEnd(n, from + sg.segment.length);
        const r = [...range.getClientRects()].find((x) => x.width > 0);
        if (!r) continue;
        const deco = cs.textDecorationLine || '';
        glyphs.push({ ch: sg.segment, x: r.left - base.left, top: r.top - base.top, h: r.height, size: parseFloat(cs.fontSize) || 16, fams: families(cs.fontFamily).filter((f) => !GENERIC.has(f)), weight: Number(cs.fontWeight) || 400, italic: cs.fontStyle !== 'normal', color: cssColorToHex(cs.color) ?? '#000000', under: deco.includes('underline'), strike: deco.includes('line-through') });
      }
    }
    range.detach();
    // 파일을 못 구한 글꼴은 로컬 글꼴 API로 한 번 더
    const need = [...new Set(glyphs.map((g) => { const u = { name: '' }; return pick(faces, g.fams, g.ch, g.weight, g.italic, u) ? '' : u.name; }).filter((n) => n && !n.includes('(')))];
    if (need.length) faces.push(...(await localFaces(need)));
    const s = new paper.PaperScope();
    s.setup(new s.Size(1, 1));
    const byColor = new Map<string, paper.PathItem[]>();
    const missing = new Set<string>();
    for (const g of glyphs) {
      const used = { name: '' };
      const face = pick(faces, g.fams, g.ch, g.weight, g.italic, used);
      if (!face) {
        missing.add(used.name || (g.fams[0] ?? '(알 수 없는 글꼴)'));
        continue;
      }
      const f = face.font;
      const asc = f.ascender, desc = f.descender;
      const baseline = g.top + (g.h * asc) / (asc - desc);
      const d = f.getPath(g.ch, g.x, baseline, g.size).toPathData(3);
      const parts: paper.PathItem[] = [];
      if (d) parts.push(new s.CompoundPath({ pathData: d, insert: false }));
      const post = (f.tables as { post?: { underlinePosition: number; underlineThickness: number } }).post;
      const k = g.size / f.unitsPerEm;
      const w = f.getAdvanceWidth(g.ch, g.size);
      if (g.under && post) parts.push(new s.Path.Rectangle({ point: [g.x, baseline - post.underlinePosition * k], size: [w, Math.max(1, post.underlineThickness * k)], insert: false }));
      if (g.strike) {
        const os2 = (f.tables as { os2?: { yStrikeoutPosition: number; yStrikeoutSize: number } }).os2;
        const pos = os2 ? os2.yStrikeoutPosition : asc * 0.3, th = os2 ? os2.yStrikeoutSize : (post?.underlineThickness ?? 50);
        parts.push(new s.Path.Rectangle({ point: [g.x, baseline - pos * k], size: [w, Math.max(1, th * k)], insert: false }));
      }
      const list = byColor.get(g.color) ?? [];
      list.push(...parts);
      byColor.set(g.color, list);
    }
    if (missing.size) return { pieces: [], missing: [...missing] };
    // 개체 회전·위치 적용 (글자는 뒤집지 않음 — 렌더러와 같음)
    const m = new s.Matrix();
    m.translate(obj.x + obj.width / 2, obj.y + obj.height / 2);
    if (obj.rotation) m.rotate(obj.rotation, new s.Point(0, 0));
    m.translate(-obj.width / 2, -obj.height / 2);
    const pieces: TextOutlineResult['pieces'] = [];
    for (const [color, items] of byColor) {
      let u: paper.PathItem | null = null;
      for (const it of items) {
        const one = it.unite(it, { insert: false }) as paper.PathItem; // 글리프 안 겹친 윤곽 정리
        u = u ? (u.unite(one, { insert: false }) as paper.PathItem) : one;
      }
      if (!u) continue;
      u.transform(m);
      const shape = toShape(u);
      if (shape) pieces.push({ ...shape, color });
    }
    return { pieces, missing: [] };
  } finally {
    root.unmount();
    host.remove();
  }
}
