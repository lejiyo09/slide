/**
 * 전환/애니메이션 → PresentationML (p:transition, p:timing).
 * 재생은 동작 요소(set/anim/animEffect/animScale/animRot/animMotion)가 결정하며,
 * presetID/presetClass는 PowerPoint 애니메이션 창의 효과 이름 표시에 쓰인다.
 */
import type { Animation, Direction, SlideTransition } from '../../types/model';
import { buildTimeline } from '../../engines/animation/timeline';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

/* ───────────── 전환 ───────────── */

const DIR: Record<string, string> = { left: 'l', right: 'r', up: 'u', down: 'd' };

function transitionChild(t: SlideTransition, p14: boolean): string {
  const d = DIR[t.direction ?? 'left'] ?? 'l';
  switch (t.type) {
    case 'fade':
      return '<p:fade/>';
    case 'fadeBlack':
      return '<p:fade thruBlk="1"/>';
    case 'push':
      return `<p:push dir="${d}"/>`;
    case 'wipe':
      return `<p:wipe dir="${d}"/>`;
    case 'split': {
      const dir = t.direction ?? 'verticalOut';
      return `<p:split orient="${dir.startsWith('vertical') ? 'vert' : 'horz'}" dir="${dir.endsWith('In') ? 'in' : 'out'}"/>`;
    }
    case 'cover':
      return `<p:cover dir="${d}"/>`;
    case 'uncover':
      return `<p:pull dir="${d}"/>`;
    case 'circle':
      return '<p:circle/>';
    case 'zoom':
      return '<p:zoom/>';
    case 'rotate':
      return p14 ? `<p14:vortex dir="${d === 'l' || d === 'r' ? d : 'l'}"/>` : '<p:wheel spokes="1"/>';
    case 'flip':
      return p14 ? `<p14:flip dir="${t.direction === 'right' ? 'r' : 'l'}"/>` : '<p:fade/>';
    default:
      return '';
  }
}

export function buildTransitionXml(t: SlideTransition | undefined): string | undefined {
  if (!t) return undefined;
  const hasEffect = t.type !== 'none';
  const adv = `${t.advanceOnClick === false ? ' advClick="0"' : ''}${t.advanceAfter !== undefined ? ` advTm="${Math.round(t.advanceAfter)}"` : ''}`;
  if (!hasEffect && !adv) return undefined;
  const spd = t.duration <= 500 ? 'fast' : t.duration <= 750 ? 'med' : 'slow';
  if (!hasEffect) return `<p:transition xmlns:p="${P}"${adv}/>`;
  // PowerPoint 2010+: 정확한 재생 시간(p14:dur), 이전 버전: spd
  return (
    `<mc:AlternateContent xmlns:mc="${MC}" xmlns:p="${P}" xmlns:p14="${P14}">` +
    `<mc:Choice Requires="p14"><p:transition spd="${spd}" p14:dur="${Math.round(t.duration)}"${adv}>${transitionChild(t, true)}</p:transition></mc:Choice>` +
    `<mc:Fallback><p:transition spd="${spd}"${adv}>${transitionChild(t, false)}</p:transition></mc:Fallback>` +
    `</mc:AlternateContent>`
  );
}

/* ───────────── 애니메이션 ───────────── */

/** SlideLab 효과 → PowerPoint presetID (나타내기/끝내기 공용 번호) */
export const PRESET_IDS: Record<string, number> = {
  appear: 1, flyIn: 2, fade: 10, wipe: 22, split: 16, zoom: 53, floatIn: 42, swivel: 45,
  disappear: 1, flyOut: 2, fadeOut: 10, wipeOut: 22, splitOut: 16, zoomOut: 53, floatOut: 42,
  pulse: 26, spin: 8, growShrink: 6, teeter: 32, transparency: 9,
  path: 0,
};

/** 방향 → presetSubtype (PowerPoint: 1 위, 2 오른쪽, 4 아래, 8 왼쪽) */
export const SUBTYPE: Record<Direction, number> = { up: 1, right: 2, down: 4, left: 8 };

const WIPE_FILTER: Record<Direction, string> = { down: 'wipe(up)', up: 'wipe(down)', left: 'wipe(right)', right: 'wipe(left)' };

class Ids {
  n = 1;
  next() {
    return ++this.n;
  }
}

function tgt(spid: number) {
  return `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
}

function setVis(ids: Ids, spid: number, val: 'visible' | 'hidden', delay = 0) {
  return `<p:set><p:cBhvr><p:cTn id="${ids.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
}

function animEffect(ids: Ids, spid: number, dur: number, filter: string, transition: 'in' | 'out') {
  return `<p:animEffect transition="${transition}" filter="${filter}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}"/>${tgt(spid)}</p:cBhvr></p:animEffect>`;
}

function animProp(ids: Ids, spid: number, dur: number, attr: string, from: string, to: string) {
  return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
}

function offscreenFrom(dir: Direction): [string, string, string] {
  switch (dir) {
    case 'down':
      return ['ppt_y', '1+#ppt_h/2', '#ppt_y'];
    case 'up':
      return ['ppt_y', '0-#ppt_h/2', '#ppt_y'];
    case 'left':
      return ['ppt_x', '0-#ppt_w/2', '#ppt_x'];
    case 'right':
      return ['ppt_x', '1+#ppt_w/2', '#ppt_x'];
  }
}

/** 효과 하나의 동작 요소들 */
function behaviors(ids: Ids, a: Animation, spid: number, slideW: number, slideH: number): string {
  const dur = Math.max(1, Math.round(a.duration));
  const dir = a.direction ?? 'down';
  const isExit = a.category === 'exit';
  const vis = (v: 'visible' | 'hidden', d = 0) => setVis(ids, spid, v, d);
  const end = Math.max(0, dur - 1);
  switch (a.effect) {
    case 'appear':
      return vis('visible');
    case 'disappear':
      return vis('hidden');
    case 'fade':
      return vis('visible') + animEffect(ids, spid, dur, 'fade', 'in');
    case 'fadeOut':
      return animEffect(ids, spid, dur, 'fade', 'out') + vis('hidden', end);
    case 'flyIn': {
      const [attr, from, to] = offscreenFrom(dir);
      return vis('visible') + animProp(ids, spid, dur, attr, from, to);
    }
    case 'flyOut': {
      const [attr, from, to] = offscreenFrom(dir);
      return animProp(ids, spid, dur, attr, to, from) + vis('hidden', end);
    }
    case 'floatIn':
      return vis('visible') + animEffect(ids, spid, dur, 'fade', 'in') + animProp(ids, spid, dur, 'ppt_y', dir === 'down' ? '#ppt_y-.1' : '#ppt_y+.1', '#ppt_y');
    case 'floatOut':
      return animEffect(ids, spid, dur, 'fade', 'out') + animProp(ids, spid, dur, 'ppt_y', '#ppt_y', dir === 'down' ? '#ppt_y-.1' : '#ppt_y+.1') + vis('hidden', end);
    case 'wipe':
      return vis('visible') + animEffect(ids, spid, dur, WIPE_FILTER[dir], 'in');
    case 'wipeOut':
      return animEffect(ids, spid, dur, WIPE_FILTER[dir], 'out') + vis('hidden', end);
    case 'split':
      return vis('visible') + animEffect(ids, spid, dur, dir === 'left' || dir === 'right' ? 'barn(outVertical)' : 'barn(outHorizontal)', 'in');
    case 'splitOut':
      return animEffect(ids, spid, dur, dir === 'left' || dir === 'right' ? 'barn(inVertical)' : 'barn(inHorizontal)', 'out') + vis('hidden', end);
    case 'zoom':
    case 'swivel':
      return (
        vis('visible') +
        animProp(ids, spid, dur, 'ppt_w', '0', '#ppt_w') +
        animProp(ids, spid, dur, 'ppt_h', '0', '#ppt_h') +
        animEffect(ids, spid, dur, 'fade', 'in') +
        (a.effect === 'swivel' ? `<p:animRot by="-10800000"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>` : '')
      );
    case 'zoomOut':
      return animProp(ids, spid, dur, 'ppt_w', '#ppt_w', '0') + animProp(ids, spid, dur, 'ppt_h', '#ppt_h', '0') + animEffect(ids, spid, dur, 'fade', 'out') + vis('hidden', end);
    case 'pulse':
      return `<p:animScale><p:cBhvr><p:cTn id="${ids.next()}" dur="${Math.round(dur / 2)}" autoRev="1" fill="hold"/>${tgt(spid)}</p:cBhvr><p:by x="110000" y="110000"/></p:animScale>`;
    case 'spin':
      return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
    case 'growShrink':
      return `<p:animScale><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}</p:cBhvr><p:by x="150000" y="150000"/></p:animScale>`;
    case 'teeter': {
      const q = Math.round(dur / 4);
      const rot = (by: number) => `<p:animRot by="${by}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${q}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      return rot(360000) + rot(-720000) + rot(720000) + rot(-360000);
    }
    case 'transparency':
      return `<p:set><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>style.opacity</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="0.5"/></p:to></p:set>`;
    case 'path': {
      const pts = a.path ?? [{ x: 0, y: 0 }];
      const f = (v: number, s: number) => (v / s).toFixed(5).replace(/\.?0+$/, '') || '0';
      const d = `M ${pts.map((p, i) => `${i ? 'L ' : ''}${f(p.x, slideW)} ${f(p.y, slideH)}`).join(' ')} E`;
      return `<p:animMotion origin="layout" path="${d}" pathEditMode="relative" ptsTypes="${'A'.repeat(pts.length)}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>`;
    }
    default:
      return vis(isExit ? 'hidden' : 'visible');
  }
}

/** 클릭 단계 하나 → p:par (하위 묶음: '이전 효과 다음에'마다 새 묶음) */
function stepPar(ids: Ids, step: ReturnType<typeof buildTimeline>['steps'][number], spidOf: (id: string) => number | undefined, slideW: number, slideH: number, startCond: string): string {
  const groups: { start: number; items: string[] }[] = [];
  step.items.forEach((it, i) => {
    const spid = spidOf(it.anim.targetId);
    if (spid === undefined) return;
    const a = it.anim;
    if (!groups.length || (a.start === 'afterPrevious' && i > 0)) groups.push({ start: it.start - a.delay, items: [] });
    const g = groups[groups.length - 1];
    const nodeType = i === 0 ? (a.start === 'onClick' || a.triggerId ? 'clickEffect' : a.start === 'withPrevious' ? 'withEffect' : 'afterEffect') : a.start === 'afterPrevious' ? 'afterEffect' : 'withEffect';
    const cls = a.category === 'entrance' ? 'entr' : a.category === 'exit' ? 'exit' : a.category === 'emphasis' ? 'emph' : 'path';
    const sub = a.direction && (a.effect.startsWith('fly') || a.effect.startsWith('wipe')) ? SUBTYPE[a.direction] : 0;
    const repeat = a.repeat === 0 ? ' repeatCount="indefinite"' : a.repeat > 1 ? ` repeatCount="${a.repeat * 1000}"` : '';
    g.items.push(
      `<p:par><p:cTn id="${ids.next()}" presetID="${PRESET_IDS[a.effect] ?? 1}" presetClass="${cls}" presetSubtype="${sub}"${repeat} fill="hold" grpId="0" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${Math.round(it.start - g.start)}"/></p:stCondLst><p:childTnLst>${behaviors(ids, a, spid, slideW, slideH)}</p:childTnLst></p:cTn></p:par>`,
    );
  });
  if (!groups.length) return '';
  const inner = groups
    .map((g) => `<p:par><p:cTn id="${ids.next()}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(g.start)}"/></p:stCondLst><p:childTnLst>${g.items.join('')}</p:childTnLst></p:cTn></p:par>`)
    .join('');
  return `<p:par><p:cTn id="${ids.next()}" fill="hold"><p:stCondLst>${startCond}</p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
}

/**
 * 슬라이드 애니메이션 → p:timing XML.
 * spidOf: 개체 ID → 내보낸 슬라이드의 도형 ID (cNvPr id)
 */
export function buildTimingXml(anims: Animation[] | undefined, spidOf: (id: string) => number | undefined, slideW: number, slideH: number, isTextShape: (id: string) => boolean = () => true): string | undefined {
  if (!anims?.length) return undefined;
  const tl = buildTimeline(anims);
  const ids = new Ids();
  const mainId = 2;
  ids.n = 2;
  const steps = tl.steps
    .map((st) => stepPar(ids, st, spidOf, slideW, slideH, st.auto ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${mainId}"/></p:cond>` : '<p:cond delay="indefinite"/>'))
    .join('');
  const interactive = [...tl.triggers]
    .map(([trigger, tsteps]) => {
      const tsp = spidOf(trigger);
      if (tsp === undefined) return '';
      const body = tsteps.map((st) => stepPar(ids, st, spidOf, slideW, slideH, '<p:cond delay="0"/>')).join('');
      return `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${ids.next()}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0">${tgt(tsp)}</p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>${body}</p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0">${tgt(tsp)}</p:cond></p:nextCondLst></p:seq>`;
    })
    .join('');
  const main = steps
    ? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${mainId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${steps}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
    : '';
  if (!main && !interactive) return undefined;
  // 빌드 목록은 텍스트를 가질 수 있는 도형(p:sp)만
  const targets = [...new Set(anims.filter((a) => isTextShape(a.targetId)).map((a) => spidOf(a.targetId)).filter((x): x is number => x !== undefined))];
  const bld = targets.length ? `<p:bldLst>${targets.map((s) => `<p:bldP spid="${s}" grpId="0" animBg="1"/>`).join('')}</p:bldLst>` : '';
  return `<p:timing xmlns:p="${P}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${main}${interactive}</p:childTnLst></p:cTn></p:par></p:tnLst>${bld}</p:timing>`;
}
