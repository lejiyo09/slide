import { NotebookPen, Square, LayoutGrid, Play, Minus, Plus, Maximize } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';

export function StatusBar() {
  const idx = useEditor((s) => s.doc.slides.findIndex((x) => x.id === s.activeSlideId));
  const count = useEditor((s) => s.doc.slides.length);
  const size = useEditor((s) => s.doc.size);
  const zoom = useEditor((s) => s.zoom);
  const fit = useEditor((s) => s.fitMode);
  const viewMode = useEditor((s) => s.viewMode);
  const showNotes = useEditor((s) => s.showNotes);
  const selCount = useEditor((s) => s.selectedIds.length);
  const masterView = useEditor((s) => s.masterView);
  const set = useEditor((s) => s.set);
  const cm = (px: number) => ((px / 96) * 2.54).toFixed(2);
  return (
    <footer className="statusbar">
      {masterView ? (
        <span className="sb-item sb-master">슬라이드 마스터 보기</span>
      ) : (
        <span className="sb-item">
          슬라이드 {idx + 1}/{count}
        </span>
      )}
      <span className="sb-item muted" title="슬라이드 크기">
        {size.preset === 'custom' ? '사용자 지정' : size.preset} · {cm(size.width)} × {cm(size.height)} cm
      </span>
      {selCount > 0 && <span className="sb-item muted">개체 {selCount}개 선택</span>}
      <span className="sb-spacer" />
      <button
        type="button"
        className={`sb-btn ${showNotes ? 'is-active' : ''}`}
        title="슬라이드 노트"
        onClick={() => {
          set({ showNotes: !showNotes });
          try {
            localStorage.setItem('slidelab.showNotes', showNotes ? '0' : '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <NotebookPen size={14} /> 노트
      </button>
      <span className="sb-sep" />
      <button type="button" className={`sb-btn ${viewMode === 'normal' ? 'is-active' : ''}`} title="기본" onClick={() => set({ viewMode: 'normal' })}>
        <Square size={14} />
      </button>
      <button type="button" className={`sb-btn ${viewMode === 'sorter' ? 'is-active' : ''}`} title="여러 슬라이드" onClick={() => set({ viewMode: 'sorter' })}>
        <LayoutGrid size={14} />
      </button>
      <button type="button" className="sb-btn" title="슬라이드 쇼 (현재 슬라이드부터, Shift+F5)" onClick={() => set({ slideshow: { startIndex: Math.max(0, idx) } })}>
        <Play size={14} />
      </button>
      <span className="sb-sep" />
      <button type="button" className="sb-btn" title="축소" onClick={() => A.zoomBy(-1)}>
        <Minus size={14} />
      </button>
      <input
        className="zoom-slider"
        type="range"
        min={10}
        max={400}
        value={Math.round(zoom * 100)}
        aria-label="확대/축소"
        onChange={(e) => set({ zoom: Number(e.target.value) / 100, fitMode: false })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button type="button" className="sb-btn" title="확대" onClick={() => A.zoomBy(1)}>
        <Plus size={14} />
      </button>
      <span className="sb-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" className={`sb-btn ${fit ? 'is-active' : ''}`} title="현재 창 크기에 맞춤" onClick={() => set({ fitMode: true })}>
        <Maximize size={14} />
      </button>
    </footer>
  );
}

export function NotesPane() {
  const slide = useEditor((s) => s.doc.slides.find((x) => x.id === s.activeSlideId));
  const [height, setHeight] = [useEditor((s) => s.notesHeight), (h: number) => useEditor.getState().set({ notesHeight: h })];
  if (!slide) return null;
  return (
    <div className="notes-pane" style={{ height }}>
      <div
        className="notes-resizer"
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={(e) => {
          const startY = e.clientY;
          const startH = height;
          const move = (ev: PointerEvent) => setHeight(Math.max(48, Math.min(400, startH - (ev.clientY - startY))));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <textarea
        key={slide.id}
        className="notes-input"
        placeholder="클릭하여 슬라이드 노트 추가"
        defaultValue={slide.notes}
        aria-label="슬라이드 노트"
        onKeyDown={(e) => e.stopPropagation()}
        onFocus={() => useEditor.getState().beginGesture('노트 편집')}
        onChange={(e) => {
          const v = e.target.value;
          useEditor.getState().updateGesture((d) => {
            const s = d.slides.find((x) => x.id === slide.id);
            if (s) s.notes = v;
          });
        }}
        onBlur={() => useEditor.getState().endGesture()}
      />
    </div>
  );
}
