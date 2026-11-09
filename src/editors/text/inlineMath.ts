/**
 * 문단 안 수식 넣기·고치기 (편집 중인 텍스트 상자의 커서 자리).
 * 수식 대화 상자를 열기 전에 선택 영역을 고정하고, 확인하면 그 자리에 수식 덩어리(contenteditable=false)를 넣은 뒤 모델과 동기화한다.
 */
import type { InlineMath } from '../../types/model';
import { useEditor } from '../../core/store/editorStore';
import { getEditorSession, lockSelection, restoreSelection } from './editorSession';
import { inlineMathHtml } from './richText';

let target: HTMLElement | null = null;

/** 편집 중인 문단 안 수식 (두 번 클릭한 수식) */
export function inlineMathTarget(): InlineMath | null {
  if (!target?.dataset.math) return null;
  try {
    return JSON.parse(decodeURIComponent(target.dataset.math)) as InlineMath;
  } catch {
    return null;
  }
}

/** 수식 대화 상자를 문단 안 수식 모드로 연다 (편집 중인 텍스트 상자가 없으면 false) */
export function openInlineMathEditor(existing?: HTMLElement): boolean {
  const s = getEditorSession();
  if (!s) return false;
  lockSelection();
  target = existing ?? null;
  useEditor.getState().set({ equationEditorId: existing ? 'inline-edit' : 'inline' });
  return true;
}

/** 대화 상자 확인: 커서 자리에 넣거나 두 번 클릭한 수식을 바꿈 */
export function commitInlineMath(math: InlineMath): boolean {
  const s = getEditorSession();
  if (!s) return false;
  const tpl = document.createElement('template');
  tpl.innerHTML = inlineMathHtml(math);
  const node = tpl.content.firstElementChild as HTMLElement;
  // 바깥 글자 서식(크기·색)은 둘레 런을 따름
  if (target && s.root.contains(target)) {
    node.setAttribute('style', target.getAttribute('style') ?? '');
    target.replaceWith(node);
  } else {
    const sel = restoreSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !s.root.contains(range.startContainer)) return false;
    range.deleteContents();
    // 커서가 문단(div) 밖, 편집기 바로 아래면 가까운 문단 끝으로 (밖에 넣으면 새 문단이 생김)
    if (range.startContainer === s.root) {
      const blocks = Array.from(s.root.children);
      const para = blocks[Math.min(blocks.length - 1, Math.max(0, range.startOffset - 1))];
      if (para) {
        const last = para.lastChild;
        if (last && last.nodeName === 'SPAN' && !(last as HTMLElement).classList.contains('sl-math-inline')) range.setStart(last, last.childNodes.length);
        else range.setStart(para, para.childNodes.length);
        range.collapse(true);
      }
    }
    // 글자 노드 안이면 그 span의 서식을 이어받음
    const host = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : (range.startContainer as HTMLElement)) as HTMLElement | null;
    const styled = host?.closest('span[style]') as HTMLElement | null;
    if (styled && s.root.contains(styled) && !styled.classList.contains('sl-math-inline')) node.setAttribute('style', styled.getAttribute('style') ?? '');
    range.insertNode(node);
    // 커서는 수식 뒤로
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel!.removeAllRanges();
    sel!.addRange(after);
  }
  target = null;
  s.sync();
  return true;
}

export function cancelInlineMath() {
  target = null;
  restoreSelection();
}
