import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 버튼 아래에 떠 있는 패널 (body 포털로 렌더링해 리본 overflow에 잘리지 않음) */
export function Popover({
  open,
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'right-start';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const panel = ref.current;
    const pw = panel?.offsetWidth ?? 200;
    const ph = panel?.offsetHeight ?? 200;
    let left = placement === 'bottom-end' ? r.right - pw : placement === 'right-start' ? r.right + 2 : r.left;
    let top = placement === 'right-start' ? r.top : r.bottom + 2;
    left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
    if (top + ph > window.innerHeight - 4) top = Math.max(4, (placement === 'right-start' ? window.innerHeight : r.top) - ph - 2);
    setPos({ left, top });
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return { open, setOpen, anchorRef, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}
