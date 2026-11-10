/**
 * 도형 병합 엔진 (PowerPoint: 도형 서식 › 도형 병합 — 통합·결합·조각·교차·빼기).
 * 실제 기하 영역을 불 연산으로 계산해 새 벡터 경로(사용자 지정 도형, 0..1 좌표의 M·L·C·Z)를 만든다. 그림으로 바꾸거나 가리는 방식이 아님.
 *
 * 구성
 *  A. 도형 → 경로 어댑터: 프리셋 도형(사각형·원·별·화살표 …)과 자유형·여러 하위 경로 도형을 SVG 경로로 (shapeGeometry.shapePath)
 *  B. 좌표 변환: 화면 렌더러와 같은 아핀 행렬 — 이동·회전(가운데 기준)·뒤집기(도형 내용), 그룹은 이동·회전, 그룹 안 그룹까지 곱함
 *  C. 불 연산: Paper.js 0.12.18 (MIT) — 베지어 곡선끼리 교차점을 구해 경계를 나누고 감김 수로 분류·재연결 (곡선을 다각형으로 바꾸지 않음)
 *     통합 = A∪B∪…, 결합 = A⊕B⊕… (홀수 번 덮인 곳), 교차 = A∩B∩…, 빼기 = 첫 선택 − (나머지의 합)
 *     조각 = 평면 분할: 도형을 하나씩 더하며 기존 조각마다 (조각∩새 도형, 조각−새 도형), 새 도형에서 기존 합을 뺀 나머지를 더함
 *            → 각 영역은 '어느 도형들에 덮였는지'가 같은 곳. 떨어진 부분은 연결 성분(바깥 윤곽 + 그 안의 구멍)별로 따로 나눔
 *  D. 경로 복원: 바깥 윤곽은 시계 방향·구멍은 반대 방향으로 정리(nonzero·evenodd 어느 쪽으로 칠해도 구멍이 뚫림),
 *     겹친 점·길이 0 선분 제거, 아주 작은 조각(허용 오차: 슬라이드 좌표 기준 넓이 MIN_AREA) 버림, 결과 경로에 맞춰 상자 다시 계산
 * Paper.js에는 '조각' 연산이 없으므로 위 방식으로 직접 구성했다 (Paper의 unite/intersect/subtract/exclude만 사용).
 */
import paper from 'paper/dist/paper-core';
import type { CustomGeometry, PathCommand, SlideObject } from '../../types/model';
import { shapePath } from '../rendering/shapeGeometry';

export type MergeOp = 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract';

/** 허용 오차 (슬라이드 px 단위: 화면 확대와 무관) */
export const MIN_AREA = 1; // 이보다 작은 영역은 계산 오차로 보고 버림 (px²)
const POINT_EPS = 0.01; // 이보다 가까운 연속 점은 한 점

let scope: paper.PaperScope | null = null;
function S(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

/* ───────────── B. 좌표 변환 ───────────── */

/** 개체 → 부모(슬라이드 또는 그룹) 좌표 행렬. 회전은 상자 가운데, 뒤집기는 도형 내용(렌더러와 같음) */
function objectMatrix(o: SlideObject, withFlip: boolean): paper.Matrix {
  const s = S();
  const m = new s.Matrix();
  m.translate(o.x + o.width / 2, o.y + o.height / 2);
  if (o.rotation) m.rotate(o.rotation, new s.Point(0, 0));
  if (withFlip && (o.flipH || o.flipV)) m.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
  m.translate(-o.width / 2, -o.height / 2);
  return m;
}

/* ───────────── A. 도형 → 경로 ───────────── */

export interface Operand {
  /** 슬라이드 좌표의 영역 */
  item: paper.PathItem;
  /** 원래 개체 (서식·이름) */
  source: SlideObject;
}

/** 병합할 수 있는 개체인지 (그룹은 안의 도형이 모두 되면) */
export function mergeable(o: SlideObject): string | null {
  if (o.locked) return '잠긴 개체';
  if (o.type === 'shape') {
    if (o.shape === 'custom' && o.geometry && !o.geometry.paths.some((p) => p.fill && p.cmds.some((c) => c.c === 'Z'))) return '닫히지 않은 자유형(열린 경로)';
    return null;
  }
  if (o.type === 'text') return null; // 텍스트 상자는 사각형 영역으로
  if (o.type === 'group') return o.children.map(mergeable).find((x) => x) ?? null;
  if (o.type === 'image') return '그림 (도형 병합은 벡터 도형만; 그림 자르기는 별도 기능)';
  if (o.type === 'line') return '선 (면적이 없음)';
  return `${o.type} 개체`;
}

/** 개체 하나 → 슬라이드 좌표의 경로들 (그룹이면 안의 도형마다 하나씩) */
export function toOperands(o: SlideObject, parent?: paper.Matrix): Operand[] {
  const s = S();
  if (o.type === 'group') {
    const gm = objectMatrix(o, false);
    const m = parent ? parent.appended(gm) : gm;
    return o.children.flatMap((c) => toOperands(c, m));
  }
  if (o.type !== 'shape' && o.type !== 'text') return [];
  const d = o.type === 'shape' ? shapePath(o.shape, o.width, o.height, o.geometry) : shapePath('rect', o.width, o.height);
  const item = new s.CompoundPath({ pathData: d, insert: false });
  item.fillRule = o.type === 'shape' && o.geometry?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  // 열린 하위 경로는 영역이 아니므로 닫음 (mergeable에서 영역이 하나도 없는 열린 경로는 미리 거름)
  for (const c of item.children as paper.Path[]) c.closed = true;
  const om = objectMatrix(o, true);
  item.transform(parent ? parent.appended(om) : om);
  return [{ item: normalize(item), source: o }];
}

/** 채움 규칙을 반영한 실제 영역으로 정리 (자기 교차·evenodd → 바깥 시계 방향/구멍 반대) */
function normalize(item: paper.PathItem): paper.PathItem {
  const r = item.unite(item, { insert: false }) as paper.PathItem;
  return r;
}

/* ───────────── C. 불 연산 ───────────── */

const bounds = (i: paper.PathItem) => i.bounds;
const overlaps = (a: paper.PathItem, b: paper.PathItem) => bounds(a).intersects(bounds(b), 0.001);
const areaOf = (i: paper.PathItem) => Math.abs((i as paper.Path).area ?? 0);
const isEmpty = (i: paper.PathItem | null | undefined) => !i || areaOf(i) < MIN_AREA;

function union(items: paper.PathItem[]): paper.PathItem | null {
  if (!items.length) return null;
  return items.slice(1).reduce((acc, x) => acc.unite(x, { insert: false }) as paper.PathItem, items[0]);
}

/** 연산 결과: 한 개(통합·결합·교차·빼기) 또는 여러 조각(조각) */
export function booleanOp(op: MergeOp, items: paper.PathItem[]): paper.PathItem[] {
  if (items.length < 2) return [];
  switch (op) {
    case 'union': {
      const r = union(items);
      return r && !isEmpty(r) ? [r] : [];
    }
    case 'combine': {
      // 결합(XOR)은 결합 법칙이 성립 → 차례로 (acc − x) ∪ (x − acc) = 홀수 번 덮인 곳.
      // Paper의 exclude는 서로 겹치는 하위 경로(짝홀 규칙용)를 돌려주므로, 겹침 없는 윤곽을 얻으려고 정의대로 계산
      let r: paper.PathItem = items[0];
      for (const x of items.slice(1)) {
        if (!overlaps(r, x)) {
          r = r.unite(x, { insert: false }) as paper.PathItem;
          continue;
        }
        const a = r.subtract(x, { insert: false }) as paper.PathItem, b = x.subtract(r, { insert: false }) as paper.PathItem;
        r = a.unite(b, { insert: false }) as paper.PathItem;
      }
      return isEmpty(r) ? [] : [r];
    }
    case 'intersect': {
      let r: paper.PathItem | null = items[0];
      for (const x of items.slice(1)) {
        if (!r || !overlaps(r, x)) return []; // 상자가 안 겹치면 공통 영역 없음
        r = r.intersect(x, { insert: false }) as paper.PathItem;
        if (isEmpty(r)) return [];
      }
      return r ? [r] : [];
    }
    case 'subtract': {
      let r = items[0];
      for (const x of items.slice(1)) if (overlaps(r, x)) r = r.subtract(x, { insert: false }) as paper.PathItem;
      return isEmpty(r) ? [] : [r];
    }
    case 'fragment':
      return fragment(items);
  }
}

/**
 * 조각 (평면 분할). 도형을 하나씩 더할 때마다 기존 조각을 새 도형으로 나누고(겹친 부분/안 겹친 부분),
 * 새 도형 중 기존 어떤 조각에도 없던 부분을 새 조각으로. 상자가 안 겹치는 조각은 연산 없이 그대로.
 * 끝으로 각 조각을 연결 성분으로 나눔 (조각마다 따로 선택·이동·색 변경)
 */
function fragment(items: paper.PathItem[]): paper.PathItem[] {
  let faces: paper.PathItem[] = [];
  let covered: paper.PathItem | null = null;
  for (const b of items) {
    const next: paper.PathItem[] = [];
    for (const f of faces) {
      if (!overlaps(f, b)) {
        next.push(f);
        continue;
      }
      const inter = f.intersect(b, { insert: false }) as paper.PathItem;
      const rest = f.subtract(b, { insert: false }) as paper.PathItem;
      if (!isEmpty(inter)) next.push(inter);
      if (!isEmpty(rest)) next.push(rest);
    }
    const fresh = covered && overlaps(covered, b) ? (b.subtract(covered, { insert: false }) as paper.PathItem) : b;
    if (!isEmpty(fresh)) next.push(fresh);
    covered = covered ? (covered.unite(b, { insert: false }) as paper.PathItem) : b;
    faces = next;
  }
  return faces.flatMap(components).filter((x) => !isEmpty(x));
}

/** 경로의 하위 경로들 (Path 하나면 그것만) */
const childrenOf = (i: paper.PathItem): paper.Path[] => (i instanceof paper.CompoundPath ? ([...i.children] as paper.Path[]) : [i as paper.Path]);

/** 연결 성분으로 나눔: 바깥 윤곽마다 그 안에 바로 들어 있는 구멍을 붙임 */
export function components(item: paper.PathItem): paper.PathItem[] {
  const s = S();
  item.reorient(true, true); // 바깥 시계 방향, 구멍 반대 방향 (nonzero 기준)
  const paths = childrenOf(item).filter((p) => p.segments.length > 1 && Math.abs(p.area) >= MIN_AREA / 10);
  const outers = paths.filter((p) => p.clockwise);
  if (outers.length <= 1) return [item];
  const holes = paths.filter((p) => !p.clockwise);
  // 넓이가 작은 바깥 윤곽부터 (구멍 안 섬처럼 겹쳐 들어간 경우 가장 안쪽 윤곽에 붙도록)
  const sorted = [...outers].sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
  const groups = new Map<paper.Path, paper.Path[]>(outers.map((o) => [o, []]));
  for (const h of holes) {
    const pt = h.interiorPoint ?? h.firstSegment.point;
    const owner = sorted.find((o) => Math.abs(o.area) > Math.abs(h.area) && o.contains(pt));
    if (owner) groups.get(owner)!.push(h);
  }
  return outers.map((o) => new s.CompoundPath({ children: [o.clone({ insert: false }), ...groups.get(o)!.map((h) => h.clone({ insert: false }))], insert: false }));
}

/* ───────────── D. 경로 복원 ───────────── */

export interface MergedShape {
  /** 슬라이드 좌표의 상자 (결과 경로에 맞춤) */
  x: number;
  y: number;
  width: number;
  height: number;
  geometry: CustomGeometry;
}

/** Paper 경로 → 사용자 지정 도형 (0..1 좌표, 곡선은 베지어 C 그대로) */
export function toShape(item: paper.PathItem): MergedShape | null {
  item.reorient(true, true);
  const b = item.bounds;
  if (b.width < POINT_EPS || b.height < POINT_EPS) return null;
  const nx = (x: number) => (x - b.x) / b.width, ny = (y: number) => (y - b.y) / b.height;
  const cmds: PathCommand[] = [];
  for (const p of childrenOf(item)) {
    if (p.segments.length < 2 || Math.abs(p.area) < MIN_AREA / 10) continue;
    // 겹친 연속 점 제거
    const segs = p.segments.filter((sg, i, all) => i === 0 || sg.point.getDistance(all[i - 1].point) > POINT_EPS);
    if (segs.length > 1 && segs[0].point.getDistance(segs[segs.length - 1].point) <= POINT_EPS) segs.pop();
    if (segs.length < 2) continue;
    cmds.push({ c: 'M', x: nx(segs[0].point.x), y: ny(segs[0].point.y) });
    const n = segs.length;
    for (let i = 1; i <= n; i++) {
      const a = segs[i - 1], z = segs[i % n];
      const straight = a.handleOut.isZero() && z.handleIn.isZero();
      if (straight) cmds.push({ c: 'L', x: nx(z.point.x), y: ny(z.point.y) });
      else {
        const c1 = a.point.add(a.handleOut), c2 = z.point.add(z.handleIn);
        cmds.push({ c: 'C', x1: nx(c1.x), y1: ny(c1.y), x2: nx(c2.x), y2: ny(c2.y), x: nx(z.point.x), y: ny(z.point.y) });
      }
    }
    cmds.push({ c: 'Z' });
  }
  if (!cmds.length) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height, geometry: { paths: [{ cmds, fill: true, stroke: true }], fillRule: 'nonzero' } };
}

/* ───────────── 진입점 ───────────── */

export interface MergeResult {
  shapes: MergedShape[];
  /** 연산에 쓴 도형 수 (그룹 안 도형 포함) */
  operands: number;
}

/**
 * 선택한 개체(선택 순서대로)로 병합. 빼기는 첫 개체(그룹이면 그 안의 도형 합)가 기준.
 * 실패·빈 결과면 shapes가 빈 배열 (호출 쪽은 원본을 지우지 않음)
 */
export function mergeObjects(op: MergeOp, objects: SlideObject[]): MergeResult {
  S();
  const groups = objects.map((o) => toOperands(o));
  const flat = groups.flat();
  let items: paper.PathItem[];
  if (op === 'subtract') {
    // 기준 = 첫 개체(그룹이면 안의 도형 합), 나머지 = 각 도형
    const base = union(groups[0].map((x) => x.item));
    items = base ? [base, ...groups.slice(1).flat().map((x) => x.item)] : [];
  } else items = flat.map((x) => x.item);
  const out = booleanOp(op, items)
    .flatMap((r) => (op === 'fragment' ? [r] : [r]))
    .map(toShape)
    .filter((x): x is MergedShape => !!x);
  return { shapes: out, operands: flat.length };
}

/** 프리셋 도형 → 같은 모양의 자유형 경로 (점 편집용: 원은 베지어 4개, 다각형은 꼭짓점) */
export function presetToGeometry(o: SlideObject): CustomGeometry | null {
  if (o.type !== 'shape' && o.type !== 'text') return null;
  const s = S();
  const d = o.type === 'shape' ? shapePath(o.shape, o.width, o.height, o.geometry) : shapePath('rect', o.width, o.height);
  const item = new s.CompoundPath({ pathData: d, insert: false });
  const r = toShape(item);
  if (!r) return null;
  // 원래 상자(0..1) 기준으로 다시 맞춤 (도형 경로가 상자 밖으로 조금 나가도 상자는 그대로)
  const sx = r.width / o.width, sy = r.height / o.height, ox = r.x / o.width, oy = r.y / o.height;
  const map = (c: PathCommand): PathCommand =>
    c.c === 'Z' ? c : c.c === 'C' ? { c: 'C', x1: ox + c.x1 * sx, y1: oy + c.y1 * sy, x2: ox + c.x2 * sx, y2: oy + c.y2 * sy, x: ox + c.x * sx, y: oy + c.y * sy } : { c: c.c, x: ox + c.x * sx, y: oy + c.y * sy };
  return { ...r.geometry, paths: r.geometry.paths.map((p) => ({ ...p, cmds: p.cmds.map(map) })) };
}

/** 넓이 (슬라이드 px², 테스트·검증용) */
export function shapeArea(m: MergedShape): number {
  const s = S();
  const d = m.geometry.paths.map((p) => p.cmds.map((c) => (c.c === 'Z' ? 'Z' : c.c === 'C' ? `C${c.x1 * m.width + m.x},${c.y1 * m.height + m.y} ${c.x2 * m.width + m.x},${c.y2 * m.height + m.y} ${c.x * m.width + m.x},${c.y * m.height + m.y}` : `${c.c}${c.x * m.width + m.x},${c.y * m.height + m.y}`)).join(' ')).join(' ');
  return Math.abs(new s.CompoundPath({ pathData: d, insert: false }).area);
}

/** 점이 결과 영역 안인지 (슬라이드 좌표, 테스트·검증용) */
export function shapeContains(m: MergedShape, x: number, y: number): boolean {
  const s = S();
  const d = m.geometry.paths.map((p) => p.cmds.map((c) => (c.c === 'Z' ? 'Z' : c.c === 'C' ? `C${c.x1 * m.width + m.x},${c.y1 * m.height + m.y} ${c.x2 * m.width + m.x},${c.y2 * m.height + m.y} ${c.x * m.width + m.x},${c.y * m.height + m.y}` : `${c.c}${c.x * m.width + m.x},${c.y * m.height + m.y}`)).join(' ')).join(' ');
  return new s.CompoundPath({ pathData: d, insert: false }).contains(new s.Point(x, y));
}

/* ───────────── 선을 도형으로 (Stroke to Outline) ───────────── */

/** 대시 무늬 (선 두께의 배수, 렌더러 dashArray와 같음) */
const DASH: Record<string, number[] | undefined> = { dash: [4, 3], dot: [1, 1], dashDot: [4, 2, 1, 2] };

/** 열린 점 목록을 대시 무늬대로 자름 */
function dashSplit(pts: paper.Point[], closed: boolean, pattern: number[] | undefined, w: number): paper.Point[][] {
  const ring = closed ? [...pts, pts[0]] : pts;
  if (!pattern) return [ring];
  const lens = pattern.map((x) => x * w);
  const out: paper.Point[][] = [];
  let pi = 0, left = lens[0], on = true;
  let cur: paper.Point[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let a = ring[i - 1];
    const b = ring[i];
    let seg = b.getDistance(a);
    while (seg > 1e-9) {
      const step = Math.min(seg, left);
      const p = a.add(b.subtract(a).normalize(step));
      if (on) cur.push(p);
      seg -= step;
      left -= step;
      a = p;
      if (left <= 1e-9) {
        if (on && cur.length > 1) out.push(cur);
        on = !on;
        pi = (pi + 1) % lens.length;
        left = lens[pi];
        cur = [p];
      }
    }
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

/** 균형 잡힌 순서로 합치기 (작은 조각을 하나씩 더하는 것보다 빠름) */
function unionAll(items: paper.PathItem[]): paper.PathItem | null {
  let list = items;
  while (list.length > 1) {
    const next: paper.PathItem[] = [];
    for (let i = 0; i < list.length; i += 2) next.push(i + 1 < list.length ? (list[i].unite(list[i + 1], { insert: false }) as paper.PathItem) : list[i]);
    list = next;
  }
  return list[0] ?? null;
}

/** 점 목록(폴리라인) → 두께 w의 면 (구간 사각형 + 꺾이는 점마다 원 = 둥근 꺾임, 끝은 잘린 모양) */
function thicken(pts: paper.Point[], w: number, roundEnds: boolean): paper.PathItem[] {
  const s = S();
  const r = w / 2;
  const parts: paper.PathItem[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = b.subtract(a);
    if (d.length < 1e-6) continue;
    const n = new s.Point(-d.y, d.x).normalize(r);
    parts.push(new s.Path({ segments: [a.add(n), b.add(n), b.subtract(n), a.subtract(n)], closed: true, insert: false }));
  }
  for (let i = roundEnds ? 0 : 1; i < (roundEnds ? pts.length : pts.length - 1); i++) parts.push(new s.Path.Circle({ center: pts[i], radius: r, insert: false }));
  return parts;
}

/**
 * 선(테두리)을 같은 모양의 면으로: 도형의 테두리 경로 또는 선 개체(화살표 포함). 대시는 무늬대로 끊음.
 * 결과는 선 색으로 칠하는 자유형 (슬라이드 좌표의 상자)
 */
export function strokeOutline(o: SlideObject): MergedShape | null {
  const s = S();
  const stroke = (o as { stroke?: { width: number; dash: string } | null }).stroke;
  if (!stroke || !(stroke.width > 0)) return null;
  const w = (stroke.width * 96) / 72; // pt → px (렌더러와 같음)
  let polylines: { pts: paper.Point[]; closed: boolean }[] = [];
  const heads: paper.PathItem[] = [];
  if (o.type === 'line') {
    let x1 = 0, y1 = 0, x2 = o.width, y2 = o.height;
    if (o.flipH) [x1, x2] = [x2, x1];
    if (o.flipV) [y1, y2] = [y2, y1];
    const m = objectMatrix({ ...o, flipH: false, flipV: false }, false);
    const a = m.transform(new s.Point(x1, y1)), b = m.transform(new s.Point(x2, y2));
    polylines = [{ pts: [a, b], closed: false }];
    // 화살표: 렌더러 marker와 같은 크기 (선 두께 × 4, 끝이 끝점에서 0.8w 앞)
    const head = (tip: paper.Point, from: paper.Point, kind: string) => {
      if (kind === 'none') return;
      const dir = tip.subtract(from).normalize();
      const n = new s.Point(-dir.y, dir.x);
      const size = 4 * w;
      const end = tip.add(dir.multiply(0.8 * w));
      const back = end.subtract(dir.multiply(size));
      if (kind === 'oval') heads.push(new s.Path.Circle({ center: tip, radius: 1.6 * w, insert: false }));
      else heads.push(new s.Path({ segments: [end, back.add(n.multiply(size / 2)), back.subtract(n.multiply(size / 2))], closed: true, insert: false }));
    };
    head(b, a, o.headEnd);
    head(a, b, o.headStart);
  } else {
    const d = o.type === 'shape' ? shapePath(o.shape, o.width, o.height, o.geometry) : shapePath('rect', o.width, o.height);
    const item = new s.CompoundPath({ pathData: d, insert: false });
    item.transform(objectMatrix(o, true));
    for (const c of childrenOf(item)) {
      const f = c.clone({ insert: false }) as paper.Path;
      f.flatten(0.25); // 곡선 → 촘촘한 직선 (오차 0.25px)
      polylines.push({ pts: f.segments.map((sg) => sg.point), closed: c.closed });
    }
  }
  const parts: paper.PathItem[] = [...heads];
  for (const pl of polylines) for (const piece of dashSplit(pl.pts, pl.closed, DASH[stroke.dash], w)) parts.push(...thicken(piece, w, pl.closed && !DASH[stroke.dash]));
  const u = unionAll(parts);
  return u && !isEmpty(u) ? toShape(u) : null;
}

/* ───────────── 그림 자르기 (그림 ∩ 도형, 그림 − 도형) ───────────── */

export interface ImageClipResult {
  x: number;
  y: number;
  width: number;
  height: number;
  crop: { left: number; top: number; right: number; bottom: number };
  clip: CustomGeometry;
}

/** 0..1 경로 → Paper 경로 (상자 w×h 픽셀) */
function geometryItem(g: CustomGeometry, w: number, h: number): paper.CompoundPath {
  const s = S();
  const d = g.paths
    .filter((p) => p.fill)
    .map((p) => p.cmds.map((c) => (c.c === 'Z' ? 'Z' : c.c === 'C' ? `C${c.x1 * w},${c.y1 * h} ${c.x2 * w},${c.y2 * h} ${c.x * w},${c.y * h}` : `${c.c}${c.x * w},${c.y * h}`)).join(' '))
    .join(' ');
  const item = new s.CompoundPath({ pathData: d, insert: false });
  item.fillRule = g.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  return item;
}

/**
 * 그림을 도형 모양으로 자름: 그림 영역(이미 잘려 있으면 그 모양)과 도형들의 교차 또는 차이.
 * 픽셀은 제자리: 회전하지 않은 그림은 상자를 결과에 맞춰 줄이고 자르기(crop)를 그만큼 조정, 회전한 그림은 상자는 두고 모양만.
 */
export function clipImage(op: 'intersect' | 'subtract', img: Extract<SlideObject, { type: 'image' }>, shapes: SlideObject[]): ImageClipResult | null {
  const s = S();
  const m = objectMatrix(img, false); // 자르기 모양은 그림 상자에 고정 (뒤집기는 그림 내용만)
  const baseLocal = img.clip ? geometryItem(img.clip, img.width, img.height) : new s.CompoundPath({ pathData: `M0,0 H${img.width} V${img.height} H0 Z`, insert: false });
  baseLocal.transform(m);
  let region: paper.PathItem = normalize(baseLocal);
  const cut = union(shapes.flatMap((o) => toOperands(o)).map((x) => x.item));
  if (!cut) return null;
  region = (op === 'intersect' ? region.intersect(cut, { insert: false }) : region.subtract(cut, { insert: false })) as paper.PathItem;
  if (isEmpty(region)) return null;
  if (!img.rotation) {
    const b = region.bounds;
    const u0 = (b.x - img.x) / img.width, u1 = (b.x + b.width - img.x) / img.width;
    const v0 = (b.y - img.y) / img.height, v1 = (b.y + b.height - img.y) / img.height;
    const c = img.crop, sw = 1 - c.left - c.right, sh = 1 - c.top - c.bottom;
    // 화면의 상자 비율 → 원본 그림 비율 (뒤집으면 거꾸로)
    const [l, r] = img.flipH ? [c.left + (1 - u1) * sw, 1 - (c.left + (1 - u0) * sw)] : [c.left + u0 * sw, 1 - (c.left + u1 * sw)];
    const [t, bt] = img.flipV ? [c.top + (1 - v1) * sh, 1 - (c.top + (1 - v0) * sh)] : [c.top + v0 * sh, 1 - (c.top + v1 * sh)];
    const shape = toShape(region);
    if (!shape) return null;
    return { x: b.x, y: b.y, width: b.width, height: b.height, crop: { left: l, top: t, right: r, bottom: bt }, clip: shape.geometry };
  }
  // 회전한 그림: 상자 좌표로 되돌려 0..1로
  region.transform(m.inverted());
  const shape = toShape(region);
  if (!shape) return null;
  const sx = shape.width / img.width, sy = shape.height / img.height, ox = shape.x / img.width, oy = shape.y / img.height;
  const map = (c: PathCommand): PathCommand =>
    c.c === 'Z' ? c : c.c === 'C' ? { c: 'C', x1: ox + c.x1 * sx, y1: oy + c.y1 * sy, x2: ox + c.x2 * sx, y2: oy + c.y2 * sy, x: ox + c.x * sx, y: oy + c.y * sy } : { c: c.c, x: ox + c.x * sx, y: oy + c.y * sy };
  return { x: img.x, y: img.y, width: img.width, height: img.height, crop: { ...img.crop }, clip: { ...shape.geometry, paths: shape.geometry.paths.map((p) => ({ ...p, cmds: p.cmds.map(map) })) } };
}
