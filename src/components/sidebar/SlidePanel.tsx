import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Plus } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import type { Presentation, Slide } from '../../types/model';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { SlideContextMenu } from './SlideContextMenu';

/** 슬라이드 축소판 */
export const SlideThumb = memo(function SlideThumb({
  slide,
  doc,
  index,
  width,
  active,
  selected,
  onPointer,
  onContext,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDoubleClick,
}: {
  slide: Slide;
  doc: Presentation;
  index: number;
  width: number;
  active: boolean;
  selected: boolean;
  onPointer: (e: React.MouseEvent, id: string) => void;
  onContext: (e: React.MouseEvent, id: string) => void;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent) => void;
  onDoubleClick?: (id: string) => void;
}) {
  return (
    <div
      className={`thumb ${active ? 'is-active' : ''} ${selected ? 'is-selected' : ''} ${slide.hidden ? 'is-hidden' : ''} ${dropBefore ? 'drop-before' : ''} ${dropAfter ? 'drop-after' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, slide.id)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
      onClick={(e) => onPointer(e, slide.id)}
      onDoubleClick={() => onDoubleClick?.(slide.id)}
      onContextMenu={(e) => onContext(e, slide.id)}
      role="option"
      aria-selected={selected}
      aria-label={`슬라이드 ${index + 1}`}
      data-slide-id={slide.id}
    >
      <span className="thumb-num">
        {index + 1}
        {slide.hidden && <EyeOff size={11} />}
      </span>
      <div className="thumb-frame">
        <ScaledSlide slide={slide} doc={doc} width={width} />
      </div>
    </div>
  );
});

export function useSlideDnD() {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const onDragStart = (e: React.DragEvent, id: string) => {
    const s = useEditor.getState();
    if (!s.selectedSlideIds.includes(id)) s.setActiveSlide(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-slidelab-slides', '1');
  };
  const onDragOver = (e: React.DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes('application/x-slidelab-slides')) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const horizontal = r.width > r.height * 1.9 ? false : (e.currentTarget as HTMLElement).closest('.sorter') !== null;
    const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    setDropIndex(after ? index + 1 : index);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropIndex === null) return;
    const s = useEditor.getState();
    s.commit('슬라이드 이동', (d) => C.moveSlides(d, s.selectedSlideIds, dropIndex));
    setDropIndex(null);
  };
  return { dropIndex, setDropIndex, onDragStart, onDragOver, onDrop };
}

export function SlidePanel() {
  const doc = useEditor((s) => s.doc);
  const activeId = useEditor((s) => s.activeSlideId);
  const selected = useEditor((s) => s.selectedSlideIds);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; sectionId?: string } | null>(null);
  const dnd = useSlideDnD();

  const onPointer = (e: React.MouseEvent, id: string) => {
    useEditor.getState().setActiveSlide(id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
  };
  const onContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const s = useEditor.getState();
    if (!s.selectedSlideIds.includes(id)) s.setActiveSlide(id);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const sectionAt = new Map(doc.sections.map((s) => [s.startSlideId, s]));
  let currentSection: string | null = null;
  const sectionCounts = new Map<string, number>();
  for (const s of doc.slides) {
    const sec = sectionAt.get(s.id);
    if (sec) currentSection = sec.id;
    if (currentSection) sectionCounts.set(currentSection, (sectionCounts.get(currentSection) ?? 0) + 1);
  }
  currentSection = null;

  return (
    <aside
      className="slide-panel"
      aria-label="슬라이드 목록"
      role="listbox"
      aria-multiselectable
      tabIndex={0}
      onPointerDown={() => useEditor.getState().set({ focusArea: 'slides' })}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dnd.setDropIndex(null);
      }}
    >
      <div className="slide-list">
        {doc.slides.map((s, i) => {
          const sec = sectionAt.get(s.id);
          if (sec) currentSection = sec.id;
          const hidden = currentSection && collapsed.has(currentSection);
          return (
            <div key={s.id}>
              {sec && (
                <div
                  className="section-header"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, sectionId: sec.id });
                  }}
                  onDoubleClick={() => {
                    const name = prompt('구역 이름 바꾸기', sec.name);
                    if (name) useEditor.getState().commit('구역 이름 바꾸기', (d) => C.renameSection(d, sec.id, name));
                  }}
                  title="더블클릭: 이름 바꾸기 · 오른쪽 클릭: 구역 메뉴"
                >
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={collapsed.has(sec.id) ? '구역 펼치기' : '구역 접기'}
                    onClick={() =>
                      setCollapsed((c) => {
                        const n = new Set(c);
                        if (n.has(sec.id)) n.delete(sec.id);
                        else n.add(sec.id);
                        return n;
                      })
                    }
                  >
                    {collapsed.has(sec.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <span className="section-name">{sec.name}</span>
                  <span className="section-count">({sectionCounts.get(sec.id) ?? 0})</span>
                </div>
              )}
              {!hidden && (
                <SlideThumb
                  slide={s}
                  doc={doc}
                  index={i}
                  width={168}
                  active={s.id === activeId}
                  selected={selected.includes(s.id)}
                  onPointer={onPointer}
                  onContext={onContext}
                  dropBefore={dnd.dropIndex === i}
                  dropAfter={dnd.dropIndex === i + 1 && i === doc.slides.length - 1}
                  onDragStart={dnd.onDragStart}
                  onDragOver={dnd.onDragOver}
                  onDrop={dnd.onDrop}
                />
              )}
            </div>
          );
        })}
        <button type="button" className="add-slide-btn" onClick={() => A.newSlide()} title="새 슬라이드 (Ctrl+M)">
          <Plus size={16} /> 새 슬라이드
        </button>
      </div>
      {menu && <SlideContextMenu x={menu.x} y={menu.y} sectionId={menu.sectionId} onClose={() => setMenu(null)} />}
    </aside>
  );
}

/** 여러 슬라이드 보기 */
export function SorterView() {
  const doc = useEditor((s) => s.doc);
  const activeId = useEditor((s) => s.activeSlideId);
  const selected = useEditor((s) => s.selectedSlideIds);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dnd = useSlideDnD();
  return (
    <div className="sorter" onPointerDown={() => useEditor.getState().set({ focusArea: 'slides' })} role="listbox" aria-multiselectable>
      {doc.slides.map((s, i) => (
        <SlideThumb
          key={s.id}
          slide={s}
          doc={doc}
          index={i}
          width={240}
          active={s.id === activeId}
          selected={selected.includes(s.id)}
          onPointer={(e, id) => useEditor.getState().setActiveSlide(id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey })}
          onContext={(e, id) => {
            e.preventDefault();
            const st = useEditor.getState();
            if (!st.selectedSlideIds.includes(id)) st.setActiveSlide(id);
            setMenu({ x: e.clientX, y: e.clientY });
          }}
          onDoubleClick={(id) => useEditor.getState().set({ viewMode: 'normal', activeSlideId: id })}
          dropBefore={dnd.dropIndex === i}
          dropAfter={dnd.dropIndex === i + 1 && i === doc.slides.length - 1}
          onDragStart={dnd.onDragStart}
          onDragOver={dnd.onDragOver}
          onDrop={dnd.onDrop}
        />
      ))}
      {menu && <SlideContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
