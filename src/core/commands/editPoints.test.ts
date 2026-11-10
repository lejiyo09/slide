import { describe, expect, it } from 'vitest';
import type { CustomGeometry } from '../../types/model';
import { localToSlide, movePoint, refitBox, slideToLocal } from './editPoints';

const tri: CustomGeometry = { paths: [{ cmds: [{ c: 'M', x: 0.5, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'L', x: 0, y: 1 }, { c: 'L', x: 0.5, y: 0 }, { c: 'Z' }], fill: true, stroke: true }] };
const curve: CustomGeometry = { paths: [{ cmds: [{ c: 'M', x: 0, y: 1 }, { c: 'C', x1: 0, y1: 0, x2: 1, y2: 0, x: 1, y: 1 }, { c: 'C', x1: 1, y1: 1.2, x2: 0, y2: 1.2, x: 0, y: 1 }, { c: 'Z' }], fill: true, stroke: true }] };

describe('점 편집', () => {
  it('좌표 왕복: 회전·뒤집기한 도형에서도 0..1 ↔ 슬라이드', () => {
    const o = { x: 100, y: 50, width: 200, height: 100, rotation: 30, flipH: true };
    for (const [u, v] of [[0, 0], [1, 0.5], [0.3, 0.9]]) {
      const p = localToSlide(o, u, v);
      const q = slideToLocal(o, p.x, p.y);
      expect(q.u).toBeCloseTo(u, 9);
      expect(q.v).toBeCloseTo(v, 9);
    }
    // 회전 없음: 왼쪽 위 = (x, y), 좌우 뒤집으면 왼쪽 위 점이 오른쪽 위로
    expect(localToSlide({ x: 10, y: 20, width: 100, height: 50, rotation: 0 }, 0, 0)).toEqual({ x: 10, y: 20 });
    const f = localToSlide({ x: 10, y: 20, width: 100, height: 50, rotation: 0, flipH: true }, 0, 0);
    expect([f.x, f.y]).toEqual([110, 20]);
  });

  it('꼭짓점을 옮기면 같은 자리의 시작·끝 점이 함께, 다른 점은 그대로', () => {
    const g = movePoint(tri, { path: 0, cmd: 0, part: 'pt' }, 0.5, -0.5);
    const c = g.paths[0].cmds as { x: number; y: number }[];
    expect([c[0].x, c[0].y, c[3].x, c[3].y]).toEqual([0.5, -0.5, 0.5, -0.5]);
    expect([c[1].x, c[1].y]).toEqual([1, 1]);
    // 원본은 바뀌지 않음 (불변)
    expect((tri.paths[0].cmds[0] as { y: number }).y).toBe(0);
  });

  it('곡선: 꼭짓점과 붙은 조절점이 함께 이동, 조절점만 옮기면 그 점만', () => {
    const g = movePoint(curve, { path: 0, cmd: 1, part: 'pt' }, 1.2, 1);
    const c = g.paths[0].cmds as unknown as Record<string, number>[];
    expect([c[1].x, c[1].x2]).toEqual([1.2, 1.2]); // 들어오는 조절점
    expect(c[2].x1).toBeCloseTo(1.2); // 나가는 조절점
    expect(c[2].x2).toBe(0); // 상관없는 점
    const h = movePoint(curve, { path: 0, cmd: 1, part: 'c1' }, 0.2, -0.3);
    const d = h.paths[0].cmds as unknown as Record<string, number>[];
    expect([d[1].x1, d[1].y1, d[1].x, d[1].y]).toEqual([0.2, -0.3, 1, 1]);
  });

  it('상자 다시 계산: 점이 상자 밖으로 나가면 상자를 넓히고, 회전한 도형도 화면 위치는 그대로', () => {
    const o = { x: 100, y: 100, width: 200, height: 100, rotation: 45, geometry: movePoint(tri, { path: 0, cmd: 0, part: 'pt' }, 0.5, -0.5) };
    const before = localToSlide(o, 0.5, -0.5); // 옮긴 꼭짓점의 화면 위치
    const r = refitBox(o);
    expect(r.height).toBeCloseTo(150); // 위로 반 칸(50px) 늘어남
    const top = r.geometry.paths[0].cmds[0] as { x: number; y: number };
    expect(top.y).toBeCloseTo(0);
    const after = localToSlide(r, top.x, top.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // 이미 0..1에 맞으면 그대로
    expect(refitBox({ x: 0, y: 0, width: 10, height: 10, rotation: 0, geometry: tri })).toEqual({ x: 0, y: 0, width: 10, height: 10, rotation: 0, geometry: tri });
  });
});

import { deletePoint, insertPoint, nearestSegment, toggleSegment } from './editPoints';
const sq: CustomGeometry = { paths: [{ cmds: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'L', x: 0, y: 1 }, { c: 'Z' }], fill: true, stroke: true }] };
describe('점 추가·삭제·곡선/직선', () => {
  it('점 추가: 직선 가운데, 곡선은 분할해도 같은 모양(분할점이 원래 곡선 위)', () => {
    const a = insertPoint(sq, 0, 1, 0.5);
    expect(a.paths[0].cmds.slice(0, 3)).toEqual([{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 0.5, y: 0 }, { c: 'L', x: 1, y: 0 }]);
    const b = insertPoint(curve, 0, 1, 0.5);
    const m = b.paths[0].cmds[1] as { x: number; y: number };
    // 원래 곡선 (0,1)-(0,0)-(1,0)-(1,1)의 t=0.5 = (0.5, 0.25)
    expect(m.x).toBeCloseTo(0.5);
    expect(m.y).toBeCloseTo(0.25);
    expect(b.paths[0].cmds.filter((c) => c.c === 'C')).toHaveLength(3);
  });
  it('점 삭제: 꼭짓점 하나가 빠지고, 3개 이하는 지우지 않음, 시작점도 지울 수 있음', () => {
    const five = insertPoint(sq, 0, 1, 0.5);
    expect(deletePoint(five, { path: 0, cmd: 1, part: 'pt' })).toEqual(sq);
    const tri3: CustomGeometry = { paths: [{ cmds: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0 }, { c: 'L', x: 0, y: 1 }, { c: 'Z' }], fill: true, stroke: true }] };
    expect(deletePoint(tri3, { path: 0, cmd: 1, part: 'pt' })).toBe(tri3);
    const noStart = deletePoint(sq, { path: 0, cmd: 0, part: 'pt' });
    expect(noStart.paths[0].cmds).toEqual([{ c: 'M', x: 1, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'L', x: 0, y: 1 }, { c: 'Z' }]);
  });
  it('곡선 ↔ 직선 전환, 가장 가까운 구간 찾기', () => {
    const c = toggleSegment(sq, { path: 0, cmd: 2, part: 'pt' });
    expect(c.paths[0].cmds[2]).toMatchObject({ c: 'C', x: 1, y: 1 });
    expect(toggleSegment(c, { path: 0, cmd: 2, part: 'pt' })).toEqual(sq);
    const n = nearestSegment(sq, 100, 100, 0.5, 0.02)!;
    expect([n.cmd, Math.round(n.t * 10) / 10, Math.round(n.dist)]).toEqual([1, 0.5, 2]);
  });
});
