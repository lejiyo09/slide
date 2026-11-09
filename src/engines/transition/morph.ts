/**
 * 모핑 전환 엔진 (PowerPoint: 전환 › 모핑). 그림 두 장을 겹치는 다른 전환과 달리 개체 단위로 움직인다.
 * PowerPoint의 내부 알고리즘은 공개되어 있지 않으므로 공개된 동작(!! 이름 규칙, 개체/단어/문자 옵션)을 바탕으로 한 자체 구현이다.
 *
 * A. 짝짓기 (matchMorph) — 우선순위
 *    1) 같은 morphKey (슬라이드 복제·다른 슬라이드로 복사·사용자 지정 연결; 없으면 id)
 *    2) '!!'로 시작하는 같은 이름 (도형 계열이면 모양이 달라도) — '!!' 개체와 일반 개체는 짝짓지 않음
 *    3) 자동: 같은 계열 중 같은 글자·그림·모양·이름 점수 (문턱값 미만은 짝 없음, 비슷한 후보가 둘 이상이면 '모호함')
 *    4) 나머지: 사라지는 개체 / 나타나는 개체
 * B. 사이값 (lerpObject): 위치·크기·회전(가까운 쪽, 360° 이상 차이는 그대로 여러 바퀴)·뒤집기·불투명도·채우기(단색·그라데이션)·선·
 *    글자 크기/색·그림 자르기, 도형 모양이 다르면 경로 모핑(pathMorph.ts), 안 되면 교차 전환
 * C. 계획 (buildMorphPlan): 짝짓기·경로 샘플링·글자 묶음 짝을 전환 시작 때 한 번 계산 → 프레임마다 morphFrame(plan, p)만
 */
import type { Fill, GradientStop, ImageObject, Paragraph, ShapeObject, SlideObject, SlideTransition, Stroke, TextBody } from '../../types/model';
import type { Frame } from '../animation/effects';
import { shapePath } from '../rendering/shapeGeometry';
import { pathMorphAt, preparePathMorph, type PathMorph } from './pathMorph';

export type MorphOption = 'byObject' | 'byWord' | 'byChar';
export type MorphEasing = NonNullable<SlideTransition['easing']>;

/* ───────────── 가감속 ───────────── */

/** CSS cubic-bezier(x1, y1, x2, y2): x(s) = t를 뉴턴법·이분법으로 풀어 y(s) */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let k = 0; k < 8; k++) {
      const e = sx(s) - t;
      if (Math.abs(e) < 1e-6) return sy(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let k = 0; k < 40; k++) {
      const v = sx(s);
      if (Math.abs(v - t) < 1e-6) break;
      if (v < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sy(s);
  };
}

const EASINGS: Record<Exclude<MorphEasing, 'cubicBezier'>, (t: number) => number> = {
  linear: (t) => t,
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
};

/** 전환 설정 → 가감속 함수 (기본 easeInOut) */
export function easingOf(t?: Pick<SlideTransition, 'easing' | 'bezier'>): (p: number) => number {
  const e = t?.easing ?? 'easeInOut';
  if (e === 'cubicBezier') {
    const [x1, y1, x2, y2] = t?.bezier ?? [0.25, 0.1, 0.25, 1];
    return cubicBezier(Math.max(0, Math.min(1, x1)), y1, Math.max(0, Math.min(1, x2)), y2);
  }
  return EASINGS[e] ?? EASINGS.easeInOut;
}

export const morphEase = EASINGS.easeInOut;

/* ───────────── 짝짓기 ───────────── */

const textOf = (b: TextBody) => b.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');

export function objectText(o: SlideObject): string {
  if (o.type === 'text' || o.type === 'shape') return textOf(o.text);
  if (o.type === 'group') return o.children.map(objectText).join(' ');
  if (o.type === 'table') return o.rows.map((r) => r.cells.map((c) => textOf(c.text)).join('\t')).join('\n');
  if (o.type === 'equation') return o.latex;
  return '';
}

/** 짝지을 수 있는 계열: 텍스트 상자·도형은 같은 계열 (모양만 다름) */
const kindOf = (o: SlideObject) => (o.type === 'text' || o.type === 'shape' ? 'textlike' : o.type);
const shapeKind = (o: SlideObject) => (o.type === 'shape' ? o.shape : o.type === 'text' ? 'rect' : o.type);
const assetOf = (o: SlideObject) => (o.type === 'image' || o.type === 'media' ? o.assetId : o.type === 'extension' ? (o.assetId ?? '') : '');
const keyOf = (o: SlideObject) => o.morphKey ?? o.id;
const isBang = (o: SlideObject) => o.name.startsWith('!!');

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

/** 자동 짝 점수 (-1 = 짝이 될 수 없음). 최대 약 13 */
export function matchScore(a: SlideObject, b: SlideObject): number {
  if (isBang(a) || isBang(b)) return -1; // '!!' 개체는 이름으로만
  if (kindOf(a) !== kindOf(b)) return -1;
  let s = 0;
  if (a.name && a.name === b.name) s += 3;
  const ta = objectText(a), tb = objectText(b);
  if (ta || tb) s += ta === tb ? 8 : 5 * similarity(ta, tb);
  if (kindOf(a) === 'textlike') s += shapeKind(a) === shapeKind(b) ? 2 : 0;
  else if (a.type === 'image' || a.type === 'media' || a.type === 'extension') {
    // 다른 그림·미디어는 이름이 같아도 자동으로 짝짓지 않음 (morphKey·'!!' 이름으로는 가능)
    if (!assetOf(a) || assetOf(a) !== assetOf(b)) return -1;
    s += 8;
  } else s += 2;
  return s;
}

export type MatchReason = 'morphKey' | 'name' | 'auto';

export interface MorphPair {
  from: SlideObject;
  to: SlideObject;
  reason: MatchReason;
  /** 자동 짝의 신뢰도 0..1 */
  confidence: number;
  /** 자동 짝 후보가 비슷한 점수로 둘 이상 (사용자에게 확인을 권함) */
  ambiguous?: boolean;
}

export interface MorphMatch {
  pairs: MorphPair[];
  gone: SlideObject[];
  added: SlideObject[];
  /** 같은 '!!' 이름이 한 슬라이드에 여럿 등 */
  warnings: string[];
}

export const AUTO_THRESHOLD = 2;

export function matchMorph(from: SlideObject[], to: SlideObject[]): MorphMatch {
  const usedA = new Set<SlideObject>(), usedB = new Set<SlideObject>();
  const pairs: MorphPair[] = [];
  const warnings: string[] = [];
  const pair = (a: SlideObject, b: SlideObject, reason: MatchReason, confidence = 1, ambiguous = false) => {
    usedA.add(a);
    usedB.add(b);
    pairs.push({ from: a, to: b, reason, confidence, ...(ambiguous ? { ambiguous } : {}) });
  };
  const free = (o: SlideObject) => !o.morphExclude;
  // 1) 같은 morphKey
  const byKey = new Map<string, SlideObject>();
  for (const a of from) if (free(a) && !byKey.has(keyOf(a))) byKey.set(keyOf(a), a);
  for (const b of to) {
    const a = byKey.get(keyOf(b));
    if (a && free(b) && !usedA.has(a) && !usedB.has(b)) pair(a, b, 'morphKey');
  }
  // 2) '!!' 이름
  const dup = (list: SlideObject[], where: string) => {
    const seen = new Map<string, number>();
    for (const o of list) if (isBang(o)) seen.set(o.name, (seen.get(o.name) ?? 0) + 1);
    for (const [n, c] of seen) if (c > 1) warnings.push(`${where} 슬라이드에 '${n}' 이름이 ${c}개 있습니다. 첫 번째 것만 연결합니다.`);
  };
  dup(from, '이전');
  dup(to, '다음');
  for (const b of to) {
    if (usedB.has(b) || !isBang(b) || !free(b)) continue;
    const a = from.find((x) => !usedA.has(x) && free(x) && x.name === b.name);
    if (a) pair(a, b, 'name');
  }
  // 3) 자동 (점수 높은 짝부터)
  const restA = from.filter((a) => !usedA.has(a) && free(a)), restB = to.filter((b) => !usedB.has(b) && free(b));
  const cand: { a: SlideObject; b: SlideObject; s: number }[] = [];
  restA.forEach((a, i) =>
    restB.forEach((b, j) => {
      const s = matchScore(a, b);
      if (s >= AUTO_THRESHOLD) cand.push({ a, b, s: s - Math.abs(i / Math.max(1, restA.length) - j / Math.max(1, restB.length)) * 0.01 });
    }),
  );
  cand.sort((x, y) => y.s - x.s);
  for (const c of cand) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    // 모호함: 같은 대상에 거의 같은 점수의 다른 후보가 있음
    const rivals = cand.filter((x) => x !== c && !usedA.has(x.a) && !usedB.has(x.b) && (x.a === c.a || x.b === c.b) && c.s - x.s < 0.5);
    pair(c.a, c.b, 'auto', Math.min(1, c.s / 13), rivals.length > 0);
  }
  return { pairs, gone: from.filter((a) => !usedA.has(a)), added: to.filter((b) => !usedB.has(b)), warnings };
}

/* ───────────── 사이값 ───────────── */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rgb(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '') ?? /^#?([0-9a-f]{3})$/i.exec(c ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lerpColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
  if (!a || !b) return t < 0.5 ? a : b;
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return t < 0.5 ? a : b;
  return `#${x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** 회전: 가까운 쪽으로 (350° → 10°는 20°만). 차이가 360° 이상이면 사용자가 정한 여러 바퀴로 보고 그대로 */
export function lerpAngle(a: number, b: number, t: number): number {
  if (Math.abs(b - a) >= 360) return lerp(a, b, t);
  let d = ((((b - a) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  return a + d * t;
}

function lerpStops(a: GradientStop[], b: GradientStop[], t: number): GradientStop[] | null {
  if (a.length !== b.length) return null;
  return b.map((s, i) => ({ ...s, offset: lerp(a[i].offset, s.offset, t), color: lerpColor(a[i].color, s.color, t)! }));
}

function lerpFill(a: Fill, b: Fill, t: number): Fill {
  if (a.type === 'solid' && b.type === 'solid') return { type: 'solid', color: lerpColor(a.color, b.color, t)!, opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t) };
  if (a.type === 'none' && b.type === 'solid') return { ...b, opacity: (b.opacity ?? 1) * t };
  if (a.type === 'solid' && b.type === 'none') return { ...a, opacity: (a.opacity ?? 1) * (1 - t) };
  if (a.type === 'gradient' && b.type === 'gradient') {
    const stops = lerpStops(a.stops, b.stops, t);
    if (stops) return { type: 'gradient', angle: lerpAngle(a.angle, b.angle, t), stops };
  }
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

/** 도형 계열의 0..1 정규화 경로 */
const unitPath = (o: SlideObject): string | null => (o.type === 'shape' ? shapePath(o.shape, 1, 1, o.geometry) : o.type === 'text' ? shapePath('rect', 1, 1) : null);

/** 모양이 같은지 (같은 프리셋이면 크기만 바뀌므로 경로 모핑이 필요 없음) */
const sameShape = (a: SlideObject, b: SlideObject) => shapeKind(a) === shapeKind(b) && (a.type !== 'shape' || b.type !== 'shape' || a.shape !== 'custom' || JSON.stringify(a.geometry) === JSON.stringify(b.geometry));

/** 글자·그림이 같은지 (한 개체로 사이값을 그릴 수 있는지; 도형 모양은 경로 모핑으로 따로) */
export function sameContent(a: SlideObject, b: SlideObject): boolean {
  if (kindOf(a) !== kindOf(b)) return false;
  if (kindOf(a) !== 'textlike' && a.type !== b.type) return false;
  if (objectText(a) !== objectText(b)) return false;
  if (assetOf(a) !== assetOf(b)) return false;
  if (a.type === 'equation' && b.type === 'equation') return a.latex === b.latex;
  return true;
}

/** 짝지은 두 개체의 t 시점 모습 (b를 바탕으로). path: 미리 준비한 경로 모핑 */
export function lerpObject(a: SlideObject, b: SlideObject, t: number, path?: PathMorph | null): { obj: SlideObject; frame: Frame } {
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
  // 그림 자르기 영역 (같은 그림의 확대·이동)
  if (a.type === 'image' && b.type === 'image') {
    const ca = a.crop, cb = b.crop;
    o.crop = { left: lerp(ca.left, cb.left, t), top: lerp(ca.top, cb.top, t), right: lerp(ca.right, cb.right, t), bottom: lerp(ca.bottom, cb.bottom, t) } as ImageObject['crop'];
  }
  // 도형 모양 바꾸기: 경로 모핑 결과를 사용자 지정 도형으로
  if (path) {
    const s = o as unknown as ShapeObject;
    s.type = 'shape';
    s.shape = 'custom';
    s.geometry = pathMorphAt(path, t);
    if (!s.fill) s.fill = { type: 'none' };
    if (s.stroke === undefined) s.stroke = null;
    delete (s as { sourcePreset?: string }).sourcePreset;
  }
  // 뒤집기가 바뀌면 가로(세로) 배율이 -1 → 1로 지나가며 뒤집힘 (b의 뒤집기 기준)
  const frame: Frame = {};
  if (!!a.flipH !== !!b.flipH) frame.sx = 2 * t - 1;
  if (!!a.flipV !== !!b.flipV) frame.sy = 2 * t - 1;
  return { obj: o as SlideObject, frame };
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
  style: { fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string; color: string; textDecoration?: string; letterSpacing?: string };
}

export interface TokenSprite extends MorphToken {
  key: string;
  opacity: number;
}

/**
 * 글자 묶음 짝: ① 최장 공통 부분열(LCS)로 순서가 유지되는 같은 글자 묶음을 먼저 짝짓고
 * ② 남은 같은 글자 묶음은 원래 순서가 가장 가까운 것끼리 (자리를 바꾼 단어·문자) ③ 나머지는 사라짐/나타남
 * 반환: to 순서의 짝 인덱스 (-1 = 새 묶음)
 */
export function matchTokens(from: string[], to: string[]): number[] {
  const n = from.length, m = to.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = from[i] === to[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const res = new Array<number>(m).fill(-1);
  const used = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (from[i] === to[j]) {
      res[j] = i;
      used.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  to.forEach((tx, j) => {
    if (res[j] >= 0) return;
    let best = -1, dist = Infinity;
    from.forEach((fx, i) => {
      if (used.has(i) || fx !== tx) return;
      const d = Math.abs(i / Math.max(1, n) - j / Math.max(1, m));
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best >= 0) {
      res[j] = best;
      used.add(best);
    }
  });
  return res;
}

export interface TokenPlan {
  key: string;
  from: MorphToken[];
  to: MorphToken[];
  /** to 순서의 짝 (from 인덱스, -1 = 새 묶음) */
  map: number[];
}

export function planTokens(from: MorphToken[], to: MorphToken[], key: string): TokenPlan {
  return { key, from, to, map: matchTokens(from.map((x) => x.text), to.map((x) => x.text)) };
}

export function tokensAt(p: TokenPlan, t: number): TokenSprite[] {
  const out: TokenSprite[] = [];
  const used = new Set<number>();
  p.to.forEach((b, j) => {
    const i = p.map[j];
    if (i >= 0) {
      used.add(i);
      const a = p.from[i];
      out.push({
        ...b,
        key: `${p.key}:m${j}`,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t),
        style: { ...b.style, fontSize: lerp(a.style.fontSize, b.style.fontSize, t), color: lerpColor(a.style.color, b.style.color, t)! },
        opacity: 1,
      });
    } else out.push({ ...b, key: `${p.key}:n${j}`, opacity: t });
  });
  p.from.forEach((a, i) => {
    if (!used.has(i)) out.push({ ...a, key: `${p.key}:o${i}`, opacity: 1 - t });
  });
  return out;
}

/** 예전 이름 (테스트·호환): 한 번에 짝짓고 t 시점 */
export const morphTokens = (from: MorphToken[], to: MorphToken[], t: number, key: string) => tokensAt(planTokens(from, to, key), t);

/* ───────────── 계획·장면 ───────────── */

export interface MorphScene {
  /** 그릴 개체 (앞→뒤 순서) */
  objects: SlideObject[];
  /** 개체 ID → 불투명도·뒤집기 배율 */
  frames: Map<string, Frame>;
  /** 단어/문자 옵션의 글자 묶음 */
  tokens: TokenSprite[];
}

type Step =
  | { kind: 'fade'; obj: SlideObject; id: string; dir: 'out' | 'in' }
  | { kind: 'morph'; a: SlideObject; b: SlideObject; id: string; path: PathMorph | null }
  | { kind: 'cross'; a: SlideObject; b: SlideObject; idA: string; idB: string }
  | { kind: 'words'; a: SlideObject; b: SlideObject; id: string; tokens: TokenPlan };

export interface MorphPlan {
  match: MorphMatch;
  steps: Step[];
  ease: (p: number) => number;
}

export interface MorphInput {
  from: SlideObject[];
  to: SlideObject[];
  option?: MorphOption;
  /** 단어/문자 옵션: 개체 ID → 화면에서 잰 글자 묶음 (from·to 모두) */
  tokens?: Map<string, MorphToken[]>;
  easing?: Pick<SlideTransition, 'easing' | 'bezier'>;
}

/** 전환 시작 때 한 번: 짝짓기·경로 샘플링·글자 묶음 짝 */
export function buildMorphPlan({ from, to, option = 'byObject', tokens, easing }: MorphInput): MorphPlan {
  const match = matchMorph(from, to);
  const steps: Step[] = [];
  for (const o of match.gone) steps.push({ kind: 'fade', obj: o, id: `mo:${o.id}`, dir: 'out' });
  // 다음 슬라이드의 쌓는 순서대로
  const order = new Map(to.map((o, i) => [o.id, i]));
  const sorted = [...match.pairs].sort((x, y) => (order.get(x.to.id) ?? 0) - (order.get(y.to.id) ?? 0));
  for (const { from: a, to: b } of sorted) {
    const textlike = kindOf(a) === 'textlike';
    if (sameContent(a, b)) {
      let path: PathMorph | null = null;
      if (textlike && !sameShape(a, b)) {
        const pa = unitPath(a), pb = unitPath(b);
        path = pa && pb ? preparePathMorph(pa, pb) : null;
        // 경로를 맞출 수 없으면(윤곽 수가 다름) 교차 전환
        if (!path) {
          steps.push({ kind: 'cross', a, b, idA: `mx:${a.id}`, idB: `mp:${b.id}` });
          continue;
        }
      }
      steps.push({ kind: 'morph', a, b, id: `mp:${b.id}`, path });
      continue;
    }
    const ta = tokens?.get(a.id), tb = tokens?.get(b.id);
    if (option !== 'byObject' && textlike && ta && tb && !a.rotation && !b.rotation) {
      steps.push({ kind: 'words', a, b, id: `mp:${b.id}`, tokens: planTokens(ta, tb, b.id) });
      continue;
    }
    steps.push({ kind: 'cross', a, b, idA: `mx:${a.id}`, idB: `mp:${b.id}` });
  }
  for (const o of match.added) steps.push({ kind: 'fade', obj: o, id: `mn:${o.id}`, dir: 'in' });
  return { match, steps, ease: easingOf(easing) };
}

/** 진행률 p(0..1, 가감속 전)의 장면 */
export function morphFrame(plan: MorphPlan, p: number): MorphScene {
  const t = plan.ease(Math.max(0, Math.min(1, p)));
  const objects: SlideObject[] = [];
  const frames = new Map<string, Frame>();
  const sprites: TokenSprite[] = [];
  const put = (o: SlideObject, id: string, opacity: number, extra: Frame = {}) => {
    if (opacity <= 0.001) return;
    objects.push({ ...o, id } as SlideObject);
    frames.set(id, { ...extra, opacity });
  };
  for (const s of plan.steps) {
    if (s.kind === 'fade') put(s.obj, s.id, s.dir === 'out' ? 1 - t : t);
    else if (s.kind === 'morph') {
      const g = lerpObject(s.a, s.b, t, s.path);
      put(g.obj, s.id, 1, g.frame);
    } else if (s.kind === 'words') {
      // 상자는 글자 없이 움직이고, 글자는 묶음 단위로
      const g = lerpObject(s.a, s.b, t);
      const box = { ...g.obj, text: { ...(g.obj as { text: TextBody }).text, paragraphs: [{ runs: [{ text: '' }] }] } } as SlideObject;
      put(box, s.id, 1, g.frame);
      sprites.push(...tokensAt(s.tokens, t));
    } else {
      // 내용이 다름: 사이값 자리에서 앞 개체는 사라지고 뒤 개체가 나타남
      const gb = lerpObject(s.a, s.b, t);
      const ga = lerpObject(s.b, s.a, 1 - t);
      put(ga.obj, s.idA, 1 - t, ga.frame);
      put(gb.obj, s.idB, t, gb.frame);
    }
  }
  return { objects, frames, tokens: sprites };
}

/** 한 번에 계획 + 장면 (테스트·간단한 호출용) */
export function morphScene(input: MorphInput & { p: number }): MorphScene {
  return morphFrame(buildMorphPlan(input), input.p);
}

/**
 * 글자 묶음 나누기: 단어 또는 문자(그래핌 = 이모지·결합 문자도 한 글자).
 * 단어는 Intl.Segmenter의 단어 경계를 쓰되, 공백 없이 붙은 단어 조각(예: 2026|년)은 한 단어로 합침. 문장 부호는 따로.
 */
export function splitTokens(text: string, option: MorphOption): string[] {
  return segmentText(text, option).filter((x) => !/^\s+$/.test(x));
}

type Seg = { segment: string; isWordLike?: boolean };
type Segmenter = new (l?: string, o?: { granularity: 'word' | 'grapheme' }) => { segment(s: string): Iterable<Seg> };

/** 공백을 포함한 글자 묶음 목록 (이어 붙이면 원래 글자) */
export function segmentText(text: string, option: MorphOption): string[] {
  const S = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;
  if (option === 'byChar') return S ? [...new S(undefined, { granularity: 'grapheme' }).segment(text)].map((x) => x.segment) : [...text];
  if (!S) return text.split(/(\s+)/).filter(Boolean);
  const out: { s: string; word: boolean }[] = [];
  for (const g of new S(undefined, { granularity: 'word' }).segment(text)) {
    const last = out[out.length - 1];
    const word = !!g.isWordLike;
    if (word && last?.word) last.s += g.segment;
    else out.push({ s: g.segment, word });
  }
  return out.map((x) => x.s);
}
