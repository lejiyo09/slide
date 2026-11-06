/**
 * 글꼴 선택 상자: 검색, 종류별 필터, 각 글꼴 모양으로 미리 보기.
 * 테마 글꼴 / 최근 사용 / 내 글꼴(추가한 파일) / 무료 웹 글꼴 / 이 컴퓨터의 글꼴 / 기본 시스템 글꼴.
 * 목록에 없는 이름도 직접 입력해 쓸 수 있다 (PowerPoint와 같이).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { lockSelection } from '../../editors/text/editorSession';
import { CATEGORY_NAMES, pickerLabel, SYSTEM_FONTS, WEB_FONTS, type CatalogFont, type FontCategory } from '../../services/fonts/catalog';
import { addRecent, ensureWebFont, isFontInstalled, previewWebFont, useFonts } from '../../services/fonts/library';
import { cssFontStack } from '../../editors/text/fonts';

interface Item {
  value: string;
  label: string;
  /** 미리 보기에 쓸 글꼴 이름 */
  face: string;
  badge?: string;
  dim?: boolean;
  category?: FontCategory;
  korean?: boolean;
  web?: boolean;
}

const TOKEN_LABEL: Record<string, string> = { '@heading': '제목', '@body': '본문' };

export function FontPicker({
  value,
  onChange,
  disabled,
  allowTokens,
  className,
  ariaLabel = '글꼴',
  lock = true,
}: {
  value?: string;
  onChange: (family: string) => void;
  disabled?: boolean;
  allowTokens?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 텍스트 편집 중 선택 영역 유지 */
  lock?: boolean;
}) {
  const theme = useEditor((s) => s.doc.theme);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const resolved = value === '@heading' ? theme.fonts.heading : value === '@body' ? theme.fonts.body : value;
  const label = value && value.startsWith('@') ? `${resolved} (${TOKEN_LABEL[value] ?? '테마'})` : (value ?? '');
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`font-picker ${className ?? ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${ariaLabel}: ${label || '(여러 글꼴)'}`}
        data-font-picker=""
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!open && lock) lockSelection();
          setOpen((v) => !v);
        }}
      >
        <span className="fp-current" style={{ fontFamily: resolved ? cssFontStack(resolved) : undefined }}>
          {label || '글꼴'}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && anchor.current && (
        <FontPanel
          anchor={anchor.current}
          value={value}
          allowTokens={allowTokens}
          onClose={() => setOpen(false)}
          onPick={(f) => {
            setOpen(false);
            if (!f.startsWith('@')) {
              addRecent(f);
              void ensureWebFont(f);
            }
            onChange(f);
          }}
        />
      )}
    </>
  );
}

function FontPanel({ anchor, value, allowTokens, onClose, onPick }: { anchor: HTMLElement; value?: string; allowTokens?: boolean; onClose: () => void; onPick: (f: string) => void }) {
  const theme = useEditor((s) => s.doc.theme);
  const { userFonts, recent, local, webFonts } = useFonts();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FontCategory | 'all'>('all');
  const [koreanOnly, setKoreanOnly] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, maxH: 480 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = 300;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
    const below = window.innerHeight - r.bottom - 8;
    const maxH = Math.max(260, Math.min(520, below));
    const top = below >= 260 ? r.bottom + 2 : Math.max(4, r.top - maxH - 2);
    setPos({ left, top, maxH });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);

  const sections = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (it: Item) =>
      (!term || it.value.toLowerCase().includes(term) || it.label.toLowerCase().includes(term)) && (cat === 'all' || it.category === cat || it.category === undefined) && (!koreanOnly || it.korean !== false);
    const fromCatalog = (f: CatalogFont, web: boolean): Item => {
      const installed = web ? undefined : isFontInstalled(f.family);
      return {
        value: f.family,
        label: pickerLabel(f),
        face: f.family,
        category: f.category,
        korean: f.korean,
        web,
        badge: web ? '웹' : installed === false ? '없음' : undefined,
        dim: !web && installed === false,
      };
    };
    const out: { title: string; items: Item[] }[] = [];
    if (allowTokens)
      out.push({
        title: '테마 글꼴',
        items: [
          { value: '@heading', label: `${theme.fonts.heading} (제목)`, face: theme.fonts.heading },
          { value: '@body', label: `${theme.fonts.body} (본문)`, face: theme.fonts.body },
        ].filter((i) => !term || i.label.toLowerCase().includes(term)),
      });
    out.push({ title: '최근 사용한 글꼴', items: recent.map((f) => ({ value: f, label: f, face: f })).filter(match) });
    const userFamilies = [...new Map(userFonts.map((f) => [f.family, f])).values()];
    out.push({ title: '내 글꼴', items: userFamilies.map((f) => ({ value: f.family, label: f.aliases.length ? `${f.family} · ${f.aliases[0]}` : f.family, face: f.family, badge: '내 글꼴' })).filter(match) });
    if (webFonts) out.push({ title: '무료 웹 글꼴 (Google Fonts)', items: WEB_FONTS.map((f) => fromCatalog(f, true)).filter(match) });
    if (local.length) out.push({ title: '이 컴퓨터의 글꼴', items: local.map((f) => ({ value: f, label: f, face: f })).filter(match) });
    out.push({ title: '기본 시스템 글꼴', items: SYSTEM_FONTS.filter((f) => !local.some((l) => l.toLowerCase() === f.family.toLowerCase())).map((f) => fromCatalog(f, false)).filter(match) });
    return out.filter((s) => s.items.length);
  }, [q, cat, koreanOnly, allowTokens, theme, recent, userFonts, local, webFonts]);

  const flat = sections.flatMap((s) => s.items);
  const typed = q.trim();
  const canTypeOwn = typed && !flat.some((i) => i.value.toLowerCase() === typed.toLowerCase());

  // 웹 글꼴 미리 보기 (이름 글자만 담은 작은 파일)
  useEffect(() => {
    for (const s of sections) for (const it of s.items) if (it.web) previewWebFont(it.value);
  }, [sections]);

  useEffect(() => setHi(0), [q, cat, koreanOnly]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canTypeOwn && (hi === 0 || !flat.length)) onPick(typed);
      else if (flat[hi]) onPick(flat[hi].value);
    }
  };

  let idx = -1;
  return createPortal(
    <div ref={ref} className="popover font-panel" role="dialog" aria-label="글꼴 선택" style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH }} onKeyDown={onKey}>
      <input className="fp-search" autoFocus placeholder="글꼴 검색 또는 이름 입력" value={q} onChange={(e) => setQ(e.target.value)} aria-label="글꼴 검색" />
      <div className="fp-filters">
        {(['all', 'sans', 'serif', 'hand', 'display', 'mono'] as const).map((c) => (
          <button key={c} type="button" className={cat === c ? 'is-on' : ''} onClick={() => setCat(c)}>
            {c === 'all' ? '전체' : CATEGORY_NAMES[c]}
          </button>
        ))}
        <label className="fp-ko">
          <input type="checkbox" checked={koreanOnly} onChange={(e) => setKoreanOnly(e.target.checked)} /> 한글
        </label>
      </div>
      <div className="fp-list" ref={listRef} role="listbox">
        {canTypeOwn && (
          <button type="button" className={`fp-item ${hi === 0 && !flat.length ? 'is-hi' : ''}`} onClick={() => onPick(typed)} data-font-own="">
            <span style={{ fontFamily: cssFontStack(typed) }}>"{typed}" 사용</span>
            <span className="fp-badge">직접 입력</span>
          </button>
        )}
        {sections.map((s) => (
          <div key={s.title} className="fp-section">
            <div className="fp-title">{s.title}</div>
            {s.items.map((it) => {
              idx++;
              const i = idx;
              return (
                <button
                  key={`${s.title}:${it.value}`}
                  type="button"
                  role="option"
                  aria-selected={it.value === value}
                  data-idx={i}
                  data-font={it.value}
                  className={`fp-item ${i === hi ? 'is-hi' : ''} ${it.value === value ? 'is-cur' : ''} ${it.dim ? 'is-dim' : ''}`}
                  title={it.dim ? `${it.value}: 이 컴퓨터에 설치되어 있지 않아 다른 글꼴로 표시됩니다` : it.value}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => onPick(it.value)}
                >
                  <span style={{ fontFamily: cssFontStack(it.face) }}>{it.label}</span>
                  {it.badge && <span className="fp-badge">{it.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length && !canTypeOwn && <div className="fp-empty">찾는 글꼴이 없습니다.</div>}
      </div>
      <div className="fp-foot">
        <button type="button" className="btn btn-sm" data-font-add="" onClick={() => (onClose(), useEditor.getState().set({ fontDialog: 'add' }))}>
          <Plus size={13} /> 글꼴 추가
        </button>
        <button type="button" className="btn btn-sm" onClick={() => (onClose(), useEditor.getState().set({ fontDialog: 'manage' }))}>
          <Settings2 size={13} /> 글꼴 관리
        </button>
      </div>
    </div>,
    document.body,
  );
}
