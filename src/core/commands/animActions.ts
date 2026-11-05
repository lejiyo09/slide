/** 전환·애니메이션 고수준 동작 (리본/애니메이션 창 공용) */
import { getActiveSlide, useEditor } from '../store/editorStore';
import * as C from './commands';
import type { Animation, AnimationStart, Direction, SlideTransition } from '../../types/model';
import { effectById, PATH_PRESETS } from '../../engines/animation/effects';
import { TRANSITIONS } from '../../engines/transition/transitions';
import { newId } from '../../utils/id';

const st = () => useEditor.getState();

/* ───────────── 전환 ───────────── */

export function applyTransition(type: SlideTransition['type']) {
  const s = st();
  const def = TRANSITIONS.find((t) => t.id === type)!;
  s.commit('전환', (d) =>
    C.setTransition(d, s.selectedSlideIds, {
      type,
      duration: def.defaultDuration,
      direction: def.directions?.[0],
    }),
  );
  if (type !== 'none') previewTransition();
}

export function updateTransition(patch: Partial<SlideTransition>, all = false) {
  const s = st();
  s.commit(all ? '모두 적용' : '전환 옵션', (d) => C.setTransition(d, all ? 'all' : s.selectedSlideIds, patch));
}

export function applyTransitionToAll() {
  const s = st();
  const cur = s.doc.slides.find((x) => x.id === s.activeSlideId)?.transition;
  if (!cur) return;
  s.commit('모두 적용', (d) => C.setTransition(d, 'all', { ...cur }));
  s.toast('현재 전환을 모든 슬라이드에 적용했습니다.', 'success');
}

export function previewTransition() {
  const s = st();
  useEditor.setState({ preview: { kind: 'transition', slideId: s.activeSlideId, key: Date.now() } });
}

/* ───────────── 애니메이션 ───────────── */

/** 선택한 개체들 (애니메이션 대상은 슬라이드 최상위 개체) */
const targets = () => st().selectedIds;

function makeAnim(targetId: string, effectId: string, start: AnimationStart, dir?: Direction, pathPreset?: string): Animation {
  const def = effectById(effectId)!;
  const o = getActiveSlide().objects.find((x) => x.id === targetId);
  const path = def.category === 'path' ? (PATH_PRESETS.find((p) => p.id === (pathPreset ?? 'right')) ?? PATH_PRESETS[0]).build(o?.width ?? 0, o?.height ?? 0) : undefined;
  return {
    id: newId(),
    targetId,
    category: def.category,
    effect: effectId,
    start,
    duration: def.defaultDuration,
    delay: 0,
    repeat: 1,
    ...(dir ?? def.directions?.[0] ? { direction: dir ?? def.directions![0] } : {}),
    ...(path ? { path } : {}),
  };
}

/**
 * 효과 적용 (갤러리): add=false면 선택 개체의 기존 애니메이션을 바꾸고, true면 추가.
 * 여러 개체를 함께 선택하면 첫 개체는 '클릭할 때', 나머지는 '이전 효과와 함께'.
 */
export function applyAnimation(effectId: string, opts: { add?: boolean; pathPreset?: string } = {}) {
  const s = st();
  const ids = targets();
  if (!ids.length) return s.toast('애니메이션을 적용할 개체를 먼저 선택하세요.');
  const slide = getActiveSlide();
  const created = ids.map((id, i) => makeAnim(id, effectId, i === 0 ? 'onClick' : 'withPrevious', undefined, opts.pathPreset));
  s.commit(opts.add ? '애니메이션 추가' : '애니메이션', (d) => {
    const sl = d.slides.find((x) => x.id === slide.id) ?? d.slides[0];
    if (!opts.add && sl.animations) {
      // 같은 개체의 기존 애니메이션 자리에 교체
      const list = sl.animations;
      let insertAt = list.length;
      for (const id of ids) {
        const idx = list.findIndex((a) => a.targetId === id);
        if (idx >= 0) insertAt = Math.min(insertAt, idx);
      }
      sl.animations = list.filter((a) => !ids.includes(a.targetId));
      sl.animations.splice(Math.min(insertAt, sl.animations.length), 0, ...created);
    } else C.addAnimations(d, slide.id, created);
  });
  useEditor.setState({ selectedAnimIds: created.map((a) => a.id) });
  previewAnimation();
}

/** 옵션을 바꿀 대상: 애니메이션 창에서 고른 효과, 없으면 선택 개체의 모든 효과 */
export function targetAnimIds(): string[] {
  const s = st();
  const list = getActiveSlide().animations ?? [];
  const sel = s.selectedAnimIds.filter((id) => list.some((a) => a.id === id));
  if (sel.length) return sel;
  return list.filter((a) => s.selectedIds.includes(a.targetId)).map((a) => a.id);
}

export function updateSelectedAnimations(label: string, fn: (a: Animation) => void) {
  const ids = targetAnimIds();
  if (!ids.length) return;
  st().commit(label, (d) => C.updateAnimations(d, getActiveSlide().id, ids, fn));
}

export function removeSelectedAnimations() {
  const ids = targetAnimIds();
  if (!ids.length) return;
  st().commit('애니메이션 제거', (d) => C.removeAnimations(d, getActiveSlide().id, ids));
  useEditor.setState({ selectedAnimIds: [] });
}

export function moveSelectedAnimation(delta: -1 | 1) {
  const ids = targetAnimIds();
  if (ids.length !== 1) return;
  st().commit('순서 바꾸기', (d) => C.moveAnimation(d, getActiveSlide().id, ids[0], delta));
}

export function setTrigger(triggerId: string | null) {
  updateSelectedAnimations('트리거', (a) => {
    if (triggerId) a.triggerId = triggerId;
    else delete a.triggerId;
  });
}

export function previewAnimation() {
  const s = st();
  if (!getActiveSlide().animations?.length) return;
  useEditor.setState({ preview: { kind: 'animation', slideId: s.activeSlideId, key: Date.now() } });
}
