import { describe, expect, it } from 'vitest';
import { buildTimeline, clickCount, frameStates, frameToCss } from './timeline';
import { EFFECTS, PATH_PRESETS } from './effects';
import { transitionFrame, TRANSITIONS } from '../transition/transitions';
import type { Animation, SlideObject } from '../../types/model';

const obj = (id: string, x = 100, y = 100): SlideObject => ({ id, type: 'shape', shape: 'rect', name: id, x, y, width: 100, height: 50, rotation: 0, fill: { type: 'none' }, stroke: null, text: { paragraphs: [], vAlign: 'top', direction: 'horizontal', padding: { top: 0, right: 0, bottom: 0, left: 0 }, autoFit: 'none', wrap: true } } as SlideObject);
let n = 0;
const anim = (targetId: string, effect: string, category: Animation['category'], start: Animation['start'] = 'onClick', extra: Partial<Animation> = {}): Animation => ({
  id: `a${n++}`, targetId, effect, category, start, duration: 1000, delay: 0, repeat: 1, ...extra,
});

describe('애니메이션 타임라인', () => {
  it('클릭/함께/다음에 → 단계와 시작 시각', () => {
    const tl = buildTimeline([
      anim('A', 'fade', 'entrance'),
      anim('B', 'fade', 'entrance', 'withPrevious', { delay: 200 }),
      anim('C', 'flyIn', 'entrance', 'afterPrevious'),
      anim('D', 'spin', 'emphasis', 'onClick'),
    ]);
    expect(tl.steps).toHaveLength(2);
    expect(tl.steps[0].items.map((i) => [i.start, i.end])).toEqual([[0, 1000], [200, 1200], [1200, 2200]]);
    expect(tl.steps[0].duration).toBe(2200);
    expect(clickCount(tl)).toBe(2);
  });

  it('첫 효과가 클릭이 아니면 자동 단계', () => {
    const tl = buildTimeline([anim('A', 'fade', 'entrance', 'afterPrevious', { delay: 500 }), anim('B', 'fade', 'entrance')]);
    expect(tl.steps[0].auto).toBe(true);
    expect(tl.steps[0].items[0].start).toBe(500);
    expect(clickCount(tl)).toBe(1);
  });

  it('나타내기 대상은 시작 전 숨김, 진행 중 불투명도, 끝나면 보임', () => {
    const objs = [obj('A'), obj('B')];
    const tl = buildTimeline([anim('A', 'fade', 'entrance')]);
    const before = frameStates(objs, tl, { done: 0, t: null }, 1280, 720);
    expect(before.get('A')?.visible).toBe(false);
    expect(before.has('B')).toBe(false); // 애니메이션 없는 개체는 그대로
    const mid = frameStates(objs, tl, { done: 0, t: 500 }, 1280, 720).get('A')!;
    expect(mid.visible).toBe(true);
    expect(mid.opacity).toBeGreaterThan(0.3);
    expect(mid.opacity).toBeLessThan(0.7);
    expect(frameStates(objs, tl, { done: 1, t: null }, 1280, 720).get('A')).toMatchObject({ visible: true, opacity: 1 });
  });

  it('끝내기 후 숨김, 강조(크게/작게)는 유지, 회전은 원위치', () => {
    const objs = [obj('A')];
    const tl = buildTimeline([anim('A', 'growShrink', 'emphasis'), anim('A', 'spin', 'emphasis'), anim('A', 'fadeOut', 'exit')]);
    const s1 = frameStates(objs, tl, { done: 2, t: null }, 1280, 720).get('A')!;
    expect(s1).toMatchObject({ visible: true, sx: 1.5, rotate: 0 });
    const half = frameStates(objs, tl, { done: 1, t: 500 }, 1280, 720).get('A')!;
    expect(half.rotate).toBeCloseTo(180, 0);
    expect(frameStates(objs, tl, { done: 3, t: null }, 1280, 720).get('A')!.visible).toBe(false);
  });

  it('날아오기: 아래쪽 화면 밖에서 시작', () => {
    const objs = [obj('A', 100, 300)];
    const tl = buildTimeline([anim('A', 'flyIn', 'entrance', 'onClick', { direction: 'down' })]);
    const f = frameStates(objs, tl, { done: 0, t: 0 }, 1280, 720).get('A')!;
    expect(f.ty).toBeCloseTo(720 - 300);
    expect(frameStates(objs, tl, { done: 0, t: 1000 }, 1280, 720).get('A')!.ty).toBeCloseTo(0);
  });

  it('이동 경로: 끝나면 마지막 점 위치 유지', () => {
    const path = PATH_PRESETS.find((p) => p.id === 'right')!.build(0, 0);
    const tl = buildTimeline([anim('A', 'path', 'path', 'onClick', { path })]);
    expect(frameStates([obj('A')], tl, { done: 1, t: null }, 1280, 720).get('A')).toMatchObject({ tx: 240, ty: 0 });
  });

  it('반복 2회: 끝 시각 = 재생 시간 × 2', () => {
    const tl = buildTimeline([anim('A', 'pulse', 'emphasis', 'onClick', { repeat: 2 })]);
    expect(tl.steps[0].items[0].end).toBe(2000);
  });

  it('트리거 시퀀스는 기본 순서와 분리', () => {
    const tl = buildTimeline([anim('A', 'fade', 'entrance'), anim('B', 'spin', 'emphasis', 'withPrevious', { triggerId: 'T' })]);
    expect(tl.steps).toHaveLength(1);
    expect(tl.triggers.get('T')![0].items[0].anim.targetId).toBe('B');
    const st = frameStates([obj('B')], tl, { done: 0, t: null, triggered: new Map([['T', { done: 0, t: 500 }]]) }, 1280, 720);
    expect(st.get('B')!.rotate).toBeCloseTo(180, 0);
  });

  it('프레임 → CSS', () => {
    expect(frameToCss({ visible: false }, 0)!.visibility).toBe('hidden');
    expect(frameToCss({ tx: 10, ty: 5, rotate: 30, sx: 2, sy: 2 }, 15)!.transform).toBe('translate(10.00px, 5.00px) rotate(45.00deg) scale(2.0000, 2.0000)');
  });

  it('모든 효과의 프레임 계산이 유한값', () => {
    const c = { x: 10, y: 10, w: 100, h: 50, slideW: 1280, slideH: 720, path: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
    for (const e of EFFECTS)
      for (const p of [0, 0.3, 1]) {
        const f = e.frame(p, { ...c, dir: e.directions?.[0] });
        for (const v of [f.opacity, f.tx, f.ty, f.sx, f.sy, f.rotate]) if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
      }
  });
});

describe('전환 효과', () => {
  it('모든 전환: 끝(p=1)에 다음 슬라이드가 완전히 보임', () => {
    for (const t of TRANSITIONS) {
      const f = transitionFrame({ type: t.id, duration: 1000, direction: t.directions?.[0] }, 1);
      expect(f.next.opacity ?? 1).toBe(1);
      if (f.next.clipPath) expect(f.next.clipPath).toMatch(/inset\(0(\.00%)? 0(\.00%)? 0(\.00%)? 0(\.00%)?\)|circle\(75\.00%|inset\(0 0\.00% 0 0\.00%\)|inset\(0\.00% 0 0\.00% 0\)/);
    }
  });
  it('밀어내기 왼쪽: 다음 슬라이드가 오른쪽에서 들어옴', () => {
    expect(transitionFrame({ type: 'push', duration: 1000, direction: 'left' }, 0).next.transform).toBe('translate(100%, 0%)');
  });
});
