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
