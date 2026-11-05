/**
 * DrawingML 해석: 색(테마 색 + 변형), 채우기, 선.
 */
import type { ArrowHead, DashStyle, Fill, Stroke } from '../../types/model';
import { kid, kids, numAttr } from './ooxml';

export interface ColorCtx {
  /** 테마 색 구성표: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink */
  scheme: Record<string, string>;
  /** 마스터 색 매핑: bg1→lt1, tx1→dk1 ... */
  clrMap: Record<string, string>;
  /** 스타일 참조(fillRef 등)의 자리 표시 색 */
  phClr?: string;
}

export interface ResolvedColor {
  hex: string;
  alpha: number; // 0..1
}

const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  cyan: '00FFFF', magenta: 'FF00FF', gray: '808080', grey: '808080', silver: 'C0C0C0', orange: 'FFA500',
  darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400', lightGray: 'D3D3D3', navy: '000080', purple: '800080',
};

const HIGHLIGHT_NAMES = PRESET_COLORS;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padStart(6, '0');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const fromLinear = (l: number) => {
  const x = Math.max(0, Math.min(1, l));
  return (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255;
};

/** 색 요소(srgbClr, schemeClr 등) 하나를 해석 */
export function resolveColorEl(el: Element, ctx: ColorCtx): ResolvedColor | null {
  let base: string | null = null;
  switch (el.localName) {
    case 'srgbClr':
      base = el.getAttribute('val');
      break;
    case 'schemeClr': {
      const v = el.getAttribute('val') ?? '';
      if (v === 'phClr') base = ctx.phClr?.replace('#', '') ?? null;
      else {
        const mapped = ctx.clrMap[v] ?? v;
        base = ctx.scheme[mapped]?.replace('#', '') ?? null;
      }
      break;
    }
    case 'sysClr':
      base = el.getAttribute('lastClr') ?? (el.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
      break;
    case 'prstClr':
      base = PRESET_COLORS[el.getAttribute('val') ?? ''] ?? '000000';
      break;
    case 'scrgbClr': {
      const lin = (v: number | undefined) => {
        const c = (v ?? 0) / 100000;
        return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
      };
      base = toHex(lin(numAttr(el, 'r')), lin(numAttr(el, 'g')), lin(numAttr(el, 'b'))).slice(1);
      break;
    }
    case 'hslClr': {
      const [r, g, b] = hslToRgb((numAttr(el, 'hue') ?? 0) / 21600000, (numAttr(el, 'sat') ?? 0) / 100000, (numAttr(el, 'lum') ?? 0) / 100000);
      base = toHex(r, g, b).slice(1);
      break;
    }
    default:
      return null;
  }
  if (!base) return null;
  let [r, g, b] = hexToRgb(base);
  let alpha = 1;
  for (const m of kids(el)) {
    const v = (numAttr(m, 'val') ?? 0) / 100000;
    switch (m.localName) {
      case 'alpha':
        alpha = v;
        break;
      // Office는 tint/shade를 선형 RGB 공간에서 적용한다
      case 'tint':
        [r, g, b] = [r, g, b].map((c) => fromLinear(toLinear(c) * v + (1 - v)));
        break;
      case 'shade':
        [r, g, b] = [r, g, b].map((c) => fromLinear(toLinear(c) * v));
        break;
      case 'lumMod':
      case 'lumOff':
      case 'satMod': {
        const [h, s, l] = rgbToHsl(r, g, b);
        const nl = m.localName === 'lumMod' ? l * v : m.localName === 'lumOff' ? l + v : l;
        const ns = m.localName === 'satMod' ? Math.min(1, s * v) : s;
        [r, g, b] = hslToRgb(h, ns, Math.max(0, Math.min(1, nl)));
        break;
      }
      case 'inv':
        r = 255 - r; g = 255 - g; b = 255 - b;
        break;
      case 'gray': {
        const y = 0.3 * r + 0.59 * g + 0.11 * b;
        r = g = b = y;
        break;
      }
    }
  }
  return { hex: toHex(r, g, b), alpha };
}

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);

/** 자식 중 색 요소를 찾아 해석 (solidFill 등의 부모를 넘김) */
export function resolveColor(parent: Element | null, ctx: ColorCtx): ResolvedColor | null {
  if (!parent) return null;
  for (const c of kids(parent)) if (COLOR_TAGS.has(c.localName)) return resolveColorEl(c, ctx);
  return null;
}

export function highlightColor(el: Element | null, ctx: ColorCtx): string | undefined {
  if (!el) return undefined;
  const c = resolveColor(el, ctx);
  if (c) return c.hex;
  const name = el.getAttribute('val');
  return name && HIGHLIGHT_NAMES[name] ? `#${HIGHLIGHT_NAMES[name]}` : undefined;
}

/* ───────────── 채우기 ───────────── */

export type FillResult = Fill | { type: 'blip'; rId: string; opacity?: number } | null;

/**
 * spPr/bgPr 등에서 채우기 요소를 찾아 해석. 채우기 요소가 없으면 null(=상속/스타일 사용).
 */
export function parseFill(parent: Element | null, ctx: ColorCtx, groupFill?: Fill): FillResult {
  if (!parent) return null;
  for (const c of kids(parent)) {
    switch (c.localName) {
      case 'noFill':
        return { type: 'none' };
      case 'solidFill': {
        const col = resolveColor(c, ctx);
        return col ? { type: 'solid', color: col.hex, ...(col.alpha < 1 ? { opacity: col.alpha } : {}) } : { type: 'none' };
      }
      case 'gradFill': {
        const stops = kids(kid(c, 'gsLst'), 'gs')
          .map((gs) => {
            const col = resolveColor(gs, ctx);
            return col ? { offset: (numAttr(gs, 'pos') ?? 0) / 100000, color: col.hex } : null;
          })
          .filter((x): x is { offset: number; color: string } => !!x)
          .sort((a, b) => a.offset - b.offset);
        if (!stops.length) return { type: 'none' };
        const lin = kid(c, 'lin');
        const angle = lin ? (numAttr(lin, 'ang') ?? 0) / 60000 : 90;
        return { type: 'gradient', angle: Math.round(angle * 100) / 100, stops };
      }
      case 'blipFill': {
        const blip = kid(c, 'blip');
        const rId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? '';
        const a = kid(blip, 'alphaModFix');
        return rId ? { type: 'blip', rId, ...(a ? { opacity: (numAttr(a, 'amt') ?? 100000) / 100000 } : {}) } : { type: 'none' };
      }
      case 'pattFill': {
        const fg = resolveColor(kid(c, 'fgClr'), ctx);
        return fg ? { type: 'solid', color: fg.hex } : { type: 'none' };
      }
      case 'grpFill':
        return groupFill ?? { type: 'none' };
    }
  }
  return null;
}

/* ───────────── 선 ───────────── */

const DASH_MAP: Record<string, DashStyle> = {
  solid: 'solid',
  dash: 'dash',
  lgDash: 'dash',
  sysDash: 'dash',
  dot: 'dot',
  sysDot: 'dot',
  dashDot: 'dashDot',
  lgDashDot: 'dashDot',
  lgDashDotDot: 'dashDot',
  sysDashDot: 'dashDot',
  sysDashDotDot: 'dashDot',
};

const HEAD_MAP: Record<string, ArrowHead> = {
  none: 'none',
  triangle: 'triangle',
  stealth: 'triangle',
  arrow: 'arrow',
  oval: 'oval',
  diamond: 'triangle',
};

export interface LineResult {
  stroke: Stroke | null | undefined; // undefined = 지정 없음(스타일 사용)
  headStart: ArrowHead;
  headEnd: ArrowHead;
}

export function parseLine(ln: Element | null, ctx: ColorCtx, fallbackColor?: string, fallbackWidthPt?: number): LineResult {
  const head = (n: string) => HEAD_MAP[kid(ln, n)?.getAttribute('type') ?? 'none'] ?? 'none';
  if (!ln) return { stroke: undefined, headStart: 'none', headEnd: 'none' };
  const result: LineResult = { stroke: undefined, headStart: head('headEnd'), headEnd: head('tailEnd') };
  if (kid(ln, 'noFill')) {
    result.stroke = null;
    return result;
  }
  const widthEmu = numAttr(ln, 'w');
  const solid = kid(ln, 'solidFill');
  const grad = kid(ln, 'gradFill');
  const col = solid ? resolveColor(solid, ctx) : grad ? resolveColor(kid(kid(grad, 'gsLst'), 'gs'), ctx) : null;
  const color = col?.hex ?? fallbackColor;
  if (!color && widthEmu === undefined) return result;
  result.stroke = {
    color: color ?? '#000000',
    width: widthEmu !== undefined ? Math.round((widthEmu / 12700) * 100) / 100 : fallbackWidthPt ?? 0.75,
    dash: DASH_MAP[kid(ln, 'prstDash')?.getAttribute('val') ?? 'solid'] ?? 'solid',
    ...(col && col.alpha < 1 ? { opacity: col.alpha } : {}),
  };
  return result;
}
