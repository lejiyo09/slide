import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Plus } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import type { Presentation, Slide } from '../../types/model';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { SlideContextMenu } from './SlideContextMenu';

/** 축소판에 필요한 문서 부분 (이것만 바뀌어야 모든 축소판을 다시 그림) */
type DesignDoc = Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>;

export function useDesignDoc(doc: Presentation): DesignDoc {
  const { size, theme, assets, layouts, master } = doc;
  return useMemo(() => ({ size, theme, assets, layouts, master }), [size, theme, assets, layouts, master]);
}

/** 화면 근처에 올 때 처음 그림 (슬라이드가 많은 문서에서 축소판 DOM·메모리 절약). 한 번 그리면 유지 */
function LazyFrame({ eager, width, height, children }: { eager: boolean; width: number; height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(eager || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return seen ? <>{children}</> : <div ref={ref} className="thumb-placeholder" style={{ width, height }} aria-hidden />;
}

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
  doc: DesignDoc;
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
      data-slide-id={slide.id}
    >
      <span className="thumb-num">
        {/* 이름은 내용에서: "슬라이드 N (숨김) (효과 있음)" + 축소판 글자 (화면 읽기·음성 제어) */}
        <span className="sr-only">슬라이드 </span>
        {index + 1}
        {slide.hidden && <span className="sr-only"> (숨김)</span>}
        {(slide.animations?.length || (slide.transition && slide.transition.type !== 'none')) && <span className="sr-only"> (효과 있음)</span>}
        {slide.hidden && <EyeOff size={11} />}
        {(slide.animations?.length || (slide.transition && slide.transition.type !== 'none')) && (
          <span className="thumb-fx" aria-hidden title={`${slide.transition && slide.transition.type !== 'none' ? '전환 효과' : ''}${slide.animations?.length ? ` 애니메이션 ${slide.animations.length}개` : ''}`}>
            ★
          </span>
        )}
      </span>
      <div className="thumb-frame">
        <LazyFrame eager={index < 12} width={width} height={(doc.size.height * width) / doc.size.width}>
          <ScaledSlide slide={slide} doc={doc} width={width} />
        </LazyFrame>
      </div>
    </div>
  );
});

export function useSlideDnD() {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const onDragStart = useCallback((e: React.DragEvent, id: string) => {
    const s = useEditor.getState();
    if (!s.selectedSlideIds.includes(id)) s.setActiveSlide(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-slidelab-slides', '1');
  }, []);
  const onDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes('application/x-slidelab-slides')) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const horizontal = r.width > r.height * 1.9 ? false : (e.currentTarget as HTMLElement).closest('.sorter') !== null;
    const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    setDropIndex(after ? index + 1 : index);
  }, []);
  const dropRef = useRef<number | null>(null);
  dropRef.current = dropIndex;
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const at = dropRef.current;
    if (at === null) return;
    const s = useEditor.getState();
    s.commit('슬라이드 이동', (d) => C.moveSlides(d, s.selectedSlideIds, at));
    setDropIndex(null);
  }, []);
  return { dropIndex, setDropIndex, onDragStart, onDragOver, onDrop };
}

export function SlidePanel() {
  const doc = useEditor((s) => s.doc);
  const activeId = useEditor((s) => s.activeSlideId);
  const selected = useEditor((s) => s.selectedSlideIds);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; sectionId?: string } | null>(null);
  const dnd = useSlideDnD();

  const design = useDesignDoc(doc);
  const onPointer = useCallback((e: React.MouseEvent, id: string) => {
    useEditor.getState().setActiveSlide(id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
  }, []);
  const onContext = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const s = useEditor.getState();
    if (!s.selectedSlideIds.includes(id)) s.setActiveSlide(id);
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

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
      aria-label="슬라이드"
      onPointerDown={() => useEditor.getState().set({ focusArea: 'slides' })}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dnd.setDropIndex(null);
      }}
    >
      <div className="slide-list">
        <div role="listbox" aria-label="슬라이드 목록" aria-multiselectable tabIndex={0} className="slide-listbox">
        {doc.slides.map((s, i) => {
          const sec = sectionAt.get(s.id);
          if (sec) currentSection = sec.id;
          const hidden = currentSection && collapsed.has(currentSection);
          return (
            // 목록 상자(listbox)의 자식은 항목(option)이나 묶음(group)만: 구역 머리글이 있으면 구역 이름의 묶음
            <div key={s.id} role={sec ? 'group' : 'none'} aria-label={sec ? `구역: ${sec.name}` : undefined}>
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
                  doc={design}
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
        </div>
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
  const design = useDesignDoc(doc);
  const onPointer = useCallback((e: React.MouseEvent, id: string) => useEditor.getState().setActiveSlide(id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey }), []);
  const onContext = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const st = useEditor.getState();
    if (!st.selectedSlideIds.includes(id)) st.setActiveSlide(id);
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);
  const onDouble = useCallback((id: string) => useEditor.getState().set({ viewMode: 'normal', activeSlideId: id }), []);
  return (
    <div className="sorter" onPointerDown={() => useEditor.getState().set({ focusArea: 'slides' })} role="listbox" aria-multiselectable>
      {doc.slides.map((s, i) => (
        <SlideThumb
          key={s.id}
          slide={s}
          doc={design}
          index={i}
          width={240}
          active={s.id === activeId}
          selected={selected.includes(s.id)}
          onPointer={onPointer}
          onContext={onContext}
          onDoubleClick={onDouble}
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
