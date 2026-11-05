import { useState } from 'react';
import { useEditor } from '../../core/store/editorStore';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { allMasterSlides } from '../../core/document/masters';
import * as M from '../../core/commands/masterActions';
import { createPortal } from 'react-dom';
import { MenuItem, MenuSeparator } from '../common/Buttons';
import { CopyPlus, Plus, Trash2, Pencil } from 'lucide-react';

/** 슬라이드 마스터 보기의 왼쪽 목록: 마스터 + 레이아웃 */
export function MasterPanel() {
  const doc = useEditor((s) => s.doc);
  const active = useEditor((s) => s.activeSlideId);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items = allMasterSlides(doc);
  const usage = (id: string) => doc.slides.filter((s) => s.layout === id).length;
  return (
    <aside className="slide-panel master-panel" aria-label="슬라이드 마스터" onPointerDown={() => useEditor.getState().set({ focusArea: 'slides' })} onClick={() => setMenu(null)}>
      <div className="slide-list">
        {items.map((m, i) => {
          const isMaster = m.kind === 'master';
          const n = isMaster ? doc.slides.length : usage(m.id);
          return (
            <div
              key={m.id}
              className={`thumb ${isMaster ? 'thumb-master' : 'thumb-layout'} ${m.id === active ? 'is-active is-selected' : ''}`}
              data-slide-id={m.id}
              title={`${m.name}: ${isMaster ? '모든 슬라이드' : `슬라이드 ${n}장`}에서 사용`}
              onClick={() => useEditor.getState().setActiveSlide(m.id)}
              onDoubleClick={() => {
                const name = prompt('이름 바꾸기', m.name);
                if (name) M.renameMasterSlide(m.id, name);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                useEditor.getState().setActiveSlide(m.id);
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <span className="thumb-num">{isMaster ? '' : i}</span>
              <div className="thumb-frame">
                <ScaledSlide slide={m} doc={doc} width={isMaster ? 168 : 140} />
              </div>
              <span className="thumb-caption">
                {m.name}
                {!isMaster && n > 0 && <em> · {n}</em>}
              </span>
            </div>
          );
        })}
        <button type="button" className="add-slide-btn" onClick={M.insertLayout}>
          <Plus size={16} /> 레이아웃 삽입
        </button>
      </div>
      {menu &&
        createPortal(
          <div className="popover context-menu menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            <MenuItem icon={<Plus size={15} />} label="레이아웃 삽입" onClick={() => (M.insertLayout(), setMenu(null))} />
            <MenuItem icon={<CopyPlus size={15} />} label="레이아웃 복제" disabled={active === doc.master?.id} onClick={() => (M.duplicateLayout(), setMenu(null))} />
            <MenuItem icon={<Trash2 size={15} />} label="레이아웃 삭제" disabled={active === doc.master?.id} onClick={() => (M.deleteLayout(), setMenu(null))} />
            <MenuSeparator />
            <MenuItem
              icon={<Pencil size={15} />}
              label="이름 바꾸기"
              onClick={() => {
                const cur = items.find((x) => x.id === active);
                const name = prompt('이름 바꾸기', cur?.name);
                if (name) M.renameMasterSlide(active, name);
                setMenu(null);
              }}
            />
          </div>,
          document.body,
        )}
    </aside>
  );
}
