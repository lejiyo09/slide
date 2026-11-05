import { describe, expect, it } from 'vitest';
import { createPresentation, createSlide } from '../../core/document/factory';
import {
  DEFAULT_SHOW_SETTINGS,
  clampZoom,
  eraseAt,
  inkPathD,
  showSequence,
  startIndexOf,
  stepIndex,
  strokeToShape,
  viewToSlide,
  zoomStep,
  zoomTransform,
  formatDuration,
  appendPoint,
  type InkStroke,
} from './showModel';

const doc5 = () => {
  const d = createPresentation();
  while (d.slides.length < 5) d.slides.push(createSlide('blank', d.size));
  return d;
};

describe('쇼 슬라이드 순서', () => {
  it('전체 / 범위 / 재구성한 쇼', () => {
    const d = doc5();
    expect(showSequence(d, DEFAULT_SHOW_SETTINGS).length).toBe(5);
    const r = showSequence(d, { ...DEFAULT_SHOW_SETTINGS, range: { kind: 'range', from: 2, to: 4 } });
    expect(r.map((s) => s.id)).toEqual(d.slides.slice(1, 4).map((s) => s.id));
    // 범위를 넘는 번호는 잘라냄
    expect(showSequence(d, { ...DEFAULT_SHOW_SETTINGS, range: { kind: 'range', from: 4, to: 99 } }).length).toBe(2);
    d.customShows = [{ id: 'c1', name: '요약', slideIds: [d.slides[4].id, d.slides[0].id, 'deleted'] }];
    expect(showSequence(d, DEFAULT_SHOW_SETTINGS, 'c1').map((s) => s.id)).toEqual([d.slides[4].id, d.slides[0].id]);
    expect(showSequence(d, { ...DEFAULT_SHOW_SETTINGS, range: { kind: 'custom', showId: 'c1' } }).length).toBe(2);
    // 없는 쇼 → 전체
    expect(showSequence(d, DEFAULT_SHOW_SETTINGS, 'nope').length).toBe(5);
  });

  it('숨긴 슬라이드는 이동할 때 건너뛰고, 직접 시작하면 표시', () => {
    const d = doc5();
    d.slides[1].hidden = true;
    d.slides[0].hidden = true;
    expect(stepIndex(d.slides, 2, -1)).toBe(-1);
    expect(stepIndex(d.slides, 0, 1)).toBe(2);
    expect(startIndexOf(d.slides, undefined)).toBe(2);
    expect(startIndexOf(d.slides, d.slides[1].id)).toBe(1);
  });
});

describe('잉크', () => {
  const s: InkStroke = { id: 'a', tool: 'pen', color: '#FF0000', width: 4, points: [100, 100, 200, 150, 300, 100] };
  it('획 → 사용자 지정 도형 (정규화 경로, pt 두께)', () => {
    const sh = strokeToShape(s);
    expect(sh.shape).toBe('custom');
    expect([sh.x, sh.y, sh.width, sh.height]).toEqual([100, 100, 200, 50]);
    expect(sh.geometry!.paths[0].cmds).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 0.5, y: 1 },
      { c: 'L', x: 1, y: 0 },
    ]);
    expect(sh.geometry!.paths[0].fill).toBe(false);
    expect(sh.stroke).toEqual({ color: '#FF0000', width: 3, dash: 'solid' });
    expect(sh.fill.type).toBe('none');
  });
  it('형광펜은 반투명, 점 하나도 도형이 됨', () => {
    const h = strokeToShape({ ...s, tool: 'highlighter', points: [10, 20] });
    expect(h.stroke?.opacity).toBeGreaterThan(0);
    expect(h.width).toBe(1);
    expect(h.geometry!.paths[0].cmds.length).toBe(2);
  });
  it('지우개는 닿은 획만 지움', () => {
    const t: InkStroke = { ...s, id: 'b', points: [0, 600, 50, 600] };
    expect(eraseAt([s, t], 150, 125).map((x) => x.id)).toEqual(['b']);
    expect(eraseAt([s, t], 700, 700)).toHaveLength(2);
  });
  it('경로 문자열과 점 줄이기', () => {
    expect(inkPathD([1, 2, 3, 4])).toBe('M1.0 2.0L3.0 4.0');
    expect(appendPoint([0, 0], 0.5, 0.5)).toEqual([0, 0]);
    expect(appendPoint([0, 0], 5, 0)).toEqual([0, 0, 5, 0]);
  });
});

describe('화면 확대', () => {
  it('중심을 슬라이드 안으로 제한하고 좌표 변환', () => {
    const z = clampZoom({ scale: 2, cx: 0, cy: 0 }, 1280, 720);
    expect(z).toEqual({ scale: 2, cx: 320, cy: 180 });
    expect(zoomTransform(z, 1280, 720)).toBe('scale(2) translate(0px, 0px)');
    const z2 = clampZoom({ scale: 2, cx: 900, cy: 400 }, 1280, 720);
    // 보이는 영역 왼쪽 위 = (580, 220); 화면 (0,0) → 슬라이드 (580,220), 화면 (1280,720) → (1220, 580)
    expect(viewToSlide(z2, 1280, 720, 0, 0)).toEqual({ x: 580, y: 220 });
    expect(viewToSlide(z2, 1280, 720, 1280, 720)).toEqual({ x: 1220, y: 580 });
    expect(zoomTransform({ scale: 1, cx: 640, cy: 360 }, 1280, 720)).toBeUndefined();
  });
  it('배율 단계', () => {
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(4, 1)).toBe(4);
    expect(zoomStep(2, -1)).toBe(1.5);
    expect(zoomStep(1, -1)).toBe(1);
  });
});

it('시간 표시', () => {
  expect(formatDuration(3_725_400)).toBe('01:02:05');
  expect(formatDuration(-5)).toBe('00:00:00');
});
