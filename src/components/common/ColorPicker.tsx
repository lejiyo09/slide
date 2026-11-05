import { useState } from 'react';
import { PALETTE_GRAYS, PALETTE_STANDARD, normalizeHex } from '../../utils/color';
import { useEditor } from '../../core/store/editorStore';

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
  const themeColors = [theme.colors.light1, theme.colors.dark1, theme.colors.light2, theme.colors.dark2, theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4, theme.colors.accent5, theme.colors.accent6];
  return (
    <div className="color-panel">
      <div className="cp-title">테마 색</div>
      <div className="cp-row">{themeColors.map((c, i) => <Swatch key={i} c={c} onPick={pick} />)}</div>
      <div className="cp-title">표준 색</div>
      <div className="cp-row">{PALETTE_STANDARD.map((c) => <Swatch key={c} c={c} onPick={pick} />)}</div>
      <div className="cp-row">{PALETTE_GRAYS.map((c) => <Swatch key={c} c={c} onPick={pick} />)}</div>
      {recent.length > 0 && (
        <>
          <div className="cp-title">최근에 사용한 색</div>
          <div className="cp-row">{recent.map((c) => <Swatch key={c} c={c} onPick={pick} />)}</div>
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

function Swatch({ c, onPick }: { c: string; onPick: (c: string) => void }) {
  return <button type="button" className="swatch" style={{ background: c }} title={c} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} />;
}

/** 아이콘 아래 색 막대 */
export function ColorBarIcon({ icon, color }: { icon: React.ReactNode; color: string | null | undefined }) {
  return (
    <span className="color-bar-icon">
      {icon}
      <span className="color-bar" style={{ background: color ?? 'transparent', borderColor: color ? 'transparent' : 'var(--border)' }} />
    </span>
  );
}
