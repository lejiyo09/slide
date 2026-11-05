/**
 * 애니메이션 효과 정의 (자체 구현).
 * 각 효과는 진행률 p(0..1)에서 개체의 프레임(불투명도/이동/크기/회전/잘라내기)을 계산한다.
 * PPTX 매핑(presetID/presetClass)은 services/export/animXml.ts에서 사용한다.
 */
import type { AnimationCategory, Direction } from '../../types/model';

export interface Frame {
  visible?: boolean;
  opacity?: number;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  rotate?: number;
  /** CSS clip-path */
  clip?: string;
}

export interface EffectCtx {
  dir?: Direction;
  x: number;
  y: number;
  w: number;
  h: number;
  slideW: number;
  slideH: number;
  path?: { x: number; y: number }[];
}

export interface EffectDef {
  id: string;
  category: AnimationCategory;
  name: string;
  /** 지원하는 방향 (첫 번째가 기본) */
  directions?: Direction[];
  defaultDuration: number;
  /** 진행 중 프레임 */
  frame: (p: number, c: EffectCtx) => Frame;
  /** 끝난 뒤 유지되는 상태 */
  final: (c: EffectCtx) => Frame;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** 화면 밖 시작 위치 (dir = 들어오는 쪽) */
function offscreen(c: EffectCtx, dir: Direction): { tx: number; ty: number } {
  switch (dir) {
    case 'down':
      return { tx: 0, ty: c.slideH - c.y };
    case 'up':
      return { tx: 0, ty: -(c.y + c.h) };
    case 'left':
      return { tx: -(c.x + c.w), ty: 0 };
    case 'right':
      return { tx: c.slideW - c.x, ty: 0 };
  }
}

/** 방향 쪽에서 드러나는 닦아내기 clip (e: 0 → 1 보임 정도) */
function wipeClip(e: number, dir: Direction): string {
  const hide = `${((1 - e) * 100).toFixed(2)}%`;
  switch (dir) {
    case 'down': // 아래쪽에서 위로 드러남
      return `inset(${hide} 0 0 0)`;
    case 'up':
      return `inset(0 0 ${hide} 0)`;
    case 'left':
      return `inset(0 ${hide} 0 0)`;
    case 'right':
      return `inset(0 0 0 ${hide})`;
  }
}

const splitClip = (e: number, vertical: boolean) => {
  const half = `${((1 - e) * 50).toFixed(2)}%`;
  return vertical ? `inset(0 ${half} 0 ${half})` : `inset(${half} 0 ${half} 0)`;
};

const DIRS4: Direction[] = ['down', 'up', 'left', 'right'];

const pathPoint = (pts: { x: number; y: number }[] | undefined, e: number) => {
  if (!pts || pts.length < 2) return { x: 0, y: 0 };
  const segs = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let d = e * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? Math.min(1, d / segs[i]) : 1;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
};

const entrance = (id: string, name: string, frame: EffectDef['frame'], extra: Partial<EffectDef> = {}): EffectDef => ({
  id, category: 'entrance', name, defaultDuration: 500, frame, final: () => ({ visible: true }), ...extra,
});

/** 나타내기 효과를 거꾸로 재생 = 끝내기 효과 */
const exitOf = (e: EffectDef, id: string, name: string): EffectDef => ({
  ...e,
  id,
  category: 'exit',
  name,
  frame: (p, c) => e.frame(1 - p, c),
  final: () => ({ visible: false }),
});

const appear = entrance('appear', '나타내기', () => ({ visible: true }), { defaultDuration: 0 });
const fade = entrance('fade', '페이드', (p) => ({ opacity: easeInOut(p) }));
const flyIn = entrance(
  'flyIn',
  '날아오기',
  (p, c) => {
    const o = offscreen(c, c.dir ?? 'down');
    const e = easeOut(p);
    return { tx: o.tx * (1 - e), ty: o.ty * (1 - e) };
  },
  { directions: DIRS4 },
);
const floatIn = entrance(
  'floatIn',
  '떠오르기',
  (p, c) => {
    const e = easeOut(p);
    const d = c.dir === 'down' ? -40 : 40;
    return { opacity: e, ty: d * (1 - e) };
  },
  { directions: ['up', 'down'], defaultDuration: 1000 },
);
const wipe = entrance('wipe', '닦아내기', (p, c) => ({ clip: wipeClip(easeInOut(p), c.dir ?? 'down') }), { directions: DIRS4 });
const split = entrance('split', '분할', (p, c) => ({ clip: splitClip(easeInOut(p), c.dir === 'left' || c.dir === 'right') }), { directions: ['up', 'left'] });
const zoom = entrance('zoom', '확대/축소', (p) => {
  const e = easeOut(p);
  return { opacity: e, sx: e, sy: e };
});
const swivel = entrance('swivel', '회전하며 나타내기', (p) => {
  const e = easeOut(p);
  return { opacity: e, rotate: -180 * (1 - e), sx: 0.3 + 0.7 * e, sy: 0.3 + 0.7 * e };
}, { defaultDuration: 800 });

const emphasis = (id: string, name: string, frame: EffectDef['frame'], final: EffectDef['final'] = () => ({}), dur = 1000): EffectDef => ({
  id, category: 'emphasis', name, defaultDuration: dur, frame, final,
});

export const EFFECTS: EffectDef[] = [
  appear, fade, flyIn, floatIn, wipe, split, zoom, swivel,
  emphasis('pulse', '펄스', (p) => {
    const s = 1 + 0.1 * Math.sin(Math.PI * p);
    return { sx: s, sy: s };
  }, () => ({}), 500),
  emphasis('spin', '회전', (p) => ({ rotate: 360 * easeInOut(p) }), () => ({}), 2000),
  emphasis('growShrink', '크게/작게', (p) => {
    const s = 1 + 0.5 * easeInOut(p);
    return { sx: s, sy: s };
  }, () => ({ sx: 1.5, sy: 1.5 }), 2000),
  emphasis('teeter', '흔들기', (p) => ({ rotate: 6 * Math.sin(4 * Math.PI * p) * (1 - p) })),
  emphasis('transparency', '투명', (p) => ({ opacity: 1 - 0.5 * easeInOut(p) }), () => ({ opacity: 0.5 }), 500),
  exitOf(appear, 'disappear', '사라지기'),
  exitOf(fade, 'fadeOut', '페이드'),
  exitOf(flyIn, 'flyOut', '날아가기'),
  exitOf(floatIn, 'floatOut', '가라앉기'),
  exitOf(wipe, 'wipeOut', '닦아내기'),
  exitOf(split, 'splitOut', '분할'),
  exitOf(zoom, 'zoomOut', '확대/축소'),
  {
    id: 'path',
    category: 'path',
    name: '이동 경로',
    defaultDuration: 2000,
    frame: (p, c) => {
      const q = pathPoint(c.path, easeInOut(p));
      return { tx: q.x, ty: q.y };
    },
    final: (c) => {
      const q = c.path?.length ? c.path[c.path.length - 1] : { x: 0, y: 0 };
      return { tx: q.x, ty: q.y };
    },
  },
];

export const effectById = (id: string) => EFFECTS.find((e) => e.id === id);

/** 이동 경로 프리셋 (슬라이드 px 오프셋) */
export const PATH_PRESETS: { id: string; name: string; build: (w: number, h: number) => { x: number; y: number }[] }[] = [
  { id: 'right', name: '선: 오른쪽', build: () => [{ x: 0, y: 0 }, { x: 240, y: 0 }] },
  { id: 'left', name: '선: 왼쪽', build: () => [{ x: 0, y: 0 }, { x: -240, y: 0 }] },
  { id: 'down', name: '선: 아래쪽', build: () => [{ x: 0, y: 0 }, { x: 0, y: 160 }] },
  { id: 'up', name: '선: 위쪽', build: () => [{ x: 0, y: 0 }, { x: 0, y: -160 }] },
  { id: 'diagonal', name: '대각선', build: () => [{ x: 0, y: 0 }, { x: 200, y: 140 }] },
  {
    id: 'arc',
    name: '호',
    build: () => Array.from({ length: 17 }, (_, i) => {
      const a = Math.PI * (i / 16);
      return { x: 120 - 120 * Math.cos(a), y: -90 * Math.sin(a) };
    }),
  },
  {
    id: 'circle',
    name: '원',
    build: () => Array.from({ length: 33 }, (_, i) => {
      const a = (2 * Math.PI * i) / 32;
      return { x: 90 * Math.sin(a), y: 90 - 90 * Math.cos(a) };
    }),
  },
];

/** 프레임 합성 (누적 상태 위에 진행 중 프레임) */
export function compose(a: Frame, b: Frame): Frame {
  return {
    visible: b.visible ?? a.visible,
    opacity: (a.opacity ?? 1) * (b.opacity ?? 1),
    tx: (a.tx ?? 0) + (b.tx ?? 0),
    ty: (a.ty ?? 0) + (b.ty ?? 0),
    sx: (a.sx ?? 1) * (b.sx ?? 1),
    sy: (a.sy ?? 1) * (b.sy ?? 1),
    rotate: (a.rotate ?? 0) + (b.rotate ?? 0),
    clip: b.clip ?? a.clip,
  };
}
