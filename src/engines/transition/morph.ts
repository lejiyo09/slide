/**
 * 모핑 전환 (PowerPoint: 전환 › 모핑). 그림 두 장을 겹치는 다른 전환과 달리 개체 단위로 움직인다.
 * - 짝짓기: 이름이 '!!'로 시작하면 같은 이름끼리 (PowerPoint 규칙), 그 밖에는 같은 종류 중
 *   같은 글자·같은 그림·같은 도형 모양·같은 이름일수록 높은 점수로 짝 (점수가 낮으면 짝 없음)
 * - 짝지은 개체: 위치·크기·회전·불투명도·채우기 색·선 색/두께·글자 크기/색을 사이값으로 (한 개체로 그림)
 *   내용이 다르면(다른 글자·모양·그림) 사이값 자리에서 앞 개체는 사라지고 뒤 개체가 나타남
 * - 짝이 없는 개체: 앞 슬라이드 것은 사라지고(페이드 아웃) 다음 슬라이드 것은 나타남(페이드 인)
 * - 옵션 단어/문자: 글자가 바뀐 텍스트 상자는 상자만 움직이고, 같은 단어(문자)는 앞 자리에서 새 자리로 이동,
 *   없어진·새 단어(문자)는 사라지고 나타남 (자리는 화면에서 잰 글자 상자: morphMeasure.ts)
 */
import type { Color, Fill, Paragraph, SlideObject, Stroke, TextBody } from '../../types/model';
import type { Frame } from '../animation/effects';

export type MorphOption = 'byObject' | 'byWord' | 'byChar';

export const morphEase = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/* ───────────── 짝짓기 ───────────── */

const textOf = (b: TextBody) => b.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');

export function objectText(o: SlideObject): string {
  if (o.type === 'text' || o.type === 'shape') return textOf(o.text);
  if (o.type === 'group') return o.children.map(objectText).join(' ');
  if (o.type === 'table') return o.rows.map((r) => r.cells.map((c) => textOf(c.text)).join('\t')).join('\n');
  if (o.type === 'equation') return o.latex;
  return '';
}

const kindOf = (o: SlideObject) => (o.type === 'text' || o.type === 'shape' ? 'textlike' : o.type);
const shapeKind = (o: SlideObject) => (o.type === 'shape' ? o.shape : o.type === 'text' ? 'rect' : o.type);
const assetOf = (o: SlideObject) => (o.type === 'image' || o.type === 'media' ? o.assetId : o.type === 'extension' ? (o.assetId ?? '') : '');

/** 글자 유사도 (같은 글자 bigram 비율, 0..1) */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let common = 0;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return (2 * common) / Math.max(1, a.length - 1 + b.length - 1);
}

/** 두 개체가 같은 개체일 점수 (-1 = 짝이 될 수 없음) */
export function matchScore(a: SlideObject, b: SlideObject): number {
  const forced = a.name.startsWith('!!') || b.name.startsWith('!!');
  if (forced) return a.name === b.name ? 100 : -1;
  if (kindOf(a) !== kindOf(b)) return -1;
  let s = 0;
  if (a.name && a.name === b.name) s += 3;
  const ta = objectText(a), tb = objectText(b);
  if (ta || tb) {
    if (ta === tb) s += 8;
    else s += 5 * similarity(ta, tb);
  }
  if (kindOf(a) === 'textlike') s += shapeKind(a) === shapeKind(b) ? 2 : 0;
  else if (a.type === 'image' || a.type === 'media' || a.type === 'extension') s += assetOf(a) && assetOf(a) === assetOf(b) ? 8 : 0;
  else s += 2;
  return s;
}

export interface MorphMatch {
  pairs: [SlideObject, SlideObject][];
  gone: SlideObject[];
  added: SlideObject[];
}

/** 점수가 높은 짝부터 (한 개체는 한 번만), 문턱값 미만은 짝 없음 */
export function matchMorph(from: SlideObject[], to: SlideObject[], threshold = 2): MorphMatch {
  const cand: { i: number; j: number; s: number }[] = [];
  from.forEach((a, i) =>
    to.forEach((b, j) => {
      const s = matchScore(a, b);
      if (s >= threshold) cand.push({ i, j, s: s - Math.abs(i / Math.max(1, from.length) - j / Math.max(1, to.length)) * 0.01 });
    }),
  );
  cand.sort((x, y) => y.s - x.s);
  const usedA = new Set<number>(), usedB = new Set<number>();
  const pairs: [SlideObject, SlideObject][] = [];
  for (const c of cand) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    pairs.push([from[c.i], to[c.j]]);
  }
  return { pairs, gone: from.filter((_, i) => !usedA.has(i)), added: to.filter((_, j) => !usedB.has(j)) };
}

/* ───────────── 사이값 ───────────── */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rgb(c: Color): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lerpColor(a: Color | undefined, b: Color | undefined, t: number): Color | undefined {
  if (!a || !b) return t < 0.5 ? a : b;
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return t < 0.5 ? a : b;
  return `#${x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** 회전: 가까운 쪽으로 (350° → 10°는 20°만) */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return a + d * t;
}

function lerpFill(a: Fill, b: Fill, t: number): Fill {
  if (a.type === 'solid' && b.type === 'solid') return { type: 'solid', color: lerpColor(a.color, b.color, t)!, opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t) };
  if (a.type === 'none' && b.type === 'solid') return { ...b, opacity: (b.opacity ?? 1) * t };
  if (a.type === 'solid' && b.type === 'none') return { ...a, opacity: (a.opacity ?? 1) * (1 - t) };
  return t < 0.5 ? a : b;
}

function lerpStroke(a: Stroke | null | undefined, b: Stroke | null | undefined, t: number): Stroke | null | undefined {
  if (a && b) return { ...b, color: lerpColor(a.color, b.color, t)!, width: lerp(a.width, b.width, t), opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t) };
  if (b && !a) return { ...b, opacity: (b.opacity ?? 1) * t };
  if (a && !b) return { ...a, opacity: (a.opacity ?? 1) * (1 - t) };
  return b;
}

/** 같은 글자의 문단: 글자 묶음 수가 같으면 글자 크기·색을 사이값으로 */
function lerpParagraphs(a: Paragraph[], b: Paragraph[], t: number): Paragraph[] {
  return b.map((pb, i) => {
    const pa = a[i];
    if (!pa || pa.runs.length !== pb.runs.length) return pb;
    return {
      ...pb,
      runs: pb.runs.map((rb, k) => {
        const ra = pa.runs[k];
        return {
          ...rb,
          ...(ra.fontSize !== undefined && rb.fontSize !== undefined ? { fontSize: lerp(ra.fontSize, rb.fontSize, t) } : {}),
          ...(ra.color && rb.color ? { color: lerpColor(ra.color, rb.color, t) } : {}),
        };
      }),
    };
  });
}

/** 같은 내용인지 (한 개체로 사이값을 그릴 수 있는지) */
export function sameContent(a: SlideObject, b: SlideObject): boolean {
  if (a.type !== b.type) return false;
  if (objectText(a) !== objectText(b)) return false;
  if (a.type === 'shape' && b.type === 'shape' && a.shape !== b.shape) return false;
  if (assetOf(a) !== assetOf(b)) return false;
  if (a.type === 'equation' && b.type === 'equation') return a.latex === b.latex;
  return true;
}

/** 짝지은 두 개체의 t 시점 모습 (b를 바탕으로) */
export function lerpObject(a: SlideObject, b: SlideObject, t: number): SlideObject {
  const o = { ...b } as SlideObject & Record<string, unknown>;
  o.x = lerp(a.x, b.x, t);
  o.y = lerp(a.y, b.y, t);
  o.width = lerp(a.width, b.width, t);
  o.height = lerp(a.height, b.height, t);
  o.rotation = lerpAngle(a.rotation ?? 0, b.rotation ?? 0, t);
  o.opacity = lerp(a.opacity ?? 1, b.opacity ?? 1, t);
  if ('fill' in a && 'fill' in b && a.fill && b.fill) o.fill = lerpFill(a.fill as Fill, b.fill as Fill, t);
  if ('stroke' in a || 'stroke' in b) o.stroke = lerpStroke((a as { stroke?: Stroke | null }).stroke, (b as { stroke?: Stroke | null }).stroke, t);
  if ((a.type === 'text' || a.type === 'shape') && (b.type === 'text' || b.type === 'shape') && textOf(a.text) === textOf(b.text))
    o.text = { ...b.text, paragraphs: lerpParagraphs(a.text.paragraphs, b.text.paragraphs, t) };
  if (a.type === 'equation' && b.type === 'equation') {
    o.fontSize = lerp(a.fontSize, b.fontSize, t);
    o.color = lerpColor(a.color, b.color, t);
  }
  return o as SlideObject;
}

/* ───────────── 글자 단위 (단어/문자) ───────────── */

/** 화면에서 잰 글자 묶음 (슬라이드 px, 왼쪽 위 기준) */
export interface MorphToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS 글자 서식 */
  style: { fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string; color: Color; textDecoration?: string };
}

export interface TokenSprite extends MorphToken {
  key: string;
  opacity: number;
}

/** 같은 글자 묶음끼리 짝 (같은 글자 중 원래 순서가 가까운 것), 나머지는 사라짐/나타남 */
export function morphTokens(from: MorphToken[], to: MorphToken[], t: number, key: string): TokenSprite[] {
  const used = new Set<number>();
  const out: TokenSprite[] = [];
  to.forEach((b, j) => {
    let best = -1, dist = Infinity;
    from.forEach((a, i) => {
      if (used.has(i) || a.text !== b.text) return;
      const d = Math.abs(i / Math.max(1, from.length) - j / Math.max(1, to.length));
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      const a = from[best];
      out.push({
        ...b,
        key: `${key}:m${j}`,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t),
        style: { ...b.style, fontSize: lerp(a.style.fontSize, b.style.fontSize, t), color: lerpColor(a.style.color, b.style.color, t)! },
        opacity: 1,
      });
    } else out.push({ ...b, key: `${key}:n${j}`, opacity: t });
  });
  from.forEach((a, i) => {
    if (!used.has(i)) out.push({ ...a, key: `${key}:o${i}`, opacity: 1 - t });
  });
  return out;
}

/* ───────────── 장면 ───────────── */

export interface MorphScene {
  /** 그릴 개체 (앞→뒤 순서) */
  objects: SlideObject[];
  /** 개체 ID → 불투명도 */
  frames: Map<string, Frame>;
  /** 단어/문자 옵션의 글자 묶음 */
  tokens: TokenSprite[];
}

export interface MorphInput {
  from: SlideObject[];
  to: SlideObject[];
  /** 진행률 0..1 (가감속 전) */
  p: number;
  option?: MorphOption;
  /** 단어/문자 옵션: 개체 ID → 화면에서 잰 글자 묶음 (from·to 모두) */
  tokens?: Map<string, MorphToken[]>;
}

/** 진행률 p의 장면: 사라지는 개체 → 짝지은 개체(다음 슬라이드 순서) → 나타나는 개체 */
export function morphScene({ from, to, p, option = 'byObject', tokens }: MorphInput): MorphScene {
  const t = morphEase(Math.max(0, Math.min(1, p)));
  const { pairs, gone, added } = matchMorph(from, to);
  const objects: SlideObject[] = [];
  const frames = new Map<string, Frame>();
  const sprites: TokenSprite[] = [];
  const put = (o: SlideObject, id: string, opacity: number) => {
    if (opacity <= 0.001) return;
    const c = { ...o, id } as SlideObject;
    objects.push(c);
    frames.set(id, { opacity });
  };
  for (const o of gone) put(o, `mo:${o.id}`, 1 - t);
  // 다음 슬라이드의 쌓는 순서대로
  const order = new Map(to.map((o, i) => [o.id, i]));
  const sorted = [...pairs].sort((x, y) => (order.get(x[1].id) ?? 0) - (order.get(y[1].id) ?? 0));
  for (const [a, b] of sorted) {
    const g = lerpObject(a, b, t);
    if (sameContent(a, b)) {
      put(g, `mp:${b.id}`, 1);
      continue;
    }
    const textlike = (a.type === 'text' || a.type === 'shape') && (b.type === 'text' || b.type === 'shape');
    const ta = tokens?.get(a.id), tb = tokens?.get(b.id);
    if (option !== 'byObject' && textlike && ta && tb && !a.rotation && !b.rotation) {
      // 상자는 글자 없이 움직이고, 글자는 묶음 단위로
      const box = { ...g, text: { ...(g as { text: TextBody }).text, paragraphs: [{ runs: [{ text: '' }] }] } } as SlideObject;
      put(box, `mp:${b.id}`, 1);
      sprites.push(...morphTokens(ta, tb, t, b.id));
      continue;
    }
    // 내용이 다름: 사이값 자리에서 앞 개체(앞 모양)는 사라지고 뒤 개체가 나타남
    const ga = lerpObject(b, a, 1 - t);
    put(ga, `mx:${a.id}`, 1 - t);
    put(g, `mp:${b.id}`, t);
  }
  for (const o of added) put(o, `mn:${o.id}`, t);
  return { objects, frames, tokens: sprites };
}

/** 글자 묶음 나누기: 단어(공백 사이) 또는 문자 */
export function splitTokens(text: string, option: MorphOption): string[] {
  if (option === 'byChar') return [...text].filter((c) => !/\s/.test(c));
  return text.split(/\s+/).filter(Boolean);
}
