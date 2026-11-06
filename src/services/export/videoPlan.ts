/**
 * 비디오로 내보내기 시간 계획 (순수 함수).
 * PowerPoint "비디오 만들기"와 같은 규칙:
 *  - 숨긴 슬라이드는 넣지 않음
 *  - "기록된 시간 및 내레이션 사용"이면 슬라이드마다 기록된 시간(advanceAfter), 없으면 "각 슬라이드에 소요된 시간"(기본 5초)
 *  - 전환 효과는 슬라이드 시간 앞에 재생, 클릭으로 시작하는 애니메이션은 슬라이드 시간 안에 고르게 나눠 자동 재생
 *  - 내레이션이 슬라이드 시간보다 길면 슬라이드를 늘림 (내레이션이 잘리지 않게)
 */
import type { Presentation, Slide } from '../../types/model';
import { buildTimeline, type PlayState } from '../../engines/animation/timeline';

export interface VideoTimingOptions {
  /** 기록된 시간(advanceAfter)·내레이션 사용 */
  useRecorded: boolean;
  /** 기록이 없는 슬라이드의 표시 시간 (초) */
  secondsPerSlide: number;
}

export interface StepPlan {
  /** 슬라이드 표시 시작(전환 끝) 기준 시작 시각 ms */
  at: number;
  duration: number;
}

export interface SlidePlan {
  slide: Slide;
  /** 영상 전체 기준 이 슬라이드(전환 포함) 시작 ms */
  start: number;
  transitionMs: number;
  /** 전환 후 표시 시간 ms */
  holdMs: number;
  steps: StepPlan[];
  /** 내레이션 길이 ms (알 때) */
  narrationMs?: number;
}

export interface VideoPlan {
  slides: SlidePlan[];
  totalMs: number;
}

/** 슬라이드 목록과 내레이션 길이(ms, 슬라이드 ID별) → 계획 */
export function planVideo(doc: Presentation, opts: VideoTimingOptions, narrationMs: Record<string, number> = {}): VideoPlan {
  const out: SlidePlan[] = [];
  let t = 0;
  const visible = doc.slides.filter((s) => !s.hidden);
  visible.forEach((slide, i) => {
    const tl = buildTimeline(slide.animations);
    // 첫 슬라이드의 전환도 재생 (PowerPoint와 같음: 검은 화면에서 들어옴)
    const transitionMs = slide.transition && slide.transition.type !== 'none' ? Math.max(0, slide.transition.duration) : 0;
    const recorded = opts.useRecorded ? slide.transition?.advanceAfter : undefined;
    const narr = opts.useRecorded ? narrationMs[slide.id] : undefined;
    const animTotal = tl.steps.reduce((n, s) => n + s.duration, 0);
    let hold = recorded ?? opts.secondsPerSlide * 1000;
    hold = Math.max(hold, animTotal + (tl.steps.length ? 500 : 0), narr ?? 0);
    if (i === visible.length - 1) hold = Math.max(hold, 500);
    // 단계 배치: 자동 단계는 0에, 클릭 단계는 남는 시간을 (클릭 수 + 1)로 나눠 사이사이에
    const clicks = tl.steps.filter((s) => !s.auto).length;
    const gap = clicks ? Math.max(0, hold - animTotal) / (clicks + 1) : 0;
    const steps: StepPlan[] = [];
    let at = 0;
    for (const s of tl.steps) {
      if (!s.auto) at += gap;
      steps.push({ at, duration: s.duration });
      at += s.duration;
    }
    out.push({ slide, start: t, transitionMs, holdMs: hold, steps, ...(narr ? { narrationMs: narr } : {}) });
    t += transitionMs + hold;
  });
  return { slides: out, totalMs: t };
}

export type FrameState =
  | { kind: 'transition'; index: number; p: number }
  | { kind: 'slide'; index: number; play: PlayState };

/** 영상 시각(ms) → 그릴 상태 */
export function stateAt(plan: VideoPlan, ms: number): FrameState {
  let idx = plan.slides.findIndex((s) => ms < s.start + s.transitionMs + s.holdMs);
  if (idx < 0) idx = plan.slides.length - 1;
  const sp = plan.slides[idx];
  const local = ms - sp.start;
  if (local < sp.transitionMs) return { kind: 'transition', index: idx, p: local / sp.transitionMs };
  const t = local - sp.transitionMs;
  let done = 0;
  for (const st of sp.steps) {
    if (t >= st.at + st.duration) done++;
    else if (t >= st.at) return { kind: 'slide', index: idx, play: { done, t: t - st.at } };
    else break;
  }
  return { kind: 'slide', index: idx, play: { done, t: null } };
}

/** 같은 그림이 되는 상태끼리 같은 키 (정지 구간은 다시 그리지 않음) */
export function stateKey(s: FrameState, fps: number): string {
  if (s.kind === 'transition') return `t${s.index}`; // 전환은 캔버스 합성 (그림 두 장 재사용)
  const t = s.play.t === null ? '-' : Math.round((s.play.t * fps) / 1000);
  return `s${s.index}:${s.play.done}:${t}`;
}

/** 해상도 (PowerPoint: 4K / 전체 HD / HD / 표준) — 슬라이드 비율 유지 (짝수 픽셀) */
export const VIDEO_QUALITIES = [
  { id: '2160', name: 'Ultra HD (4K)', height: 2160 },
  { id: '1080', name: '전체 HD (1080p)', height: 1080 },
  { id: '720', name: 'HD (720p)', height: 720 },
  { id: '480', name: '표준 (480p)', height: 480 },
] as const;

export function videoSize(doc: Pick<Presentation, 'size'>, height: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even((height * doc.size.width) / doc.size.height), height: even(height) };
}
