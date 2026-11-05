import { describe, expect, it, beforeEach } from 'vitest';
import { useEditor } from '../store/editorStore';
import { createPresentation, createShape } from '../document/factory';
import { addObjects, addSlide, nudgeObjects } from '../commands/commands';

describe('실행 취소/다시 실행', () => {
  beforeEach(() => useEditor.getState().loadDocument(createPresentation()));

  it('commit → undo → redo', () => {
    const s = useEditor.getState();
    const before = s.doc;
    s.commit('슬라이드 추가', (d) => void addSlide(d, null, 'blank'));
    expect(useEditor.getState().doc.slides).toHaveLength(2);
    useEditor.getState().undo();
    expect(useEditor.getState().doc).toBe(before);
    useEditor.getState().redo();
    expect(useEditor.getState().doc.slides).toHaveLength(2);
  });

  it('제스처는 하나의 기록으로 묶임', () => {
    const s = useEditor.getState();
    const sid = s.doc.slides[0].id;
    const shape = createShape('rect', 0, 0);
    s.commit('도형', (d) => addObjects(d, sid, [shape]));
    const pastLen = useEditor.getState().history.past.length;
    s.beginGesture('이동');
    for (let i = 0; i < 10; i++) useEditor.getState().updateGesture((d) => nudgeObjects(d, sid, [shape.id], 5, 0));
    useEditor.getState().endGesture();
    expect(useEditor.getState().history.past.length).toBe(pastLen + 1);
    const moved = useEditor.getState().doc.slides[0].objects.find((o) => o.id === shape.id)!;
    expect(moved.x).toBe(50);
    useEditor.getState().undo();
    expect(useEditor.getState().doc.slides[0].objects.find((o) => o.id === shape.id)!.x).toBe(0);
  });

  it('새 변경 시 redo 스택 비움', () => {
    const s = useEditor.getState();
    s.commit('a', (d) => void addSlide(d, null));
    useEditor.getState().undo();
    expect(useEditor.getState().history.future).toHaveLength(1);
    useEditor.getState().commit('b', (d) => void addSlide(d, null));
    expect(useEditor.getState().history.future).toHaveLength(0);
  });
});
