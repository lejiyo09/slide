import { X } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.message}</span>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={() => useEditor.getState().dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
