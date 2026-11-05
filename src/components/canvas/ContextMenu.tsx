import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scissors, Copy, Clipboard, CopyPlus, Trash2, Type, BringToFront, SendToBack, Group, Ungroup, Paintbrush, Plus, Grid3x3, Crop, ImageUp } from 'lucide-react';
import { MenuItem, MenuSeparator } from '../common/Buttons';
import * as A from '../../core/commands/actions';
import { useEditor, getSelectedObjects } from '../../core/store/editorStore';

export interface MenuState {
  x: number;
  y: number;
  onObject: boolean;
}

export function CanvasContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });
  const hasClip = useEditor((s) => !!s.clipboard);
  const sel = getSelectedObjects();
  const first = sel[0];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      left: Math.min(state.x, window.innerWidth - el.offsetWidth - 4),
      top: Math.min(state.y, window.innerHeight - el.offsetHeight - 4),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return createPortal(
    <div ref={ref} className="popover context-menu menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {state.onObject && first ? (
        <>
          <MenuItem icon={<Scissors size={15} />} label="잘라내기" shortcut="Ctrl+X" onClick={run(() => A.copySelection(true))} />
          <MenuItem icon={<Copy size={15} />} label="복사" shortcut="Ctrl+C" onClick={run(() => A.copySelection())} />
          <MenuItem icon={<Clipboard size={15} />} label="붙여넣기" shortcut="Ctrl+V" disabled={!hasClip} onClick={run(() => A.paste())} />
          <MenuItem icon={<CopyPlus size={15} />} label="복제" shortcut="Ctrl+D" onClick={run(A.duplicateSelection)} />
          <MenuItem icon={<Trash2 size={15} />} label="삭제" shortcut="Delete" onClick={run(A.deleteSelection)} />
          <MenuSeparator />
          {sel.length === 1 && (first.type === 'text' || first.type === 'shape') && (
            <MenuItem icon={<Type size={15} />} label="텍스트 편집" shortcut="Enter" onClick={run(() => useEditor.getState().setEditingText(first.id))} />
          )}
          {sel.length === 1 && first.type === 'image' && (
            <>
              <MenuItem icon={<Crop size={15} />} label="자르기" onClick={run(() => useEditor.getState().set({ cropId: first.id }))} />
              <MenuItem icon={<ImageUp size={15} />} label="그림 바꾸기" onClick={run(A.replaceSelectedImage)} />
            </>
          )}
          <MenuItem icon={<Paintbrush size={15} />} label="서식 복사" onClick={run(() => A.startFormatPainter())} />
          <MenuSeparator />
          <MenuItem icon={<BringToFront size={15} />} label="맨 앞으로 가져오기" onClick={run(() => A.reorder('front'))} />
          <MenuItem icon={<SendToBack size={15} />} label="맨 뒤로 보내기" onClick={run(() => A.reorder('back'))} />
          {sel.length > 1 && <MenuItem icon={<Group size={15} />} label="그룹" shortcut="Ctrl+G" onClick={run(A.group)} />}
          {sel.some((o) => o.type === 'group') && <MenuItem icon={<Ungroup size={15} />} label="그룹 해제" shortcut="Ctrl+Shift+G" onClick={run(A.ungroup)} />}
        </>
      ) : (
        <>
          <MenuItem icon={<Clipboard size={15} />} label="붙여넣기" shortcut="Ctrl+V" disabled={!hasClip} onClick={run(() => A.paste())} />
          <MenuSeparator />
          <MenuItem icon={<Plus size={15} />} label="새 슬라이드" shortcut="Ctrl+M" onClick={run(() => A.newSlide())} />
          <MenuItem
            icon={<Grid3x3 size={15} />}
            label="눈금선"
            checked={useEditor.getState().showGrid}
            onClick={run(() => useEditor.getState().set({ showGrid: !useEditor.getState().showGrid }))}
          />
          <MenuItem icon={<Type size={15} />} label="텍스트 상자 삽입" onClick={run(() => useEditor.getState().set({ insertTool: { kind: 'text' } }))} />
        </>
      )}
    </div>,
    document.body,
  );
}
