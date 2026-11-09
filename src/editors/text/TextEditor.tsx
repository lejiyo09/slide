import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TextBody } from '../../types/model';
import type { EditableObject } from '../../engines/rendering/ObjectView';
import { useEditor } from '../../core/store/editorStore';
import { updateObjects } from '../../core/commands/commands';
import { htmlToParagraphs, paragraphsToHtml, renumberDom } from './richText';
import { setEditorSession, getEditorSession } from './editorSession';
import { takePendingCaretPoint } from './caret';
import { applyFormat } from './formatting';
import { openInlineMathEditor } from './inlineMath';
import { textContainerStyle, textDirClass, textInnerStyle } from '../../engines/rendering/ObjectView';

/**
 * contentEditable 기반 서식 있는 텍스트 편집기.
 * 편집 세션 전체가 하나의 실행 취소 단계가 되도록 제스처로 묶는다.
 */
const bodyOf = (obj: EditableObject, cell?: [number, number]): TextBody =>
  obj.type === 'table' ? obj.rows[cell?.[0] ?? 0].cells[cell?.[1] ?? 0].text : obj.text;

export function TextEditor({ obj, slideId, selectAll, cell }: { obj: EditableObject; slideId: string; selectAll?: boolean; cell?: [number, number] }) {
  const ref = useRef<HTMLDivElement>(null);
  const spellAsYouType = useEditor((s) => s.spellAsYouType);
  const objRef = useRef(obj);
  objRef.current = obj;
  const cellKey = cell ? `${cell[0]},${cell[1]}` : '';

  useLayoutEffect(() => {
    const root = ref.current!;
    const store = useEditor.getState();
    store.beginGesture(cell ? '셀 편집' : '텍스트 편집');
    const initial = bodyOf(obj, cell);
    root.innerHTML = paragraphsToHtml(initial.paragraphs, store.doc.theme);
    const first = initial.paragraphs[0]?.runs[0] ?? {};
    const fallback = { ...first, text: undefined } as Record<string, unknown>;
    delete fallback.text;

    const sync = () => {
      renumberDom(root);
      const paragraphs = htmlToParagraphs(root, fallback, useEditor.getState().doc.theme);
      const id = objRef.current.id;
      useEditor.getState().updateGesture((d) =>
        updateObjects(d, slideId, [id], (o) => {
          if (o.type === 'table' && cell) {
            const [r, c] = cell;
            const target = o.rows[r]?.cells[c];
            if (!target) return;
            target.text.paragraphs = paragraphs;
            // 셀 내용이 넘치면 행 높이를 늘림 (병합 셀은 마지막 행)
            const lastRow = r + (target.rowSpan ?? 1) - 1;
            const spanH = o.rows.slice(r, lastRow + 1).reduce((a, x) => a + x.height, 0);
            const needed = Math.ceil(root.scrollHeight + target.text.padding.top + target.text.padding.bottom);
            if (needed > spanH + 1) {
              o.rows[lastRow].height += needed - spanH;
              o.height = o.rows.reduce((a, x) => a + x.height, 0);
            }
            return;
          }
          if (o.type !== 'text' && o.type !== 'shape') return;
          o.text.paragraphs = paragraphs;
          // 텍스트 상자는 내용에 맞게 높이 자동 조정 (PowerPoint의 '텍스트에 맞게 도형 크기 조정')
          if (o.type === 'text' && o.text.autoFit === 'resize' && o.text.direction === 'horizontal') {
            const needed = Math.ceil(root.scrollHeight + o.text.padding.top + o.text.padding.bottom);
            if (Math.abs(needed - o.height) > 1) o.height = Math.max(needed, 20);
          }
        }),
      );
    };
    setEditorSession({ objId: obj.id, root, sync, savedRange: null });

    root.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (sel) {
      // 더블클릭 위치에 커서 배치, 없으면 끝으로
      const pt = takePendingCaretPoint();
      let range: Range | null = null;
      if (pt && !selectAll && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(pt.x, pt.y);
        if (r && root.contains(r.startContainer)) range = r;
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(root);
        if (!selectAll) range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }

    return () => {
      // 언마운트 직전 마지막 동기화 후 기록
      try {
        if (root.isConnected) sync();
      } catch {
        /* ignore */
      }
      if (getEditorSession()?.root === root) setEditorSession(null);
      useEditor.getState().endGesture();
    };
    // 편집 세션은 객체 ID(+셀) 기준으로 한 번만 시작
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id, cellKey]);

  useEffect(() => {
    const root = ref.current!;
    const onPaste = (e: ClipboardEvent) => {
      // 서식 있는 HTML 붙여넣기는 구조를 깨뜨리므로 일반 텍스트로 삽입
      const text = e.clipboardData?.getData('text/plain');
      if (text !== undefined && !e.clipboardData?.files.length) {
        e.preventDefault();
        document.execCommand('insertText', false, text);
      }
    };
    root.addEventListener('paste', onPaste);
    return () => root.removeEventListener('paste', onPaste);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      useEditor.getState().setEditingText(null);
      return;
    }
    if (e.key === 'Tab' && obj.type === 'table' && cell) {
      // 표: Tab/Shift+Tab으로 다음/이전 셀 (마지막 셀에서 Tab이면 행 추가)
      e.preventDefault();
      e.stopPropagation();
      moveCell(obj.id, slideId, cell, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = getEditorSession();
      if (!s) return;
      const sel = document.getSelection();
      const paras = Array.from(s.root.children).filter((p) => sel && sel.rangeCount && sel.getRangeAt(0).intersectsNode(p)) as HTMLElement[];
      paras.forEach((p) => {
        const lvl = Math.max(0, Math.min(8, Number(p.dataset.level ?? 0) + (e.shiftKey ? -1 : 1)));
        p.dataset.level = String(lvl);
        const bullet = p.dataset.bullet && p.dataset.bullet !== 'none';
        p.style.paddingLeft = `${lvl * 36 + (bullet ? 27 : 0)}px`;
      });
      s.sync();
      return;
    }
    // 서식 단축키는 일관된 서식 엔진으로 처리 (브라우저 기본 <b>/<i> 태그 대신)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const fmt: Record<string, () => void> = {
        b: () => applyFormat({ type: 'toggle', key: 'bold' }),
        i: () => applyFormat({ type: 'toggle', key: 'italic' }),
        u: () => applyFormat({ type: 'toggle', key: 'underline' }),
        l: () => applyFormat({ type: 'align', value: 'left' }),
        e: () => applyFormat({ type: 'align', value: 'center' }),
        r: () => applyFormat({ type: 'align', value: 'right' }),
        j: () => applyFormat({ type: 'align', value: 'justify' }),
        ']': () => applyFormat({ type: 'growFont' }),
        '[': () => applyFormat({ type: 'shrinkFont' }),
      };
      if (fmt[k]) {
        e.preventDefault();
        e.stopPropagation();
        fmt[k]();
        return;
      }
      if (k === 'k') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('slidelab:link'));
        return;
      }
      // 실행 취소/저장/슬라이드 쇼 등은 편집기 밖 단축키로 전달
      if (k === 's' || k === 'm') return;
    }
    if (e.key === 'F5') return;
    // 전역 단축키(삭제, 복사 등)가 텍스트 편집을 방해하지 않도록
    e.stopPropagation();
  };

  const body = bodyOf(obj, cell);
  return (
    <div style={cell ? { position: 'relative' } : textContainerStyle(body)} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => {
        e.stopPropagation();
        // 문단 안 수식 두 번 클릭 → 수식 편집
        const m = (e.target as Element).closest?.('.sl-math-inline') as HTMLElement | null;
        if (m && ref.current?.contains(m)) openInlineMathEditor(m);
      }}>
      <div
        ref={ref}
        className={`sl-text-inner sl-editing ${textDirClass(body)}`}
        style={{ ...textInnerStyle(body), cursor: 'text' }}
        contentEditable
        suppressContentEditableWarning
        spellCheck={spellAsYouType}
        lang="ko"
        onInput={() => getEditorSession()?.sync()}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** 표에서 다음/이전 셀로 편집 이동 */
function moveCell(objId: string, slideId: string, cell: [number, number], dir: 1 | -1) {
  const st = useEditor.getState();
  const slide = st.doc.slides.find((x) => x.id === slideId);
  const t = slide?.objects.find((o) => o.id === objId);
  if (!t || t.type !== 'table') return;
  const cols = t.columns.length;
  let idx = cell[0] * cols + cell[1];
  for (;;) {
    idx += dir;
    if (idx < 0) return;
    if (idx >= t.rows.length * cols) {
      // 마지막 셀: 새 행 추가 후 첫 셀로
      st.setEditingText(null);
      import('../table/tableActions').then((m) => m.tableInsertRow('below', objId, t.rows.length - 1)).then(() => {
        useEditor.getState().setEditingText(objId, [t.rows.length, 0]);
      });
      return;
    }
    const r = Math.floor(idx / cols), c = idx % cols;
    if (!t.rows[r].cells[c].merged) {
      st.setEditingText(null);
      setTimeout(() => useEditor.getState().setEditingText(objId, [r, c]), 0);
      return;
    }
  }
}
