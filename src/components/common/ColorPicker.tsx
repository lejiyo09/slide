import { useState } from 'react';
import { PALETTE_GRAYS, PALETTE_STANDARD, normalizeHex } from '../../utils/color';
import { useEditor } from '../../core/store/editorStore';
import { THEME_COLOR_KEYS, colorToken, describeColor, isColorToken, resolveColor } from '../../utils/themeColor';
import type { Theme } from '../../types/model';

const RECENT_KEY = 'slidelab.recentColors';
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/** 테마 색 + 표준 색 + 사용자 지정 색 선택 패널 */
export function ColorPanel({ onPick, allowNone, noneLabel = '채우기 없음' }: { onPick: (c: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const theme = useEditor((s) => s.doc.theme);
  const [recent, setRecent] = useState(loadRecent);
  const pick = (c: string | null) => {
    if (c) {
      const next = [c, ...recent.filter((x) => x !== c)].slice(0, 10);
      setRecent(next);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
    onPick(c);
  };
  // PowerPoint와 같은 테마 색 격자: 기본 색 + 밝게/어둡게 5단계 (모두 테마 토큰)
  const rows = [0, 1, 2, 3, 4, 5].map((row) =>
    THEME_COLOR_KEYS.map((k) => {
      if (row === 0) return colorToken(k);
      const v = VARIANTS[variantKind(theme.colors[k])][row - 1];
      return v[0] === '^' ? colorToken(k, { tint: v[1] }) : colorToken(k, { shade: v[1] });
    }),
  );
  return (
    <div className="color-panel">
      <div className="cp-title">테마 색</div>
      {rows.map((r, i) => (
        <div key={i} className={`cp-row ${i === 0 ? 'cp-row-base' : 'cp-row-variant'}`}>
          {r.map((c) => <Swatch key={c} c={c} onPick={pick} theme={theme} />)}
        </div>
      ))}
      <div className="cp-title">표준 색</div>
      <div className="cp-row">{PALETTE_STANDARD.map((c) => <Swatch key={c} c={c} onPick={pick} />)}</div>
      <div className="cp-row">{PALETTE_GRAYS.map((c) => <Swatch key={c} c={c} onPick={pick} />)}</div>
      {recent.length > 0 && (
        <>
          <div className="cp-title">최근에 사용한 색</div>
          <div className="cp-row">{recent.map((c) => <Swatch key={c} c={c} onPick={pick} theme={theme} />)}</div>
        </>
      )}
      <div className="cp-actions">
        {allowNone && (
          <button type="button" className="cp-btn" onClick={() => pick(null)}>
            {noneLabel}
          </button>
        )}
        <label className="cp-btn cp-custom">
          다른 색…
          <input type="color" onChange={(e) => pick(normalizeHex(e.target.value))} />
        </label>
      </div>
    </div>
  );
}

function Swatch({ c, onPick, theme }: { c: string; onPick: (c: string) => void; theme?: Theme }) {
  const shown = resolveColor(c, theme);
  const label = isColorToken(c) ? `${describeColor(c)} (${shown})` : c;
  return <button type="button" className="swatch" style={{ background: shown }} title={label} aria-label={label} data-color={c} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} />;
}

type Variant = ['^' | '~', number];
const VARIANTS: Record<'light' | 'dark' | 'mid', Variant[]> = {
  mid: [['^', 0.8], ['^', 0.6], ['^', 0.4], ['~', 0.75], ['~', 0.5]],
  light: [['~', 0.95], ['~', 0.85], ['~', 0.75], ['~', 0.65], ['~', 0.5]],
  dark: [['^', 0.5], ['^', 0.35], ['^', 0.25], ['^', 0.15], ['^', 0.05]],
};
function variantKind(hex: string): 'light' | 'dark' | 'mid' {
  const h = hex.replace('#', '');
  const l = (parseInt(h.slice(0, 2), 16) * 0.3 + parseInt(h.slice(2, 4), 16) * 0.59 + parseInt(h.slice(4, 6), 16) * 0.11) / 255;
  return l > 0.92 ? 'light' : l < 0.08 ? 'dark' : 'mid';
}

/** 아이콘 아래 색 막대 */
export function ColorBarIcon({ icon, color: raw }: { icon: React.ReactNode; color: string | null | undefined }) {
  const theme = useEditor((s) => s.doc.theme);
  const color = raw ? resolveColor(raw, theme) : raw;
  return (
    <span className="color-bar-icon">
      {icon}
      <span className="color-bar" style={{ background: color ?? 'transparent', borderColor: color ? 'transparent' : 'var(--border)' }} />
    </span>
  );
}
