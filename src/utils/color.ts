import type { Color } from '../types/model';

export function normalizeHex(c: string): Color {
  let s = c.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#000000';
  return `#${s.toUpperCase()}`;
}

/** 'rgb(1, 2, 3)' 또는 '#abc' → '#RRGGBB'. 해석 불가 시 null */
export function cssColorToHex(css: string | null | undefined): Color | null {
  if (!css) return null;
  const v = css.trim();
  if (v.startsWith('#')) return normalizeHex(v);
  const m = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // 완전 투명
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return `#${hex.toUpperCase()}`;
  }
  return null;
}

export function hexToRgba(hex: Color, alpha = 1): string {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** pptxgenjs 형식: '#'가 없는 6자리 */
export const toPptxHex = (c: Color) => normalizeHex(c).slice(1);

export const PALETTE_STANDARD: Color[] = [
  '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050',
  '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0',
];

export const PALETTE_GRAYS: Color[] = ['#FFFFFF', '#F2F2F2', '#D9D9D9', '#BFBFBF', '#A6A6A6', '#7F7F7F', '#595959', '#404040', '#262626', '#000000'];
