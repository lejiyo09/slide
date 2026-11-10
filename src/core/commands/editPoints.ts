/**
 * 점 편집 (PowerPoint: 도형 서식 › 도형 편집 › 점 편집). 자유형 도형의 꼭짓점과 베지어 조절점을 끌어 모양을 바꾼다.
 * 프리셋 도형(원·별 …)·텍스트 상자는 같은 모양의 자유형으로 바꾼 뒤 편집 (원은 베지어 곡선 4개).
 * 끈 뒤에는 상자를 점들에 맞춰 다시 계산하되, 회전한 도형도 화면에서 제자리에 남도록 위치를 보정한다.
 */
import type { CustomGeometry, PathCommand, ShapeObject, SlideObject } from '../../types/model';
import { getActiveSlide, useEditor } from '../store/editorStore';

export type PointPart = 'pt' | 'c1' | 'c2';
export interface PointRef {
  path: number;
  cmd: number;
  part: PointPart;
}

/** 점 편집 시작: 자유형이 아니면 같은 모양의 자유형으로 바꿈 (실행 취소 한 단계) */
export async function startEditPoints(id: string) {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const o = slide.objects.find((x) => x.id === id);
  if (!o || o.locked || (o.type !== 'shape' && o.type !== 'text')) return;
  if (o.type === 'text' && o.ph) return s.toast('개체 틀에서는 점 편집을 할 수 없습니다.', 'warning');
  if (!(o.type === 'shape' && o.shape === 'custom' && o.geometry)) {
    const { presetToGeometry } = await import('../../engines/geometry/shapeBoolean');
    const g = presetToGeometry(o);
    if (!g) return;
    s.commit('점 편집: 자유형으로 바꾸기', (d) => {
      const sl = d.slides.find((x) => x.id === slide.id)!;
      const i = sl.objects.findIndex((x) => x.id === id);
      const cur = sl.objects[i] as ShapeObject;
      sl.objects[i] = { ...cur, type: 'shape', shape: 'custom', geometry: g } as ShapeObject;
      delete (sl.objects[i] as ShapeObject).sourcePreset;
    });
  }
  useEditor.getState().set({ editPointsId: id, selectedIds: [id] });
}

export const endEditPoints = () => useEditor.getState().set({ editPointsId: null });

/* ───────────── 좌표 (순수 함수) ───────────── */

type Box = Pick<SlideObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'flipH' | 'flipV'>;

/** 도형 안 0..1 좌표 → 슬라이드 좌표 (뒤집기 → 회전 → 이동, 렌더러와 같음) */
export function localToSlide(o: Box, u: number, v: number): { x: number; y: number } {
  let dx = u * o.width - o.width / 2, dy = v * o.height - o.height / 2;
  if (o.flipH) dx = -dx;
  if (o.flipV) dy = -dy;
  const a = ((o.rotation ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: o.x + o.width / 2 + dx * c - dy * s, y: o.y + o.height / 2 + dx * s + dy * c };
}

/** 슬라이드 좌표 → 도형 안 0..1 좌표 */
export function slideToLocal(o: Box, x: number, y: number): { u: number; v: number } {
  const a = (-(o.rotation ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const px = x - (o.x + o.width / 2), py = y - (o.y + o.height / 2);
  let dx = px * c - py * s, dy = px * s + py * c;
  if (o.flipH) dx = -dx;
  if (o.flipV) dy = -dy;
  return { u: (dx + o.width / 2) / o.width, v: (dy + o.height / 2) / o.height };
}

const get = (c: PathCommand, part: PointPart): [number, number] | null => {
  if (c.c === 'Z') return null;
  if (part === 'pt') return [c.x, c.y];
  if (c.c !== 'C') return null;
  return part === 'c1' ? [c.x1, c.y1] : [c.x2, c.y2];
};

/**
 * 점 하나를 (u, v)로 옮김. 꼭짓점을 옮기면 그 점에 붙은 조절점(들어오는 c2, 나가는 c1)도 같이 움직이고,
 * 닫힌 경로에서 시작점(M)과 같은 자리의 끝점도 함께 움직인다 (PowerPoint와 같은 동작)
 */
export function movePoint(g: CustomGeometry, ref: PointRef, u: number, v: number): CustomGeometry {
  const paths = g.paths.map((p) => ({ ...p, cmds: p.cmds.map((c) => ({ ...c })) as PathCommand[] }));
  const cmds = paths[ref.path].cmds;
  const c = cmds[ref.cmd];
  const cur = get(c, ref.part);
  if (!cur) return g;
  const dx = u - cur[0], dy = v - cur[1];
  const shift = (k: number, part: PointPart) => {
    const t = cmds[k] as Record<string, number> & PathCommand;
    if (!t || t.c === 'Z') return;
    if (part === 'pt') {
      t.x += dx;
      t.y += dy;
    } else if (t.c === 'C') {
      if (part === 'c1') {
        t.x1 += dx;
        t.y1 += dy;
      } else {
        t.x2 += dx;
        t.y2 += dy;
      }
    }
  };
  if (ref.part !== 'pt') {
    shift(ref.cmd, ref.part);
    return { ...g, paths };
  }
  // 이 꼭짓점과 같은 자리의 점들 (하위 경로의 시작 M ↔ 마지막 끝점)
  const start = (() => {
    let k = ref.cmd;
    while (k > 0 && cmds[k].c !== 'M') k--;
    return k;
  })();
  let end = ref.cmd;
  while (end + 1 < cmds.length && cmds[end + 1].c !== 'M') end++;
  const same = new Set<number>([ref.cmd]);
  const eq = (k: number) => {
    const p = get(cmds[k], 'pt');
    return p && Math.abs(p[0] - cur[0]) < 1e-6 && Math.abs(p[1] - cur[1]) < 1e-6;
  };
  for (let k = start; k <= end; k++) if (cmds[k].c !== 'Z' && eq(k)) same.add(k);
  for (const k of same) {
    shift(k, 'pt');
    if (cmds[k].c === 'C') shift(k, 'c2'); // 들어오는 조절점
    // 나가는 조절점: 다음 명령이 곡선이면 그 c1 (마지막 점이면 시작 뒤 첫 곡선)
    let nk = k + 1;
    if (nk > end || cmds[nk].c === 'Z' || cmds[nk].c === 'M') nk = start + 1;
    if (nk <= end && cmds[nk].c === 'C' && !(same.has(nk) && nk !== k + 1 && nk !== start + 1)) shift(nk, 'c1');
  }
  return { ...g, paths };
}

/** 점들(꼭짓점·조절점)에 맞춰 상자 다시 계산: 화면 모양은 그대로, 상자·0..1 좌표만 바뀜 */
export function refitBox(o: Box & { geometry: CustomGeometry }): Box & { geometry: CustomGeometry } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of o.geometry.paths)
    for (const c of p.cmds) {
      for (const part of ['pt', 'c1', 'c2'] as const) {
        const q = get(c, part);
        if (!q) continue;
        x0 = Math.min(x0, q[0]);
        y0 = Math.min(y0, q[1]);
        x1 = Math.max(x1, q[0]);
        y1 = Math.max(y1, q[1]);
      }
    }
  if (!Number.isFinite(x0) || x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return o;
  if (Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6 && Math.abs(x1 - 1) < 1e-6 && Math.abs(y1 - 1) < 1e-6) return o;
  const w = (x1 - x0) * o.width, h = (y1 - y0) * o.height;
  // 새 상자의 가운데(도형 안 좌표) → 슬라이드 좌표 (회전·뒤집기 반영)
  const c = localToSlide(o, (x0 + x1) / 2, (y0 + y1) / 2);
  const map = (u: number, v: number): [number, number] => [(u - x0) / (x1 - x0), (v - y0) / (y1 - y0)];
  const geometry: CustomGeometry = {
    ...o.geometry,
    paths: o.geometry.paths.map((p) => ({
      ...p,
      cmds: p.cmds.map((cm) => {
        if (cm.c === 'Z') return cm;
        const [x, y] = map(cm.x, cm.y);
        if (cm.c === 'C') {
          const [ax, ay] = map(cm.x1, cm.y1), [bx, by] = map(cm.x2, cm.y2);
          return { c: 'C', x1: ax, y1: ay, x2: bx, y2: by, x, y };
        }
        return { c: cm.c, x, y };
      }) as PathCommand[],
    })),
  };
  return { ...o, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, geometry };
}
