/**
 * 테마 색/글꼴 토큰.
 *
 *  색: '@accent1'           → 테마 강조 1
 *      '@accent1^0.4'       → 강조 1을 흰색 쪽으로 40% (밝게)
 *      '@accent1~0.75'      → 강조 1의 밝기 75% (어둡게)
 *  글꼴: '@heading' / '@body' → 테마 제목/본문 글꼴
 *
 * 토큰을 쓰는 개체는 테마(또는 색 조합)를 바꾸면 PowerPoint처럼 함께 바뀐다.
 * 렌더링·내보내기 직전에 resolveColor/resolveFont로 실제 값으로 바꾼다.
 */
import type { Color, Theme, ThemeColors } from '../types/model';

export const THEME_COLOR_KEYS: (keyof ThemeColors)[] = ['light1', 'dark1', 'light2', 'dark2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export const THEME_COLOR_NAMES: Record<keyof ThemeColors, string> = {
  light1: '배경 1',
  dark1: '텍스트 1',
  light2: '배경 2',
  dark2: '텍스트 2',
  accent1: '강조 1',
  accent2: '강조 2',
  accent3: '강조 3',
  accent4: '강조 4',
  accent5: '강조 5',
  accent6: '강조 6',
};

const TOKEN = /^@(light1|dark1|light2|dark2|accent[1-6])(?:([~^])(\d*\.?\d+))?$/;

export const isColorToken = (c: string | undefined | null): boolean => !!c && c.startsWith('@');

export const colorToken = (key: keyof ThemeColors, mod?: { tint?: number; shade?: number }) =>
  `@${key}${mod?.tint !== undefined ? `^${mod.tint}` : mod?.shade !== undefined ? `~${mod.shade}` : ''}`;

function adjust(hex: string, kind: '~' | '^', amount: number): string {
  const h = hex.replace('#', '');
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    const n = kind === '~' ? v * amount : v + (255 - v) * amount;
    return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
}

/** 토큰이면 테마 색으로, 아니면 그대로 */
export function resolveColor(c: Color | undefined | null, theme: Theme | undefined): Color {
  if (!c) return '#000000';
  if (c[0] !== '@') return c;
  const m = c.match(TOKEN);
  if (!m || !theme) return '#000000';
  const base = theme.colors[m[1] as keyof ThemeColors] ?? '#000000';
  return m[2] ? adjust(base, m[2] as '~' | '^', Number(m[3])) : base;
}

export function resolveFont(f: string | undefined, theme: Theme | undefined): string | undefined {
  if (!f || f[0] !== '@' || !theme) return f;
  if (f === '@heading') return theme.fonts.heading;
  if (f === '@body') return theme.fonts.body;
  return f.slice(1);
}

export const FONT_TOKEN_NAMES: Record<string, string> = { '@heading': '제목 글꼴', '@body': '본문 글꼴' };

/** 표시용 이름: '@accent1~0.75' → '강조 1, 25% 더 어둡게' */
export function describeColor(c: string): string {
  const m = c.match(TOKEN);
  if (!m) return c;
  const name = THEME_COLOR_NAMES[m[1] as keyof ThemeColors];
  if (!m[2]) return name;
  const pct = Math.round((m[2] === '~' ? 1 - Number(m[3]) : Number(m[3])) * 100);
  return `${name}, ${pct}% 더 ${m[2] === '~' ? '어둡게' : '밝게'}`;
}

/**
 * 문서 전체의 토큰을 실제 값으로 바꾼 복사본 (PPTX 내보내기 등 외부 형식용).
 * 색 문자열 필드는 이름이 color/highlight/fg/bg 이거나 colors 배열 안에 있다.
 */
export function resolveTokensDeep<T>(value: T, theme: Theme): T {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (v[0] === '@') {
        if (key === 'fontFamily') return resolveFont(v, theme);
        if (TOKEN.test(v)) return resolveColor(v, theme);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      // 테마 자체는 그대로
      if (key === 'theme') return v;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(value, '') as T;
}

/**
 * 테마를 바꾸기 전에, 현재 테마 색/글꼴과 정확히 같은 고정 값을 토큰으로 바꾼다.
 * (가져온 PPTX·이전 버전 문서도 테마 변경을 따라가게 함)
 */
export function tokenizeLegacy<T>(value: T, theme: Theme): T {
  const byHex = new Map<string, string>();
  const order: (keyof ThemeColors)[] = ['dark1', 'light1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dark2', 'light2'];
  for (const k of order) {
    const hex = theme.colors[k]?.toUpperCase();
    if (hex && !byHex.has(hex)) byHex.set(hex, `@${k}`);
  }
  const COLOR_KEYS = new Set(['color', 'fg', 'bg', 'highlight']);
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (COLOR_KEYS.has(key) && v[0] === '#') return byHex.get(v.toUpperCase()) ?? v;
      if (key === 'fontFamily') return v === theme.fonts.heading ? '@heading' : v === theme.fonts.body ? '@body' : v;
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = k === 'preserved' || k === 'sourceXml' ? x : walk(x, k);
      return out;
    }
    return v;
  };
  return walk(value, '') as T;
}
