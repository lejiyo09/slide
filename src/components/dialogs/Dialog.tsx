import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, onOk, okLabel = '확인' }: { title: string; children: ReactNode; onClose: () => void; onOk?: () => void; okLabel?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && onOk) onOk(); if (e.key === 'Escape') onClose(); }}>
        <div className="dialog-head">
          <span>{title}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">
          {onOk && (
            <button type="button" className="btn primary" onClick={onOk}>
              {okLabel}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
