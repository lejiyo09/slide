import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, usePopover } from './Popover';

/** 접근 가능한 이름: 보이는 글자로 시작하고 설명을 덧붙임 (음성 제어로 보이는 글자를 말해도 찾게, WCAG 2.5.3) */
export const accessibleName = (label: string | undefined, title: string) =>
  !label || title === label || new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s(:,·]|$)`).test(title) ? title : `${label}: ${title}`;

interface BtnProps {
  icon?: ReactNode;
  label?: string;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: 'large' | 'small';
  className?: string;
  shortcut?: string;
}

/**
 * 리본 버튼. onMouseDown preventDefault로 텍스트 편집기 포커스/선택을 유지한다.
 */
export function RibbonButton({ icon, label, title, onClick, active, disabled, size = 'small', className, shortcut }: BtnProps) {
  return (
    <button
      type="button"
      className={`rb rb-${size} ${active ? 'is-active' : ''} ${className ?? ''}`}
      title={shortcut ? `${title} (${shortcut})` : title}
      aria-label={accessibleName(label, title)}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon && <span className="rb-icon">{icon}</span>}
      {label && <span className="rb-label">{label}</span>}
    </button>
  );
}

/** 클릭 시 메뉴/패널을 여는 드롭다운 버튼 */
export function DropdownButton({
  icon,
  label,
  title,
  size = 'small',
  disabled,
  children,
  active,
  placement,
  panelClass,
}: Omit<BtnProps, 'onClick'> & { children: (close: () => void) => ReactNode; placement?: 'bottom-start' | 'bottom-end'; panelClass?: string }) {
  const p = usePopover();
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={`rb rb-${size} rb-dropdown ${p.open || active ? 'is-active' : ''}`}
        title={title}
        aria-label={accessibleName(label, title)}
        aria-haspopup="menu"
        aria-expanded={p.open}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
      >
        {icon && <span className="rb-icon">{icon}</span>}
        {label && <span className="rb-label">{label}</span>}
        <ChevronDown className="rb-caret" size={10} />
      </button>
      <Popover open={p.open} anchor={p.anchorRef.current} onClose={p.close} placement={placement} className={panelClass}>
        {children(p.close)}
      </Popover>
    </>
  );
}

/** 주 동작 + 드롭다운이 분리된 버튼 (예: 글자 색) */
export function SplitButton({
  icon,
  title,
  onClick,
  disabled,
  children,
  label,
  size = 'small',
}: BtnProps & { children: (close: () => void) => ReactNode }) {
  const p = usePopover();
  return (
    <span className={`rb-split rb-split-${size}`}>
      <button type="button" className={`rb rb-${size}`} title={title} aria-label={accessibleName(label, title)} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
        {icon && <span className="rb-icon">{icon}</span>}
        {label && <span className="rb-label">{label}</span>}
      </button>
      <button
        ref={p.anchorRef}
        type="button"
        className={`rb rb-split-caret ${p.open ? 'is-active' : ''}`}
        title={`${title} 옵션`}
        aria-label={`${title} 옵션`}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
      >
        <ChevronDown size={10} />
      </button>
      <Popover open={p.open} anchor={p.anchorRef.current} onClose={p.close}>
        {children(p.close)}
      </Popover>
    </span>
  );
}

export function MenuItem({ icon, label, shortcut, onClick, disabled, checked }: { icon?: ReactNode; label: string; shortcut?: string; onClick: () => void; disabled?: boolean; checked?: boolean }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${checked ? 'is-checked' : ''}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" role="separator" />;

export function RibbonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rg ${className ?? ''}`} role="group" aria-label={label}>
      <div className="rg-body">{children}</div>
      <div className="rg-label">{label}</div>
    </div>
  );
}

/** 아직 구현되지 않은 기능 그룹: 비활성 상태로 명확히 표시 */
export function PlannedGroup({ label, stage, items }: { label: string; stage: string; items: string[] }) {
  return (
    <div className="rg rg-planned" role="group" aria-label={`${label} (준비 중)`} title={`${stage}에서 구현 예정입니다`}>
      <div className="rg-body planned-body">
        <span className="planned-badge">준비 중 · {stage}</span>
        <span className="planned-items">{items.join(' · ')}</span>
      </div>
      <div className="rg-label">{label}</div>
    </div>
  );
}
