import { useEffect } from 'react';
import { useEditor, getSelectedObjects, getActiveSlide } from '../core/store/editorStore';
import * as A from '../core/commands/actions';
import * as C from '../core/commands/commands';
import { applyFormat } from '../editors/text/formatting';
import { saveNow } from '../services/storage/autosave';
import { createTextBox } from '../core/document/factory';
import { startShow } from '../core/commands/showActions';

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

/** 전역 키보드 단축키 (PowerPoint 기본 단축키 기준) */
export function useShortcuts() {
  useEffect(() => {
    let nudging = false;
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      if (s.slideshow || s.backstageOpen) {
        if (s.backstageOpen && e.key === 'Escape') s.set({ backstageOpen: false });
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const editingField = isEditable(e.target);

      // 텍스트 편집 중에도 동작하는 서식 단축키
      if (mod && s.editingTextId && !e.altKey) {
        const map: Record<string, () => void> = {
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
        const fn = map[k.toLowerCase()];
        if (fn) {
          e.preventDefault();
          fn();
          return;
        }
      }
      if (editingField) return;

      const slidesFocus = s.focusArea === 'slides' || s.viewMode === 'sorter';
      const hasSel = s.selectedIds.length > 0;

      const handled = () => e.preventDefault();

      if (mod && !e.altKey) {
        switch (k.toLowerCase()) {
          case 'z':
            handled();
            return e.shiftKey ? s.redo() : s.undo();
          case 'y':
            handled();
            return s.redo();
          case 's':
            handled();
            void saveNow().then(() => useEditor.getState().toast('저장되었습니다.', 'success'));
            return;
          case 'c':
            if (e.shiftKey) {
              handled();
              return A.startFormatPainter(true);
            }
            handled();
            if (slidesFocus || !hasSel) A.copySlides();
            else A.copySelection();
            return;
          case 'x':
            handled();
            if (slidesFocus || !hasSel) {
              A.copySlides();
              A.deleteSelectedSlides();
            } else A.copySelection(true);
            return;
          case 'v':
            if (e.shiftKey && s.formatPainter) {
              handled();
              s.selectedIds.forEach((id) => A.applyFormatPainterTo(id));
              useEditor.getState().set({ formatPainter: null });
              return;
            }
            return; // paste 이벤트에서 처리 (시스템 클립보드 이미지 지원)
          case 'd':
            handled();
            return slidesFocus || !hasSel ? A.duplicateSelectedSlides() : A.duplicateSelection();
          case 'm':
            handled();
            return A.newSlide();
          case 'a':
            handled();
            if (slidesFocus) return s.setSelectedSlides(s.doc.slides.map((x) => x.id));
            return A.selectAll();
          case 'k':
            handled();
            window.dispatchEvent(new CustomEvent('slidelab:link'));
            return;
          case 'g':
            handled();
            return e.shiftKey ? A.ungroup() : A.group();
          case 'b':
            if (hasSel) (handled(), applyFormat({ type: 'toggle', key: 'bold' }));
            return;
          case 'i':
            if (hasSel) (handled(), applyFormat({ type: 'toggle', key: 'italic' }));
            return;
          case 'u':
            if (hasSel) (handled(), applyFormat({ type: 'toggle', key: 'underline' }));
            return;
          case 'l':
          case 'e':
          case 'r':
          case 'j':
            if (hasSel) {
              handled();
              applyFormat({ type: 'align', value: ({ l: 'left', e: 'center', r: 'right', j: 'justify' } as const)[k.toLowerCase() as 'l'] });
            }
            return;
          case ']':
          case '}':
            handled();
            return e.shiftKey ? A.reorder('front') : applyFormat({ type: 'growFont' });
          case '[':
          case '{':
            handled();
            return e.shiftKey ? A.reorder('back') : applyFormat({ type: 'shrinkFont' });
          case '=':
          case '+':
            handled();
            return A.zoomBy(1);
          case '-':
            handled();
            return A.zoomBy(-1);
          case '0':
            handled();
            return s.set({ fitMode: true });
          case 'arrowup':
          case 'arrowdown':
            if (slidesFocus) {
              handled();
              return A.moveSelectedSlides(k === 'ArrowUp' ? -1 : 1);
            }
        }
      }

      switch (k) {
        case 'F5':
          handled();
          // F5 처음부터, Shift+F5 현재 슬라이드부터, Alt+F5 발표자 보기
          startShow({ fromCurrent: e.shiftKey, ...(e.altKey ? { presenter: true } : {}) });
          return;
        case 'Escape':
          if (s.insertTool) return s.set({ insertTool: null });
          if (s.formatPainter) return s.set({ formatPainter: null });
          if (s.cropId) return s.set({ cropId: null });
          if (hasSel) return s.select([]);
          return;
        case 'Delete':
        case 'Backspace':
          handled();
          if (slidesFocus) return A.deleteSelectedSlides();
          return A.deleteSelection();
        case 'Enter':
        case 'F2': {
          if (s.cropId) return s.set({ cropId: null });
          const o = getSelectedObjects();
          if (o.length === 1 && (o[0].type === 'text' || o[0].type === 'shape') && !slidesFocus) {
            handled();
            s.setEditingText(o[0].id);
          } else if (slidesFocus && k === 'Enter') {
            handled();
            A.newSlide();
          }
          return;
        }
        case 'PageDown':
          handled();
          return A.goToSlide(1);
        case 'PageUp':
          handled();
          return A.goToSlide(-1);
        case 'Home':
          if (slidesFocus || !hasSel) (handled(), s.setActiveSlide(s.doc.slides[0].id));
          return;
        case 'End':
          if (slidesFocus || !hasSel) (handled(), s.setActiveSlide(s.doc.slides[s.doc.slides.length - 1].id));
          return;
        case 'Tab': {
          if (slidesFocus) return;
          handled();
          const objs = getActiveSlide().objects.filter((o) => !o.hidden);
          if (!objs.length) return;
          const cur = objs.findIndex((o) => o.id === s.selectedIds[s.selectedIds.length - 1]);
          const next = objs[(cur + (e.shiftKey ? -1 : 1) + objs.length) % objs.length];
          return s.select([next.id]);
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          handled();
          if (slidesFocus || !hasSel) return A.goToSlide(k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1);
          const step = mod ? 1 : e.shiftKey ? 40 : 8;
          const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
          const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
          // 연속 키 입력은 하나의 실행 취소 단계로 묶는다
          if (e.repeat) {
            if (!s.gestureBase) nudging = true;
            s.beginGesture('이동');
            s.updateGesture((d) => C.nudgeObjects(d, getActiveSlide().id, s.selectedIds, dx, dy));
          } else {
            if (nudging) {
              nudging = false;
              s.endGesture();
            }
            A.nudge(dx, dy);
          }
          return;
        }
      }
    };

    // 키보드 이동(방향키 누르고 있기)이 시작한 단위만 닫음 — 텍스트 편집 중 방향키는 편집기의 실행 취소 단위를 건드리지 않음
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow') && nudging) {
        nudging = false;
        useEditor.getState().endGesture();
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const s = useEditor.getState();
      if (isEditable(e.target) || s.slideshow || s.backstageOpen) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void A.insertImageFiles(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      // 내부 클립보드가 방금 복사한 내용과 같으면 SlideLab 개체로 붙여넣기
      if (s.clipboard && (!text || text.startsWith('[SlideLab') || s.clipboard.kind === 'slides' || matchesClipboardText(text))) {
        e.preventDefault();
        A.paste();
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        const slide = getActiveSlide();
        const tb = createTextBox({
          x: 80,
          y: 80,
          width: Math.min(800, s.doc.size.width - 160),
          height: 40,
          text: text.replace(/\r\n/g, '\n'),
          style: { fontFamily: '@body', fontSize: 18, color: '@dark1' },
        });
        tb.text.autoFit = 'resize';
        tb.height = Math.max(40, text.split('\n').length * 32);
        s.commit('텍스트 붙여넣기', (d) => C.addObjects(d, slide.id, [tb]));
        useEditor.getState().select([tb.id]);
      } else if (s.clipboard) {
        e.preventDefault();
        A.paste();
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

function matchesClipboardText(text: string) {
  const clip = useEditor.getState().clipboard;
  if (!clip || clip.kind !== 'objects') return false;
  const t = clip.objects
    .map((o) => (o.type === 'text' || o.type === 'shape' ? o.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : ''))
    .filter(Boolean)
    .join('\n');
  return t === text;
}
