/**
 * PPTX p:transition / p:timing → SlideLab 전환·애니메이션 모델.
 * 해석하지 못한 효과는 비슷한 효과로 표시하고, 내용을 바꾸지 않으면 저장 시 원본 XML을 그대로 쓴다.
 */
import type { Animation, AnimationCategory, AnimationStart, Direction, SlideObject, SlideTransition, TransitionType } from '../../types/model';
import { kid, kids, numAttr } from './ooxml';
import { newId } from '../../utils/id';
import { PRESET_IDS, SUBTYPE } from '../export/animXml';

const DIR_FROM: Record<string, Direction> = { l: 'left', r: 'right', u: 'up', d: 'down' };

export function parseTransition(el: Element): SlideTransition | null {
  // mc:AlternateContent면 p14를 이해하므로 Choice 사용
  let tr: Element | null = el.localName === 'transition' ? el : null;
  if (el.localName === 'AlternateContent') tr = kid(kid(el, 'Choice'), 'transition') ?? kid(kid(el, 'Fallback'), 'transition');
  if (!tr) return null;
  const child = kids(tr).find((c) => c.localName !== 'sndAc' && c.localName !== 'extLst');
  const p14dur = tr.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'dur') || tr.getAttribute('p14:dur');
  const spd = tr.getAttribute('spd') ?? 'fast';
  const duration = p14dur ? Number(p14dur) : spd === 'slow' ? 1000 : spd === 'med' ? 750 : 500;
  const advClick = tr.getAttribute('advClick') !== '0';
  const advTm = numAttr(tr, 'advTm');
  const dir = child?.getAttribute('dir') ?? '';
  let type: TransitionType = 'none';
  let direction: SlideTransition['direction'];
  switch (child?.localName) {
    case undefined:
      type = 'none';
      break;
    case 'fade':
      type = child.getAttribute('thruBlk') === '1' || child.getAttribute('thruBlk') === 'true' ? 'fadeBlack' : 'fade';
      break;
    case 'push':
    case 'wipe':
    case 'cover':
      type = child.localName as TransitionType;
      direction = DIR_FROM[dir] ?? 'left';
      break;
    case 'pull':
      type = 'uncover';
      direction = DIR_FROM[dir] ?? 'left';
      break;
    case 'split':
      type = 'split';
      direction = `${child.getAttribute('orient') === 'horz' ? 'horizontal' : 'vertical'}${child.getAttribute('dir') === 'in' ? 'In' : 'Out'}` as SlideTransition['direction'];
      break;
    case 'circle':
      type = 'circle';
      break;
    case 'zoom':
      type = 'zoom';
      break;
    case 'vortex':
    case 'wheel':
    case 'swirl':
      type = 'rotate';
      break;
    case 'flip':
      type = 'flip';
      direction = dir === 'r' ? 'right' : 'left';
      break;
    default:
      // 지원하지 않는 전환: 페이드로 표시 (원본은 저장 시 보존)
      type = 'fade';
  }
  return {
    type,
    duration: type === 'none' ? 0 : duration,
    ...(direction ? { direction } : {}),
    ...(advClick ? { advanceOnClick: true } : { advanceOnClick: false }),
    ...(advTm !== undefined ? { advanceAfter: advTm } : {}),
  };
}

/** presetClass + presetID → 효과 ID */
function effectFor(cls: string, id: number): { effect: string; category: AnimationCategory } | null {
  const category: AnimationCategory = cls === 'entr' ? 'entrance' : cls === 'exit' ? 'exit' : cls === 'emph' ? 'emphasis' : 'path';
  if (category === 'path') return { effect: 'path', category };
  const candidates = Object.entries(PRESET_IDS).filter(([, v]) => v === id).map(([k]) => k);
  const isExitId = (k: string) => ['disappear', 'flyOut', 'fadeOut', 'wipeOut', 'splitOut', 'zoomOut', 'floatOut'].includes(k);
  const pick = candidates.find((k) => (category === 'exit' ? isExitId(k) : category === 'entrance' ? !isExitId(k) && !['pulse', 'spin', 'growShrink', 'teeter', 'transparency'].includes(k) : ['pulse', 'spin', 'growShrink', 'teeter', 'transparency'].includes(k)));
  return pick ? { effect: pick, category } : null;
}

const SUBTYPE_DIR = Object.fromEntries(Object.entries(SUBTYPE).map(([k, v]) => [v, k])) as Record<number, Direction>;

function maxDur(par: Element): number {
  let m = 0;
  for (const el of Array.from(par.getElementsByTagName('*'))) {
    if (el.localName !== 'cTn') continue;
    const d = Number(el.getAttribute('dur'));
    if (Number.isFinite(d) && d > 1) m = Math.max(m, d);
  }
  return m || 500;
}

function firstSpid(el: Element): string | null {
  for (const e of Array.from(el.getElementsByTagName('*'))) if (e.localName === 'spTgt') return e.getAttribute('spid');
  return null;
}

/** p:timing → 애니메이션. objects의 sourceId로 대상 매칭. 해석 못 한 효과 수도 반환 */
export function parseTiming(timing: Element, objects: SlideObject[], slideW: number, slideH: number): { animations: Animation[]; approximated: number; skipped: number } {
  const bySpid = new Map(objects.filter((o) => o.sourceId !== undefined).map((o) => [String(o.sourceId), o.id]));
  const out: Animation[] = [];
  let approximated = 0;
  let skipped = 0;
  const root = kid(kid(kid(timing, 'tnLst'), 'par'), 'cTn');
  const seqs = kids(kid(root, 'childTnLst'), 'seq');

  const readStep = (stepPar: Element, triggerId?: string) => {
    const groups = kids(kid(kid(stepPar, 'cTn'), 'childTnLst'), 'par');
    for (const g of groups) {
      for (const effPar of kids(kid(kid(g, 'cTn'), 'childTnLst'), 'par')) {
        const c = kid(effPar, 'cTn');
        if (!c) continue;
        const spid = firstSpid(effPar);
        const target = spid ? bySpid.get(spid) : undefined;
        if (!target) {
          skipped++;
          continue;
        }
        const cls = c.getAttribute('presetClass') ?? 'entr';
        const pid = numAttr(c, 'presetID') ?? 1;
        let m = effectFor(cls, pid);
        if (!m) {
          approximated++;
          m = cls === 'exit' ? { effect: 'fadeOut', category: 'exit' } : cls === 'emph' ? { effect: 'pulse', category: 'emphasis' } : { effect: 'fade', category: 'entrance' };
        }
        const nodeType = c.getAttribute('nodeType');
        const start: AnimationStart = nodeType === 'withEffect' ? 'withPrevious' : nodeType === 'afterEffect' ? 'afterPrevious' : 'onClick';
        const delay = numAttr(kid(kid(c, 'stCondLst'), 'cond'), 'delay') ?? 0;
        const rc = c.getAttribute('repeatCount');
        const repeat = rc === 'indefinite' ? 0 : rc ? Math.max(1, Math.round(Number(rc) / 1000)) : 1;
        const sub = numAttr(c, 'presetSubtype') ?? 0;
        const a: Animation = {
          id: newId(),
          targetId: target,
          category: m.category,
          effect: m.effect,
          start,
          // 펄스는 왕복(autoRev), 흔들기는 4구간 연속 → 전체 재생 시간으로 환산
          duration: m.effect === 'appear' || m.effect === 'disappear' ? 0 : maxDur(effPar) * (m.effect === 'pulse' && /autoRev="1"/.test(effPar.outerHTML ?? new XMLSerializer().serializeToString(effPar)) ? 2 : m.effect === 'teeter' ? 4 : 1),
          delay,
          repeat,
          ...(SUBTYPE_DIR[sub] && (m.effect.startsWith('fly') || m.effect.startsWith('wipe')) ? { direction: SUBTYPE_DIR[sub] } : m.effect.startsWith('fly') || m.effect.startsWith('wipe') ? { direction: 'down' as Direction } : {}),
          ...(triggerId ? { triggerId } : {}),
        };
        if (m.category === 'path') {
          const motion = Array.from(effPar.getElementsByTagName('*')).find((e) => e.localName === 'animMotion');
          const d = motion?.getAttribute('path') ?? '';
          const nums = d.replace(/[A-Za-z]/g, ' ').trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
          const pts: { x: number; y: number }[] = [];
          for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] * slideW, y: nums[i + 1] * slideH });
          a.path = pts.length >= 2 ? pts : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
          if (/[CcQqAa]/.test(d)) approximated++; // 곡선은 직선 구간으로 근사
        }
        out.push(a);
      }
    }
  };

  for (const seq of seqs) {
    const c = kid(seq, 'cTn');
    const type = c?.getAttribute('nodeType');
    if (type === 'mainSeq') for (const stepPar of kids(kid(c, 'childTnLst'), 'par')) readStep(stepPar);
    else if (type === 'interactiveSeq') {
      const spid = firstSpid(kid(c, 'stCondLst') ?? c!);
      const trig = spid ? bySpid.get(spid) : undefined;
      if (!trig) {
        skipped++;
        continue;
      }
      for (const stepPar of kids(kid(c, 'childTnLst'), 'par')) readStep(stepPar, trig);
    }
  }
  return { animations: out, approximated, skipped };
}
