/**
 * 애니메이션 타임라인 / 상태 계산 (순수 함수).
 *
 * 단계(step): 클릭 한 번에 재생되는 묶음. '클릭할 때'가 새 단계를 시작하고,
 * '이전 효과와 함께'는 이전 효과와 같은 시각에, '이전 효과 다음에'는 이전 효과가 끝난 뒤 시작한다.
 * 첫 효과가 클릭이 아니면 슬라이드가 나타날 때 자동으로 재생되는 단계(auto)가 된다.
 * 트리거 애니메이션은 대상 개체를 클릭할 때 재생되는 별도 시퀀스다.
 */
import type { Animation, SlideObject } from '../../types/model';
import { compose, effectById, type Frame } from './effects';

export interface TimedAnim {
  anim: Animation;
  start: number; // 단계 시작 기준 ms
  end: number;
}

export interface Step {
  items: TimedAnim[];
  duration: number;
  /** 클릭 없이 자동 재생 */
  auto: boolean;
}

export interface Timeline {
  steps: Step[];
  /** 트리거 개체 ID → 그 개체 클릭 시 재생 단계들 */
  triggers: Map<string, Step[]>;
}

/** '다음 클릭까지 반복'(repeat 0)은 한 주기를 기준으로 연결한다 */
const span = (a: Animation) => a.duration * (a.repeat > 0 ? a.repeat : 1);

/**
 * PowerPoint와 같은 시간 규칙:
 * - 클릭할 때: 새 단계, 묶음 시작 = 0
 * - 이전 효과와 함께: 현재 묶음 시작 + 지연
 * - 이전 효과 다음에: 지금까지 끝난 시각에 새 묶음 시작 + 지연
 */
function buildSteps(anims: Animation[]): Step[] {
  const steps: Step[] = [];
  let cur: Step | null = null;
  let groupStart = 0;
  for (const a of anims) {
    if (!cur || a.start === 'onClick') {
      cur = { items: [], duration: 0, auto: !cur && a.start !== 'onClick' };
      steps.push(cur);
      groupStart = 0;
    } else if (a.start === 'afterPrevious') groupStart = cur.duration;
    const t = { anim: a, start: groupStart + a.delay, end: groupStart + a.delay + span(a) };
    cur.items.push(t);
    cur.duration = Math.max(cur.duration, t.end);
  }
  return steps;
}

export function buildTimeline(anims: Animation[] = []): Timeline {
  const main = anims.filter((a) => !a.triggerId);
  const triggers = new Map<string, Step[]>();
  const byTrigger = new Map<string, Animation[]>();
  for (const a of anims) if (a.triggerId) byTrigger.set(a.triggerId, [...(byTrigger.get(a.triggerId) ?? []), a]);
  for (const [k, list] of byTrigger) triggers.set(k, buildSteps(list.map((a, i) => (i === 0 ? { ...a, start: 'onClick' } : a))));
  return { steps: buildSteps(main), triggers };
}

/** 클릭으로 진행하는 단계 수 (자동 단계 제외) */
export const clickCount = (tl: Timeline) => tl.steps.filter((s) => !s.auto).length;

export interface PlayState {
  /** 완전히 끝난 단계 수 */
  done: number;
  /** 진행 중 단계의 경과 시간 (ms). null이면 진행 중 단계 없음 */
  t: number | null;
  /** 트리거별 재생 상태: [끝난 단계 수, 진행 중 시간] */
  triggered?: Map<string, { done: number; t: number | null }>;
}

/**
 * 각 개체의 현재 프레임. 반환에 없는 개체는 원래 상태.
 * 첫 애니메이션이 나타내기인 개체는 그 효과 전까지 숨겨진다.
 */
export function frameStates(objects: SlideObject[], tl: Timeline, st: PlayState, slideW: number, slideH: number): Map<string, Frame> {
  const byId = new Map(objects.map((o) => [o.id, o]));
  // 시간 순서로 '재생된 부분' 수집: [anim, 진행률(0..1 또는 <0 미시작)]
  const events: { anim: Animation; p: number; order: number }[] = [];
  let order = 0;
  const collect = (steps: Step[], done: number, t: number | null) => {
    steps.forEach((step, i) => {
      for (const it of step.items) {
        let p: number;
        if (i < done) p = 1;
        else if (i === done && t !== null) {
          if (t < it.start) p = -1;
          else if (it.anim.repeat === 0) p = it.end > it.start ? ((t - it.start) % (it.end - it.start)) / (it.end - it.start) || (t > it.start ? 0.999 : 0) : 1;
          else {
            const d = it.end - it.start;
            if (d <= 0) p = 1;
            else {
              const cycles = (t - it.start) / it.anim.duration;
              p = t >= it.end ? 1 : cycles - Math.floor(cycles);
            }
          }
        } else p = -1;
        events.push({ anim: it.anim, p, order: order++ });
      }
    });
  };
  collect(tl.steps, st.done, st.t);
  for (const [k, steps] of tl.triggers) {
    const ts = st.triggered?.get(k) ?? { done: 0, t: null };
    collect(steps, ts.done, ts.t);
  }

  const out = new Map<string, Frame>();
  const firstCategory = new Map<string, string>();
  for (const e of events) if (!firstCategory.has(e.anim.targetId)) firstCategory.set(e.anim.targetId, e.anim.category);

  for (const [id, cat] of firstCategory) {
    const o = byId.get(id);
    if (!o) continue;
    let state: Frame = { visible: cat !== 'entrance' };
    for (const e of events) {
      if (e.anim.targetId !== id || e.p < 0) continue;
      const def = effectById(e.anim.effect);
      if (!def) continue;
      const ctx = { dir: e.anim.direction, x: o.x, y: o.y, w: o.width, h: o.height, slideW, slideH, path: e.anim.path };
      if (e.p >= 1) state = compose(state, def.final(ctx));
      else state = compose({ ...state, visible: def.category === 'entrance' ? true : state.visible }, def.frame(e.p, ctx));
    }
    out.set(id, state);
  }
  return out;
}

/** 프레임 → CSS (회전/위치는 개체 자체 transform 위에 덧붙임) */
export function frameToCss(f: Frame | undefined, baseRotation: number): React.CSSProperties | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.tx || f.ty) parts.push(`translate(${(f.tx ?? 0).toFixed(2)}px, ${(f.ty ?? 0).toFixed(2)}px)`);
  const rot = baseRotation + (f.rotate ?? 0);
  if (rot) parts.push(`rotate(${rot.toFixed(2)}deg)`);
  if ((f.sx ?? 1) !== 1 || (f.sy ?? 1) !== 1) parts.push(`scale(${(f.sx ?? 1).toFixed(4)}, ${(f.sy ?? 1).toFixed(4)})`);
  return {
    visibility: f.visible === false ? 'hidden' : undefined,
    opacity: f.opacity,
    transform: parts.length ? parts.join(' ') : undefined,
    clipPath: f.clip,
  };
}
