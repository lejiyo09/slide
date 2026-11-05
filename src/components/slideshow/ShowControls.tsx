/** 슬라이드 쇼 도구 모음, 펜/레이저 메뉴, 오른쪽 클릭 메뉴, 모든 슬라이드 보기, 종료 질문, 도움말 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, PenLine, LayoutGrid, Search, MoreHorizontal, X, Highlighter, Eraser, Pointer, MousePointer2, Trash2, Check } from 'lucide-react';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { formatDuration } from '../../engines/show/showModel';
import { HIGHLIGHTER_COLORS, PEN_COLORS, type ShowCtl, type ShowTool } from './useShowController';

/* ───────────── 메뉴 ───────────── */

export type MenuItem = { label: string; onClick: () => void; checked?: boolean; disabled?: boolean; shortcut?: string; icon?: ReactNode } | 'sep' | { colors: string[]; value: string; onPick: (c: string) => void; label: string };

export function ShowMenu({ items, x, y, onClose, up }: { items: MenuItem[]; x: number; y: number; onClose: () => void; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? document;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    doc.addEventListener('pointerdown', away, true);
    return () => doc.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="show-menu"
      role="menu"
      style={{ left: x, ...(up ? { bottom: y } : { top: y }) }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}
    >
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="show-menu-sep" />;
        if ('colors' in it)
          return (
            <div key={i} className="show-menu-colors" aria-label={it.label}>
              {it.colors.map((c) => (
                <button key={c} type="button" title={c} data-color={c} className={c.toLowerCase() === it.value.toLowerCase() ? 'is-on' : ''} style={{ background: c }} onClick={() => (it.onPick(c), onClose())} />
              ))}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="show-menu-item"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span className="smi-check">{it.checked ? <Check size={13} /> : it.icon}</span>
            <span className="smi-label">{it.label}</span>
            {it.shortcut && <span className="smi-key">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function penItems(ctl: ShowCtl): MenuItem[] {
  const t = (tool: ShowTool, label: string, shortcut: string, icon: ReactNode): MenuItem => ({ label, shortcut, icon, checked: ctl.tool === tool, onClick: () => ctl.setTool(tool) });
  return [
    t('laser', '레이저 포인터', 'Ctrl+L', <Pointer size={13} />),
    t('pen', '펜', 'Ctrl+P', <PenLine size={13} />),
    t('highlighter', '형광펜', 'Ctrl+I', <Highlighter size={13} />),
    t('eraser', '지우개', 'Ctrl+E', <Eraser size={13} />),
    { label: '슬라이드의 잉크 모두 지우기', shortcut: 'E', icon: <Trash2 size={13} />, disabled: !ctl.slideInk.length, onClick: ctl.eraseAll },
    'sep',
    ctl.tool === 'highlighter'
      ? { label: '형광펜 색', colors: HIGHLIGHTER_COLORS, value: ctl.hlColor, onPick: ctl.setHlColor }
      : { label: '잉크 색', colors: PEN_COLORS, value: ctl.penColor, onPick: (c) => (ctl.setPenColor(c), ctl.tool !== 'pen' && ctl.setTool('pen')) },
    'sep',
    { label: '화살표', shortcut: 'Ctrl+A', icon: <MousePointer2 size={13} />, checked: ctl.tool === 'arrow', onClick: () => ctl.setTool('arrow') },
    { label: '화살표 자동 숨기기', checked: ctl.pointerMode === 'auto', onClick: () => ctl.setPointerMode('auto') },
    { label: '화살표 항상 표시', checked: ctl.pointerMode === 'visible', onClick: () => ctl.setPointerMode('visible') },
    { label: '화살표 숨기기', shortcut: 'Ctrl+H', checked: ctl.pointerMode === 'hidden', onClick: () => ctl.setPointerMode('hidden') },
  ];
}

export function moreItems(ctl: ShowCtl, onHelp: () => void): MenuItem[] {
  return [
    ...(ctl.kiosk ? [] : [{ label: ctl.presenter ? '발표자 보기 숨기기' : '발표자 보기 표시', onClick: () => ctl.setPresenter(!ctl.presenter) } as MenuItem]),
    { label: '검은 화면', shortcut: 'B', checked: ctl.blank === 'black', onClick: () => ctl.setBlank(ctl.blank === 'black' ? null : 'black') },
    { label: '흰 화면', shortcut: 'W', checked: ctl.blank === 'white', onClick: () => ctl.setBlank(ctl.blank === 'white' ? null : 'white') },
    { label: '잉크 표시', shortcut: 'Ctrl+M', checked: ctl.inkVisible, disabled: !ctl.inkCount, onClick: () => ctl.setInkVisible(!ctl.inkVisible) },
    'sep',
    { label: '도움말 (단축키)', onClick: onHelp },
    { label: '쇼 마침', shortcut: 'Esc', onClick: ctl.requestExit },
  ];
}

export function contextItems(ctl: ShowCtl, onHelp: () => void): MenuItem[] {
  return [
    { label: '다음', onClick: () => ctl.next() },
    { label: '이전', onClick: ctl.prev },
    { label: '모든 슬라이드 보기', shortcut: 'G', onClick: () => ctl.setGrid(true) },
    { label: '확대', onClick: () => ctl.setZoomPick(true) },
    ...(ctl.zoom.scale > 1 ? [{ label: '축소', onClick: ctl.resetZoom } as MenuItem] : []),
    'sep',
    ...penItems(ctl).slice(0, 5),
    'sep',
    ...moreItems(ctl, onHelp),
  ];
}

/* ───────────── 도구 모음 (청중 화면 왼쪽 아래 / 발표자 보기 현재 슬라이드 아래) ───────────── */

export function ShowToolbar({ ctl, visible, presenterStyle, onHelp }: { ctl: ShowCtl; visible: boolean; presenterStyle?: boolean; onHelp: () => void }) {
  const [menu, setMenu] = useState<null | 'pen' | 'more'>(null);
  const penOn = ctl.tool !== 'arrow';
  return (
    <div className={`${presenterStyle ? 'pv-tools' : 'show-controls'} ${visible || menu ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {!presenterStyle && (
        <>
          <button type="button" title="이전 (←)" onClick={ctl.prev}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" title="다음 (→)" onClick={() => ctl.next()}>
            <ChevronRight size={18} />
          </button>
        </>
      )}
      <span className="show-tool-anchor">
        <button type="button" title="펜 및 레이저 포인터 도구" aria-pressed={penOn} className={penOn ? 'is-on' : ''} data-tool="pen-menu" onClick={() => setMenu(menu === 'pen' ? null : 'pen')}>
          <PenLine size={17} />
        </button>
        {menu === 'pen' && <ShowMenu items={penItems(ctl)} x={0} y={40} up onClose={() => setMenu(null)} />}
      </span>
      <button type="button" title="모든 슬라이드 보기 (G)" data-tool="grid" onClick={() => ctl.setGrid(true)}>
        <LayoutGrid size={17} />
      </button>
      <button type="button" title="슬라이드 확대" aria-pressed={ctl.zoomPick || ctl.zoom.scale > 1} className={ctl.zoomPick || ctl.zoom.scale > 1 ? 'is-on' : ''} data-tool="zoom" onClick={() => (ctl.zoom.scale > 1 ? ctl.resetZoom() : ctl.setZoomPick(!ctl.zoomPick))}>
        <Search size={17} />
      </button>
      {presenterStyle && (
        <button type="button" title="검은 화면 / 검은 화면 해제 (B)" aria-pressed={ctl.blank === 'black'} className={ctl.blank === 'black' ? 'is-on' : ''} data-tool="black" onClick={() => ctl.setBlank(ctl.blank === 'black' ? null : 'black')}>
          <span className="pv-black-icon" />
        </button>
      )}
      <span className="show-tool-anchor">
        <button type="button" title="기타 슬라이드 쇼 옵션" data-tool="more" onClick={() => setMenu(menu === 'more' ? null : 'more')}>
          <MoreHorizontal size={17} />
        </button>
        {menu === 'more' && <ShowMenu items={moreItems(ctl, onHelp)} x={0} y={40} up onClose={() => setMenu(null)} />}
      </span>
      {!presenterStyle && (
        <span className="show-counter">
          {ctl.slide ? ctl.doc.slides.indexOf(ctl.slide) + 1 : 0} / {ctl.doc.slides.length}
        </span>
      )}
    </div>
  );
}

/* ───────────── 모든 슬라이드 보기 ───────────── */

export function ShowGrid({ ctl }: { ctl: ShowCtl }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('.is-current')?.focus(), []);
  return (
    <div className="show-grid" ref={ref} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
      <div className="show-grid-head">
        <button type="button" className="show-grid-back" title="돌아가기 (Esc)" onClick={() => ctl.setGrid(false)}>
          <ChevronLeft size={20} /> 모든 슬라이드
        </button>
      </div>
      <div className="show-grid-list">
        {ctl.seq.map((s, i) => (
          <button type="button" key={s.id} className={`show-grid-item ${i === ctl.index ? 'is-current' : ''} ${s.hidden ? 'is-hidden' : ''}`} onClick={() => ctl.goTo(i)} title={`슬라이드 ${ctl.doc.slides.indexOf(s) + 1}${s.hidden ? ' (숨김)' : ''}`}>
            <ScaledSlide slide={s} doc={ctl.doc} width={200} />
            <span>{ctl.doc.slides.indexOf(s) + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────── 종료 질문 ───────────── */

export function ShowPrompt({ ctl }: { ctl: ShowCtl }) {
  const p = ctl.endPrompt;
  if (!p) return null;
  const text = p.kind === 'ink' ? '잉크 주석을 유지하시겠습니까?' : `슬라이드 쇼에 걸린 총 시간은 ${formatDuration(p.total)}입니다. 새 슬라이드 시간을 저장하시겠습니까?`;
  return (
    <div className="show-prompt-backdrop" onClick={(e) => e.stopPropagation()}>
      <div className="show-prompt" role="alertdialog" aria-label={text}>
        <p>{text}</p>
        <div>
          <button type="button" className="btn primary" autoFocus onClick={() => ctl.answerPrompt(true)}>
            {p.kind === 'ink' ? '유지' : '예'}
          </button>
          <button type="button" className="btn" onClick={() => ctl.answerPrompt(false)}>
            {p.kind === 'ink' ? '취소' : '아니요'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 도움말 ───────────── */

const HELP: [string, string][] = [
  ['다음 애니메이션 / 다음 슬라이드', 'N, Enter, Page Down, →, ↓, Space, 클릭'],
  ['이전 애니메이션 / 이전 슬라이드', 'P, Page Up, ←, ↑, Backspace'],
  ['슬라이드 번호로 이동', '번호 + Enter'],
  ['첫 / 마지막 슬라이드', 'Home / End'],
  ['다음 숨긴 슬라이드 표시', 'H'],
  ['검은 화면 / 흰 화면', 'B 또는 . / W 또는 ,'],
  ['자동 진행 중지 / 다시 시작', 'S'],
  ['모든 슬라이드 보기', 'G, Ctrl+S, - (확대하지 않았을 때)'],
  ['확대 / 축소', '+ / -'],
  ['레이저 포인터 / 펜 / 형광펜 / 지우개', 'Ctrl+L / Ctrl+P / Ctrl+I / Ctrl+E'],
  ['화살표 / 화살표 숨기기 / 자동 숨기기', 'Ctrl+A / Ctrl+H / Ctrl+U'],
  ['화살표 표시·숨기기', 'A 또는 ='],
  ['화면의 잉크 지우기 / 잉크 표시·숨기기', 'E / Ctrl+M'],
  ['쇼 마침', 'Esc'],
];

export function ShowHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="show-prompt-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="show-prompt show-help" role="dialog" aria-label="슬라이드 쇼 도움말" onClick={(e) => e.stopPropagation()}>
        <div className="show-help-head">
          <b>슬라이드 쇼 도움말</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <table>
          <tbody>
            {HELP.map(([a, b]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
