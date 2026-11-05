/**
 * 발표 도구 순수 함수: 쇼 슬라이드 순서, 잉크(펜·형광펜) → 도형 변환, 지우개, 화면 확대 좌표 계산.
 * React와 무관하게 테스트할 수 있도록 분리.
 */
import type { Presentation, ShapeObject, ShowSettings, Slide, PathCommand } from '../../types/model';
import { newId } from '../../utils/id';
import { textBody, paragraph } from '../../core/document/factory';

export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  showType: 'speaker',
  loop: false,
  noNarration: false,
  noAnimation: false,
  range: { kind: 'all' },
  useTimings: true,
  penColor: '#FF0000',
  laserColor: '#FF0000',
  presenterView: true,
};

export const showSettingsOf = (doc: Presentation): ShowSettings => ({ ...DEFAULT_SHOW_SETTINGS, ...doc.showSettings });

/**
 * 쇼에서 차례로 보여 줄 슬라이드 (숨긴 슬라이드 포함 — 이동할 때 건너뜀).
 * 범위(시작~끝 번호) 또는 재구성한 쇼를 적용한다.
 */
export function showSequence(doc: Presentation, settings: ShowSettings, customShowId?: string): Slide[] {
  const showId = customShowId ?? (settings.range.kind === 'custom' ? settings.range.showId : undefined);
  if (showId) {
    const cs = doc.customShows?.find((c) => c.id === showId);
    if (cs) {
      const byId = new Map(doc.slides.map((s) => [s.id, s]));
      const list = cs.slideIds.map((id) => byId.get(id)).filter((s): s is Slide => !!s);
      if (list.length) return list;
    }
  }
  if (settings.range.kind === 'range') {
    const from = Math.max(1, Math.min(settings.range.from, doc.slides.length));
    const to = Math.max(from, Math.min(settings.range.to, doc.slides.length));
    return doc.slides.slice(from - 1, to);
  }
  return doc.slides;
}

/** i 다음(dir=1) 또는 이전(dir=-1)의 숨기지 않은 슬라이드 인덱스. 없으면 -1 */
export function stepIndex(seq: Slide[], i: number, dir: 1 | -1): number {
  for (let j = i + dir; j >= 0 && j < seq.length; j += dir) if (!seq[j].hidden) return j;
  return -1;
}

/** 시작 인덱스: 요청한 슬라이드가 순서에 있으면 그 슬라이드(숨김이어도), 없으면 첫 표시 슬라이드 */
export function startIndexOf(seq: Slide[], slideId: string | undefined): number {
  const i = slideId ? seq.findIndex((s) => s.id === slideId) : -1;
  if (i >= 0) return i;
  const first = seq.findIndex((s) => !s.hidden);
  return first >= 0 ? first : 0;
}

/* ───────────── 잉크 ───────────── */

export type InkTool = 'pen' | 'highlighter';

export interface InkStroke {
  id: string;
  tool: InkTool;
  color: string;
  /** 선 두께 (슬라이드 px) */
  width: number;
  /** [x0, y0, x1, y1, ...] 슬라이드 좌표 */
  points: number[];
}

export const PEN_WIDTH = 3;
export const HIGHLIGHTER_WIDTH = 18;
export const HIGHLIGHTER_OPACITY = 0.45;

export function inkPathD(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0].toFixed(1)} ${points[1].toFixed(1)}`;
  if (points.length === 2) return `${d}l0.01 0`;
  for (let i = 2; i < points.length; i += 2) d += `L${points[i].toFixed(1)} ${points[i + 1].toFixed(1)}`;
  return d;
}

/** 점 사이 거리가 minDist보다 가까운 점은 버림 (드래그 중 점 개수 제한) */
export function appendPoint(points: number[], x: number, y: number, minDist = 1.5): number[] {
  const n = points.length;
  if (n >= 2 && Math.hypot(points[n - 2] - x, points[n - 1] - y) < minDist) return points;
  return [...points, x, y];
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(s: InkStroke, x: number, y: number, radius: number): boolean {
  const p = s.points;
  const r = radius + s.width / 2;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= r;
  for (let i = 0; i + 3 < p.length; i += 2) if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
  return false;
}

/** 지우개: (x, y)에 닿은 획 전체를 지움 (PowerPoint 지우개와 같이 획 단위) */
export function eraseAt(strokes: InkStroke[], x: number, y: number, radius = 8): InkStroke[] {
  const out = strokes.filter((s) => !strokeHit(s, x, y, radius));
  return out.length === strokes.length ? strokes : out;
}

/**
 * 잉크 획 → 사용자 지정 도형(자유형 선). 잉크 주석을 '유지'하면 슬라이드에 이 도형이 추가된다.
 * 경로 좌표는 도형 크기 기준 0..1로 정규화 (PPTX custGeom으로 저장 가능).
 */
export function strokeToShape(s: InkStroke): ShapeObject {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    xs.push(s.points[i]);
    ys.push(s.points[i + 1]);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // 점 하나/직선도 크기가 0이 되지 않게
  const w = Math.max(1, Math.max(...xs) - minX);
  const h = Math.max(1, Math.max(...ys) - minY);
  const cmds: PathCommand[] = xs.map((x, i) => ({ c: i ? 'L' : 'M', x: round4((x - minX) / w), y: round4((ys[i] - minY) / h) }));
  if (xs.length === 1) cmds.push({ c: 'L', x: 0, y: 0 });
  return {
    id: newId(),
    type: 'shape',
    name: s.tool === 'highlighter' ? '잉크 (형광펜)' : '잉크',
    shape: 'custom',
    geometry: { paths: [{ cmds, fill: false, stroke: true }] },
    x: round2(minX),
    y: round2(minY),
    width: round2(w),
    height: round2(h),
    rotation: 0,
    fill: { type: 'none' },
    // 슬라이드 px → pt (96 px = 72 pt)
    stroke: { color: s.color, width: round2(s.width * 0.75), dash: 'solid', ...(s.tool === 'highlighter' ? { opacity: HIGHLIGHTER_OPACITY } : {}) },
    text: textBody([paragraph('')]),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/* ───────────── 화면 확대 ───────────── */

export interface ZoomState {
  /** 배율 (1 = 확대 안 함) */
  scale: number;
  /** 보이는 영역의 중심 (슬라이드 좌표) */
  cx: number;
  cy: number;
}

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
export const noZoom = (w: number, h: number): ZoomState => ({ scale: 1, cx: w / 2, cy: h / 2 });

/** 확대한 영역이 슬라이드 밖으로 나가지 않도록 중심을 조정 */
export function clampZoom(z: ZoomState, w: number, h: number): ZoomState {
  const scale = Math.max(1, Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], z.scale));
  const hw = w / scale / 2;
  const hh = h / scale / 2;
  return { scale, cx: Math.max(hw, Math.min(w - hw, z.cx)), cy: Math.max(hh, Math.min(h - hh, z.cy)) };
}

/** 보이는 영역의 왼쪽 위 (슬라이드 좌표) */
export function zoomOrigin(z: ZoomState, w: number, h: number) {
  return { left: z.cx - w / z.scale / 2, top: z.cy - h / z.scale / 2 };
}

/** 슬라이드 레이어에 적용할 CSS transform (transform-origin 0 0) */
export function zoomTransform(z: ZoomState, w: number, h: number): string | undefined {
  if (z.scale === 1) return undefined;
  const { left, top } = zoomOrigin(z, w, h);
  return `scale(${z.scale}) translate(${-left}px, ${-top}px)`;
}

/** 무대 기준 좌표(0..w, 0..h, 확대 전 슬라이드 크기) → 실제 슬라이드 좌표 */
export function viewToSlide(z: ZoomState, w: number, h: number, vx: number, vy: number) {
  const { left, top } = zoomOrigin(z, w, h);
  return { x: left + vx / z.scale, y: top + vy / z.scale };
}

/** 다음/이전 배율 단계 */
export function zoomStep(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 1e-6) ?? 1;
}

/* ───────────── 시간 표시 ───────────── */

export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
