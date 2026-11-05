/**
 * 애니메이션 재생기 (React 훅): 슬라이드 쇼와 편집기 미리 보기에서 공용.
 * 상태(끝난 단계 수 + 진행 중 시간)만 관리하고, 화면 상태는 frameStates로 계산한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Slide } from '../../types/model';
import { buildTimeline, frameStates, type PlayState } from './timeline';

export interface PlayerApi {
  frames: ReturnType<typeof frameStates>;
  /** 다음 단계 (재생 중이면 즉시 끝냄). 소비했으면 true, 더 없으면 false */
  next: () => boolean;
  /** 이전 단계로. 소비했으면 true */
  prev: () => boolean;
  /** 트리거 개체 클릭 */
  trigger: (objId: string) => boolean;
  /** 모든 단계가 끝났고 재생 중이 아님 */
  finished: boolean;
  playing: boolean;
  /** 마지막 상태로 (이전 슬라이드로 돌아올 때) */
  toEnd: () => void;
  /** 처음부터 모든 단계를 자동으로 연속 재생 (미리 보기) */
  playAll: () => void;
  hasTrigger: (objId: string) => boolean;
}

const now = () => performance.now();

export function useAnimationPlayer(slide: Slide | undefined, slideW: number, slideH: number, opts: { startAtEnd?: boolean; autoplay?: boolean } = {}): PlayerApi {
  const tl = useMemo(() => buildTimeline(slide?.animations ?? []), [slide?.animations]);
  const initialDone = (atEnd?: boolean) => (atEnd ? tl.steps.length : 0);
  const [st, setSt] = useState<PlayState>({ done: initialDone(opts.startAtEnd), t: null });
  const startRef = useRef<number | null>(null);
  const triggerStart = useRef(new Map<string, number>());
  const auto = useRef(false);
  const [, force] = useState(0);

  // 슬라이드가 바뀌면 초기화 (첫 단계가 자동이면 바로 재생)
  useEffect(() => {
    triggerStart.current.clear();
    auto.current = false;
    if (opts.startAtEnd) {
      setSt({ done: tl.steps.length, t: null });
      startRef.current = null;
    } else if (tl.steps[0]?.auto || opts.autoplay) {
      setSt({ done: 0, t: 0 });
      startRef.current = now();
      auto.current = !!opts.autoplay;
    } else {
      setSt({ done: 0, t: null });
      startRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.id, tl]);

  const playing = st.t !== null || triggerStart.current.size > 0;

  // 프레임 루프
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setSt((cur) => {
        const triggered = new Map<string, { done: number; t: number | null }>();
        for (const [k, t0] of triggerStart.current) {
          const steps = tl.triggers.get(k) ?? [];
          const prevDone = cur.triggered?.get(k)?.done ?? 0;
          const t = now() - t0;
          if (t >= (steps[prevDone]?.duration ?? 0)) {
            triggered.set(k, { done: prevDone + 1, t: null });
            triggerStart.current.delete(k);
          } else triggered.set(k, { done: prevDone, t });
        }
        for (const [k, v] of cur.triggered ?? []) if (!triggered.has(k)) triggered.set(k, v);
        if (cur.t === null || startRef.current === null) return { ...cur, triggered };
        const t = now() - startRef.current;
        const step = tl.steps[cur.done];
        const loops = step?.items.some((i) => i.anim.repeat === 0);
        if (!step || (t >= step.duration && !loops)) {
          const done = cur.done + 1;
          // 미리 보기: 다음 단계 자동 연속 / 다음 단계가 '이전 효과 다음에'로 시작하는 경우는 없음(클릭 시작)
          if (auto.current && done < tl.steps.length) {
            startRef.current = now();
            return { done, t: 0, triggered };
          }
          startRef.current = null;
          auto.current = false;
          return { done, t: null, triggered };
        }
        return { done: cur.done, t, triggered };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl]);

  const next = useCallback(() => {
    if (st.t !== null) {
      // 재생 중 클릭: 현재 단계를 즉시 끝냄
      startRef.current = null;
      auto.current = false;
      setSt((cur) => ({ ...cur, done: cur.done + 1, t: null }));
      return true;
    }
    if (st.done < tl.steps.length) {
      startRef.current = now();
      setSt((cur) => ({ ...cur, t: 0 }));
      return true;
    }
    return false;
  }, [tl, st]);

  const prev = useCallback(() => {
    const minDone = tl.steps[0]?.auto ? 1 : 0;
    if (st.t === null && st.done <= minDone) return false;
    startRef.current = null;
    setSt((cur) => ({ ...cur, done: Math.max(minDone, cur.t !== null ? cur.done : cur.done - 1), t: null }));
    return true;
  }, [tl, st]);

  const trigger = useCallback(
    (objId: string) => {
      const steps = tl.triggers.get(objId);
      if (!steps?.length) return false;
      const done = st.triggered?.get(objId)?.done ?? 0;
      // 모두 재생했으면 처음부터 다시
      if (done >= steps.length) {
        setSt((cur) => {
          const m = new Map(cur.triggered);
          m.set(objId, { done: 0, t: 0 });
          return { ...cur, triggered: m };
        });
      }
      triggerStart.current.set(objId, now());
      force((n) => n + 1);
      return true;
    },
    [tl, st],
  );

  const frames = useMemo(() => frameStates(slide?.objects ?? [], tl, st, slideW, slideH), [slide?.objects, tl, st, slideW, slideH]);

  return {
    frames,
    next,
    prev,
    trigger,
    finished: st.done >= tl.steps.length && st.t === null,
    playing,
    toEnd: () => {
      startRef.current = null;
      setSt({ done: tl.steps.length, t: null });
    },
    playAll: () => {
      auto.current = true;
      startRef.current = now();
      setSt({ done: 0, t: 0 });
    },
    hasTrigger: (id: string) => tl.triggers.has(id),
  };
}
