import type { SlideObject } from '../../types/model';
import { rotatedBounds, type Rect } from '../../utils/geometry';

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface SnapTargets {
  xs: { pos: number; rect: Rect | null }[];
  ys: { pos: number; rect: Rect | null }[];
}

/** 이동 중인 개체를 제외한 정렬 기준선 (슬라이드 가장자리/중앙, 다른 개체의 가장자리/중앙) */
export function collectTargets(objects: SlideObject[], excludeIds: string[], slideW: number, slideH: number): SnapTargets {
  const xs: SnapTargets['xs'] = [
    { pos: 0, rect: null },
    { pos: slideW / 2, rect: null },
    { pos: slideW, rect: null },
  ];
  const ys: SnapTargets['ys'] = [
    { pos: 0, rect: null },
    { pos: slideH / 2, rect: null },
    { pos: slideH, rect: null },
  ];
  for (const o of objects) {
    if (excludeIds.includes(o.id) || o.hidden) continue;
    const r = rotatedBounds(o, o.rotation);
    xs.push({ pos: r.x, rect: r }, { pos: r.x + r.width / 2, rect: r }, { pos: r.x + r.width, rect: r });
    ys.push({ pos: r.y, rect: r }, { pos: r.y + r.height / 2, rect: r }, { pos: r.y + r.height, rect: r });
  }
  return { xs, ys };
}

/**
 * 사각형의 가장자리/중앙을 기준선에 맞춤.
 * edges: 검사할 가장자리 (이동은 모두, 크기 조절은 움직이는 가장자리만)
 */
export function snapRect(
  rect: Rect,
  targets: SnapTargets,
  threshold: number,
  slideW: number,
  slideH: number,
  edges: { x: ('start' | 'center' | 'end')[]; y: ('start' | 'center' | 'end')[] } = { x: ['start', 'center', 'end'], y: ['start', 'center', 'end'] },
): { dx: number; dy: number; guides: Guide[] } {
  const edgeVal = (axis: 'x' | 'y', e: 'start' | 'center' | 'end') => {
    const s = axis === 'x' ? rect.x : rect.y;
    const len = axis === 'x' ? rect.width : rect.height;
    return e === 'start' ? s : e === 'center' ? s + len / 2 : s + len;
  };
  const best = (axis: 'x' | 'y') => {
    const list = axis === 'x' ? targets.xs : targets.ys;
    let bestD = Infinity;
    let delta = 0;
    for (const e of edges[axis]) {
      const v = edgeVal(axis, e);
      for (const t of list) {
        const d = t.pos - v;
        if (Math.abs(d) < Math.abs(bestD) && Math.abs(d) <= threshold) {
          bestD = d;
          delta = d;
        }
      }
    }
    return Number.isFinite(bestD) ? delta : 0;
  };
  const dx = best('x');
  const dy = best('y');
  const snapped = { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  const guides: Guide[] = [];
  // 일치하는 모든 기준선을 안내선으로 표시
  const eps = 0.5;
  for (const e of edges.x) {
    const v = e === 'start' ? snapped.x : e === 'center' ? snapped.x + snapped.width / 2 : snapped.x + snapped.width;
    for (const t of targets.xs) {
      if (Math.abs(t.pos - v) < eps) {
        const from = t.rect ? Math.min(t.rect.y, snapped.y) : 0;
        const to = t.rect ? Math.max(t.rect.y + t.rect.height, snapped.y + snapped.height) : slideH;
        guides.push({ axis: 'x', pos: t.pos, from, to });
      }
    }
  }
  for (const e of edges.y) {
    const v = e === 'start' ? snapped.y : e === 'center' ? snapped.y + snapped.height / 2 : snapped.y + snapped.height;
    for (const t of targets.ys) {
      if (Math.abs(t.pos - v) < eps) {
        const from = t.rect ? Math.min(t.rect.x, snapped.x) : 0;
        const to = t.rect ? Math.max(t.rect.x + t.rect.width, snapped.x + snapped.width) : slideW;
        guides.push({ axis: 'y', pos: t.pos, from, to });
      }
    }
  }
  return { dx, dy, guides };
}
