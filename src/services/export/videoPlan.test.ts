import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createPresentation } from '../../core/document/factory';
import { addSlide } from '../../core/commands/commands';
import { planVideo, stateAt, stateKey, videoSize } from './videoPlan';
import type { Animation } from '../../types/model';

const anim = (targetId: string, start: Animation['start'], duration = 500): Animation =>
  ({ id: `a-${targetId}-${start}-${Math.random()}`, targetId, effect: 'fade', category: 'entrance', start, delay: 0, duration, repeat: 1 }) as Animation;

function deck() {
  return produce(createPresentation('비디오'), (d) => {
    const id2 = addSlide(d, d.slides[0].id, 'blank');
    addSlide(d, id2, 'blank');
    const [s1, s2, s3] = d.slides;
    const t = s1.objects[0].id;
    // 1: 클릭 애니메이션 2개
    s1.animations = [anim(t, 'onClick'), anim(t, 'onClick')];
    // 2: 페이드 전환 1초 + 기록된 시간 2초 + 자동 애니메이션
    s2.transition = { type: 'fade', duration: 1000, advanceAfter: 2000 };
    s2.animations = [anim('x', 'withPrevious', 400)];
    s3.hidden = true;
  });
}

describe('비디오 계획', () => {
  it('숨긴 슬라이드 제외, 기록된 시간/기본 시간, 전환 시간', () => {
    const p = planVideo(deck(), { useRecorded: true, secondsPerSlide: 5 });
    expect(p.slides).toHaveLength(2);
    expect(p.slides[0]).toMatchObject({ start: 0, transitionMs: 0, holdMs: 5000 });
    expect(p.slides[1]).toMatchObject({ start: 5000, transitionMs: 1000, holdMs: 2000 });
    expect(p.totalMs).toBe(8000);
    // 기록 무시 → 기본 시간
    expect(planVideo(deck(), { useRecorded: false, secondsPerSlide: 3 }).slides[1].holdMs).toBe(3000);
  });

  it('클릭 애니메이션은 남는 시간을 고르게 나눠 배치, 자동 단계는 0에', () => {
    const p = planVideo(deck(), { useRecorded: true, secondsPerSlide: 5 });
    // 5000 - 1000(애니메이션) = 4000 / 3 간격
    const gap = 4000 / 3;
    expect(p.slides[0].steps.map((s) => Math.round(s.at))).toEqual([Math.round(gap), Math.round(gap * 2 + 500)]);
    expect(p.slides[1].steps).toEqual([{ at: 0, duration: 400 }]);
  });

  it('내레이션이 길면 슬라이드를 늘림, 애니메이션보다 짧게 잡히지 않음', () => {
    const d = deck();
    const p = planVideo(d, { useRecorded: true, secondsPerSlide: 5 }, { [d.slides[1].id]: 6500 });
    expect(p.slides[1].holdMs).toBe(6500);
    expect(planVideo(d, { useRecorded: false, secondsPerSlide: 0.2 }).slides[0].holdMs).toBe(1500); // 애니메이션 1000 + 500
  });

  it('시각 → 상태 (전환 진행률, 단계 진행), 정지 구간은 같은 키', () => {
    const p = planVideo(deck(), { useRecorded: true, secondsPerSlide: 5 });
    expect(stateAt(p, 0)).toEqual({ kind: 'slide', index: 0, play: { done: 0, t: null } });
    const at = p.slides[0].steps[0].at;
    expect(stateAt(p, at + 250)).toEqual({ kind: 'slide', index: 0, play: { done: 0, t: 250 } });
    expect(stateAt(p, at + 600)).toEqual({ kind: 'slide', index: 0, play: { done: 1, t: null } });
    expect(stateAt(p, 5500)).toEqual({ kind: 'transition', index: 1, p: 0.5 });
    expect(stateAt(p, 6100)).toMatchObject({ kind: 'slide', index: 1, play: { done: 0 } });
    expect(stateAt(p, 99999)).toMatchObject({ kind: 'slide', index: 1, play: { done: 1, t: null } });
    expect(stateKey(stateAt(p, 100), 30)).toBe(stateKey(stateAt(p, 900), 30));
    expect(stateKey(stateAt(p, at + 100), 30)).not.toBe(stateKey(stateAt(p, at + 200), 30));
  });

  it('해상도: 슬라이드 비율, 짝수 픽셀', () => {
    expect(videoSize({ size: { width: 1280, height: 720, preset: '16:9' } }, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ size: { width: 960, height: 720, preset: '4:3' } }, 480)).toEqual({ width: 640, height: 480 });
    expect(videoSize({ size: { width: 1000, height: 700, preset: 'custom' } }, 481)).toEqual({ width: 688, height: 482 });
  });
});
