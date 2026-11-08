/**
 * 프레젠테이션 비교 (PowerPoint: 검토 › 비교).
 * 다른 파일(검토본)과 현재 문서를 비교해 변경 목록을 만들고, 변경을 하나씩(또는 모두) 현재 문서에 적용한다.
 * 파일이 다르면 ID가 다르므로 슬라이드·개체는 내용 유사도로 짝짓는다 (슬라이드: 순서를 지키는 최장 공통 부분열).
 */
import type { Presentation, Slide, SlideObject, TextBody } from '../../types/model';
import { designLayers } from '../../engines/rendering/SlideView';

export type ChangeKind = 'slideInserted' | 'slideDeleted' | 'objectInserted' | 'objectDeleted' | 'textChanged' | 'objectMoved' | 'objectFormatted' | 'notesChanged' | 'slideFormatted';

export interface Change {
  id: string;
  kind: ChangeKind;
  /** 현재 문서 슬라이드 (삽입된 슬라이드면 그 앞 슬라이드, 맨 앞이면 null) */
  slideId: string | null;
  /** 검토본 슬라이드 */
  otherSlideId?: string;
  objectId?: string;
  otherObjectId?: string;
  label: string;
  /** 글자 변경: 낱말 단위 차이 */
  diff?: DiffPart[];
}

export interface DiffPart {
  op: 'same' | 'add' | 'del';
  text: string;
}

/* ───────────── 글자 ───────────── */

export function bodyText(b: TextBody): string {
  return b.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

function objectText(o: SlideObject): string {
  if (o.type === 'text' || o.type === 'shape') return bodyText(o.text);
  if (o.type === 'group') return o.children.map(objectText).join(' ');
  if (o.type === 'table') return o.rows.map((r) => r.cells.map((c) => bodyText(c.text)).join('\t')).join('\n');
  // 수식: 같은 수식도 LaTeX 표기는 다를 수 있으므로(PPTX를 거치면 m{c}^{2} 등) 표시되는 글자로 비교
  if (o.type === 'equation') return o.mathml.replace(/<[^>]+>/g, '').replace(/[\u2061-\u2063\s]/g, '');
  if (o.type === 'chart') return o.title ?? '';
  return '';
}

export const slideText = (s: Slide) => s.objects.map(objectText).join('\n');

const words = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** 낱말 단위 차이 (최장 공통 부분열) */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = words(a), y = words(b);
  const n = x.length, m = y.length;
  // 너무 길면 통째로
  if (n * m > 400000) return [...(a ? [{ op: 'del' as const, text: a }] : []), ...(b ? [{ op: 'add' as const, text: b }] : [])];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], t: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += t;
    else out.push({ op, text: t });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) push('same', x[i++]), j++;
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}

/** 0~1 유사도 (낱말 집합 다이스 계수) */
export function similarity(a: string, b: string): number {
  const A = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/* ───────────── 짝짓기 ───────────── */

/** 순서를 지키며 유사한 슬라이드 짝짓기 (가중 LCS) */
export function matchSlides(a: Slide[], b: Slide[], threshold = 0.4): [number, number][] {
  const ta = a.map(slideText), tb = b.map(slideText);
  const sim = ta.map((x) => tb.map((y) => similarity(x, y)));
  const n = a.length, m = b.length;
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const take = sim[i][j] >= threshold ? S[i + 1][j + 1] + sim[i][j] : -1;
      S[i][j] = Math.max(take, S[i + 1][j], S[i][j + 1]);
    }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (sim[i][j] >= threshold && S[i][j] === S[i + 1][j + 1] + sim[i][j]) pairs.push([i++, j++]);
    else if (S[i + 1][j] >= S[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const geomChanged = (a: SlideObject, b: SlideObject) => ['x', 'y', 'width', 'height', 'rotation'].some((k) => Math.abs((a as unknown as Record<string, number>)[k] - (b as unknown as Record<string, number>)[k]) > 0.5);

/** 보이는 서식만 비교 (채우기·선·모양·투명도·뒤집기·자르기·화살표·수식 크기/색) — 저장 형식 차이(개체 틀 여부 등)는 무시 */
function formatKey(o: SlideObject, doc: Presentation): string {
  const r = o as unknown as Record<string, unknown>;
  const pick = ['fill', 'stroke', 'shape', 'opacity', 'flipH', 'flipV', 'crop', 'headStart', 'headEnd', 'fontSize', 'color', 'assetId'];
  // 그림은 파일마다 자산 ID가 다르므로 내용으로 비교
  const asset = (id: unknown) => {
    const a = typeof id === 'string' ? doc.assets[id] : undefined;
    return a ? `${a.mime}:${a.size ?? ''}:${hashString(a.dataUrl || a.blobKey || '')}` : null;
  };
  const norm = (k: string) => {
    if (k === 'opacity') return r[k] ?? 1;
    if (k === 'flipH' || k === 'flipV') return !!r[k];
    // 미디어는 한쪽이 data URL, 다른 쪽이 IndexedDB 바이너리일 수 있어 내용 비교 불가 → 서식 비교에서 제외
    if (k === 'assetId') return o.type === 'media' ? null : asset(r[k]);
    if (k === 'fill' && r.fill && typeof r.fill === 'object' && (r.fill as { type: string }).type === 'image') return { ...(r.fill as object), assetId: asset((r.fill as { assetId: string }).assetId) };
    return r[k] ?? null;
  };
  return JSON.stringify(pick.map(norm));
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16) + s.length;
}

/** 글자 상자와 도형은 PPTX를 거치면 서로 바뀔 수 있으므로 같은 종류로 봄 */
const kindOf = (o: SlideObject) => (o.type === 'text' || o.type === 'shape' ? 'textlike' : o.type);

/** 화면에 보이지 않는 빈 개체 틀 (안내 문구만 있는 제목·내용 칸) */
export function isEmptyPlaceholder(o: SlideObject): boolean {
  return o.type === 'text' && !!o.ph && o.fill.type === 'none' && !o.stroke && !bodyText(o.text).trim();
}

/** 개체 짝짓기: 같은 종류 중 (개체 틀 종류 > 이름 > 글자 유사도 > 위치) */
function matchObjects(a: SlideObject[], b: SlideObject[]): [SlideObject, SlideObject][] {
  const used = new Set<string>();
  const pairs: [SlideObject, SlideObject][] = [];
  const score = (x: SlideObject, y: SlideObject) => {
    if (kindOf(x) !== kindOf(y)) return -1;
    let s = 0;
    const px = 'ph' in x ? x.ph : undefined, py = 'ph' in y ? y.ph : undefined;
    if (px && py && px.type === py.type) s += 3;
    if (x.name && x.name === y.name) s += 1;
    s += 2 * similarity(objectText(x), objectText(y));
    const d = Math.hypot(x.x - y.x, x.y - y.y);
    s += Math.max(0, 1 - d / 400);
    return s;
  };
  const cands: { x: SlideObject; y: SlideObject; s: number }[] = [];
  for (const x of a) for (const y of b) {
    const s = score(x, y);
    if (s >= 1.2) cands.push({ x, y, s });
  }
  cands.sort((p, q) => q.s - p.s);
  const usedA = new Set<string>();
  for (const c of cands) {
    if (usedA.has(c.x.id) || used.has(c.y.id)) continue;
    usedA.add(c.x.id);
    used.add(c.y.id);
    pairs.push([c.x, c.y]);
  }
  return pairs;
}

const TYPE_NAME: Record<SlideObject['type'], string> = { text: '텍스트 상자', shape: '도형', line: '선', image: '그림', group: '그룹', table: '표', chart: '차트', media: '미디어', equation: '수식', unsupported: '개체' };
const nameOf = (o: SlideObject) => {
  const t = objectText(o).replace(/\s+/g, ' ').trim();
  return `${TYPE_NAME[o.type]}${t ? ` "${t.length > 24 ? `${t.slice(0, 24)}…` : t}"` : o.name ? ` (${o.name})` : ''}`;
};

/* ───────────── 비교 ───────────── */

export function comparePresentations(cur: Presentation, other: Presentation): Change[] {
  const out: Change[] = [];
  let seq = 0;
  const add = (c: Omit<Change, 'id'>) => out.push({ ...c, id: `ch${seq++}` });
  const pairs = matchSlides(cur.slides, other.slides);
  const matchedA = new Set(pairs.map((p) => p[0]));
  const matchedB = new Set(pairs.map((p) => p[1]));
  // 삭제된 슬라이드 (현재에는 있고 검토본에는 없음)
  cur.slides.forEach((s, i) => {
    if (!matchedA.has(i)) add({ kind: 'slideDeleted', slideId: s.id, label: `슬라이드 ${i + 1} 삭제됨` });
  });
  // 삽입된 슬라이드: 검토본에서 바로 앞의 짝지어진 슬라이드 뒤에
  other.slides.forEach((s, j) => {
    if (matchedB.has(j)) return;
    const prev = [...pairs].reverse().find((p) => p[1] < j);
    add({ kind: 'slideInserted', slideId: prev ? cur.slides[prev[0]].id : null, otherSlideId: s.id, label: `슬라이드 삽입됨 (검토본 ${j + 1}번)${slideText(s).trim() ? `: ${slideText(s).split('\n')[0].slice(0, 30)}` : ''}` });
  });
  for (const [i, j] of pairs) {
    const a = cur.slides[i], b = other.slides[j];
    const base = { slideId: a.id, otherSlideId: b.id };
    const visA = a.objects.filter((o) => !isEmptyPlaceholder(o)), visB = b.objects.filter((o) => !isEmptyPlaceholder(o));
    const objs = matchObjects(visA, visB);
    const pa = new Set(objs.map((p) => p[0].id)), pb = new Set(objs.map((p) => p[1].id));
    for (const o of visA) if (!pa.has(o.id)) add({ ...base, kind: 'objectDeleted', objectId: o.id, label: `${nameOf(o)} 삭제됨` });
    for (const o of visB) if (!pb.has(o.id)) add({ ...base, kind: 'objectInserted', otherObjectId: o.id, label: `${nameOf(o)} 삽입됨` });
    for (const [x, y] of objs) {
      const tx = objectText(x), ty = objectText(y);
      if (tx !== ty) add({ ...base, kind: 'textChanged', objectId: x.id, otherObjectId: y.id, label: `${TYPE_NAME[x.type]} 글자 변경`, diff: diffWords(tx, ty) });
      if (geomChanged(x, y)) add({ ...base, kind: 'objectMoved', objectId: x.id, otherObjectId: y.id, label: `${nameOf(x)} 위치·크기 변경` });
      if (x.type === y.type && formatKey(x, cur) !== formatKey(y, other)) add({ ...base, kind: 'objectFormatted', objectId: x.id, otherObjectId: y.id, label: `${nameOf(x)} 서식 변경` });
    }
    if ((a.notes ?? '') !== (b.notes ?? '')) add({ ...base, kind: 'notesChanged', label: '노트 변경', diff: diffWords(a.notes ?? '', b.notes ?? '') });
    // 실제로 보이는 배경(테마·레이아웃 상속 포함)과 전환(없음 = 'none')으로 비교
    const bgA = JSON.stringify(designLayers(a, cur).bg), bgB = JSON.stringify(designLayers(b, other).bg);
    const tr = (t: Slide['transition']) => (t && t.type !== 'none' ? JSON.stringify({ type: t.type, duration: t.duration, direction: t.direction ?? null, after: t.advanceAfter ?? null }) : t?.advanceAfter ? `after:${t.advanceAfter}` : 'none');
    if (bgA !== bgB || tr(a.transition) !== tr(b.transition) || !!a.hidden !== !!b.hidden)
      add({ ...base, kind: 'slideFormatted', label: '슬라이드 배경·전환·숨기기 변경' });
  }
  // 슬라이드 순서대로
  const order = (c: Change) => (c.slideId ? cur.slides.findIndex((s) => s.id === c.slideId) : -1) + (c.kind === 'slideInserted' ? 0.5 : 0);
  return out.sort((p, q) => order(p) - order(q));
}

/* ───────────── 적용 ───────────── */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newIdLike = () => Math.random().toString(36).slice(2, 12);

/** 개체가 쓰는 자산(그림·미디어·표지) ID */
function assetIds(o: SlideObject): string[] {
  if (o.type === 'image') return [o.assetId];
  if (o.type === 'media') return [o.assetId, ...(o.posterId ? [o.posterId] : [])];
  if (o.type === 'group') return o.children.flatMap(assetIds);
  const f = 'fill' in o ? o.fill : undefined;
  return f && f.type === 'image' ? [f.assetId] : [];
}

function copyAssets(d: Presentation, other: Presentation, objs: SlideObject[], bg?: Slide['background']) {
  const ids = [...objs.flatMap(assetIds), ...(bg?.fill?.type === 'image' ? [bg.fill.assetId] : [])];
  for (const id of ids) if (other.assets[id] && !d.assets[id]) d.assets[id] = clone(other.assets[id]);
}

/** 개체 복사: 새 ID (그룹 안까지), 원본 보존 정보는 버림 (다른 파일의 원본 패키지를 참조하므로) */
function freshCopy(o: SlideObject): SlideObject {
  const c = clone(o) as SlideObject & { preserved?: unknown };
  const walk = (x: SlideObject) => {
    x.id = newIdLike();
    delete (x as { sourceId?: number }).sourceId;
    if ('preserved' in x) delete (x as { preserved?: unknown }).preserved;
    if (x.type === 'group') x.children.forEach(walk);
  };
  walk(c);
  return c;
}

/**
 * 글자 변경 적용: 검토본의 글자(문단·글자 묶음 나눔)를 쓰되 서식은 현재 문서 것을 유지.
 * PPTX를 거친 검토본은 개체 틀에서 물려받던 서식이 기본값으로 바뀌어 있을 수 있으므로 서식까지 가져오지 않는다.
 */
function withCurrentFormat(cur: TextBody, other: TextBody): TextBody['paragraphs'] {
  const fallback = cur.paragraphs[cur.paragraphs.length - 1];
  return other.paragraphs.map((op, i) => {
    const cp = cur.paragraphs[i] ?? fallback;
    const style = { ...(cp?.runs[0] ?? {}) };
    delete (style as { text?: string }).text;
    return { ...clone(cp ?? op), runs: op.runs.map((r) => ({ ...clone(style), text: r.text })) } as TextBody['paragraphs'][number];
  });
}

/** 변경 적용 (검토본 내용으로). 적용하면 true */
export function applyChange(d: Presentation, other: Presentation, ch: Change): boolean {
  const slide = ch.slideId ? d.slides.find((s) => s.id === ch.slideId) : undefined;
  const os = ch.otherSlideId ? other.slides.find((s) => s.id === ch.otherSlideId) : undefined;
  switch (ch.kind) {
    case 'slideDeleted': {
      if (!slide || d.slides.length <= 1) return false;
      d.slides = d.slides.filter((s) => s !== slide);
      return true;
    }
    case 'slideInserted': {
      if (!os) return false;
      const s = clone(os);
      s.id = newIdLike();
      s.objects = os.objects.map(freshCopy);
      delete s.source;
      delete s.comments;
      copyAssets(d, other, os.objects, os.background);
      // 레이아웃이 현재 문서에 없으면 첫 레이아웃
      if (!d.layouts?.[s.layout]) s.layout = d.slides[0]?.layout ?? s.layout;
      const at = ch.slideId ? d.slides.findIndex((x) => x.id === ch.slideId) + 1 : 0;
      d.slides.splice(Math.max(0, at), 0, s);
      return true;
    }
    case 'objectDeleted': {
      if (!slide) return false;
      const n = slide.objects.length;
      slide.objects = slide.objects.filter((o) => o.id !== ch.objectId);
      if (slide.animations) slide.animations = slide.animations.filter((a) => a.targetId !== ch.objectId);
      return slide.objects.length !== n;
    }
    case 'objectInserted': {
      const o = os?.objects.find((x) => x.id === ch.otherObjectId);
      if (!slide || !o) return false;
      copyAssets(d, other, [o]);
      // 검토본의 쌓는 순서를 비슷하게: 검토본에서 바로 앞 개체와 짝인 개체 뒤 (없으면 맨 위)
      slide.objects.push(freshCopy(o));
      return true;
    }
    case 'textChanged':
    case 'objectMoved':
    case 'objectFormatted': {
      const x = slide?.objects.find((o) => o.id === ch.objectId);
      const y = os?.objects.find((o) => o.id === ch.otherObjectId);
      if (!x || !y || kindOf(x) !== kindOf(y)) return false;
      if (ch.kind === 'textChanged') {
        if ((x.type === 'text' || x.type === 'shape') && (y.type === 'text' || y.type === 'shape')) x.text.paragraphs = withCurrentFormat(x.text, y.text);
        else if (x.type === 'table' && y.type === 'table') x.rows = clone(y.rows);
        else if (x.type === 'equation' && y.type === 'equation') Object.assign(x, { latex: y.latex, mathml: y.mathml, sourceOmml: y.sourceOmml });
        else return false;
      } else if (ch.kind === 'objectMoved') {
        Object.assign(x, { x: y.x, y: y.y, width: y.width, height: y.height, rotation: y.rotation });
      } else {
        // 서식: 위치·글자·ID를 뺀 나머지 속성
        const keep = { id: x.id, x: x.x, y: x.y, width: x.width, height: x.height, rotation: x.rotation, name: x.name, ...('text' in x ? { text: x.text } : {}), ...(x.type === 'table' ? { rows: x.rows } : {}) };
        copyAssets(d, other, [y]);
        const next = { ...clone(y), ...keep } as SlideObject;
        delete (next as { sourceId?: number }).sourceId;
        const idx = slide!.objects.indexOf(x);
        slide!.objects[idx] = next;
      }
      return true;
    }
    case 'notesChanged':
      if (!slide || !os) return false;
      slide.notes = os.notes;
      return true;
    case 'slideFormatted':
      if (!slide || !os) return false;
      copyAssets(d, other, [], os.background);
      slide.background = clone(os.background);
      if (os.transition) slide.transition = clone(os.transition);
      else delete slide.transition;
      if (os.hidden) slide.hidden = true;
      else delete slide.hidden;
      return true;
  }
}
