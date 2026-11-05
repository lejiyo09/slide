import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, CopyPlus, Trash2, EyeOff, Rows3, Copy, Clipboard, ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import { MenuItem, MenuSeparator } from '../common/Buttons';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { useEditor } from '../../core/store/editorStore';

export function SlideContextMenu({ x, y, sectionId, onClose }: { x: number; y: number; sectionId?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const clip = useEditor((s) => s.clipboard);
  useLayoutEffect(() => {
    const el = ref.current!;
    setPos({ left: Math.min(x, window.innerWidth - el.offsetWidth - 4), top: Math.min(y, window.innerHeight - el.offsetHeight - 4) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);
  const run = (fn: () => void) => () => (fn(), onClose());
  const commit = useEditor.getState().commit;
  return createPortal(
    <div ref={ref} className="popover context-menu menu" style={pos} role="menu">
      {sectionId ? (
        <>
          <MenuItem
            icon={<Pencil size={15} />}
            label="구역 이름 바꾸기"
            onClick={run(() => {
              const sec = useEditor.getState().doc.sections.find((s) => s.id === sectionId);
              const name = prompt('구역 이름', sec?.name);
              if (name) commit('구역 이름 바꾸기', (d) => C.renameSection(d, sectionId, name));
            })}
          />
          <MenuItem icon={<Trash2 size={15} />} label="구역 제거" onClick={run(() => commit('구역 제거', (d) => C.removeSection(d, sectionId)))} />
        </>
      ) : (
        <>
          <MenuItem icon={<Copy size={15} />} label="복사" shortcut="Ctrl+C" onClick={run(A.copySlides)} />
          <MenuItem icon={<Clipboard size={15} />} label="붙여넣기" shortcut="Ctrl+V" disabled={clip?.kind !== 'slides'} onClick={run(() => A.paste())} />
          <MenuSeparator />
          <MenuItem icon={<Plus size={15} />} label="새 슬라이드" shortcut="Ctrl+M" onClick={run(() => A.newSlide())} />
          <MenuItem icon={<CopyPlus size={15} />} label="슬라이드 복제" shortcut="Ctrl+D" onClick={run(A.duplicateSelectedSlides)} />
          <MenuItem icon={<Trash2 size={15} />} label="슬라이드 삭제" shortcut="Delete" onClick={run(A.deleteSelectedSlides)} />
          <MenuSeparator />
          <MenuItem icon={<ArrowUp size={15} />} label="위로 이동" shortcut="Ctrl+↑" onClick={run(() => A.moveSelectedSlides(-1))} />
          <MenuItem icon={<ArrowDown size={15} />} label="아래로 이동" shortcut="Ctrl+↓" onClick={run(() => A.moveSelectedSlides(1))} />
          <MenuSeparator />
          <MenuItem
            icon={<Rows3 size={15} />}
            label="구역 추가"
            onClick={run(() => {
              const name = prompt('구역 이름', '제목 없는 구역');
              if (name !== null) commit('구역 추가', (d) => void C.addSection(d, useEditor.getState().activeSlideId, name || '제목 없는 구역'));
            })}
          />
          <MenuItem icon={<EyeOff size={15} />} label="슬라이드 숨기기" onClick={run(A.toggleHideSlides)} />
        </>
      )}
    </div>,
    document.body,
  );
}
