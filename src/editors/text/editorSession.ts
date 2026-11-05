/**
 * 현재 활성화된 텍스트 편집기(contentEditable)의 전역 참조.
 * 리본/속성 창에서 서식을 적용할 때 사용한다.
 */
export interface EditorSession {
  objId: string;
  root: HTMLElement;
  /** DOM 변경 후 모델과 동기화 */
  sync: () => void;
  savedRange: Range | null;
  /** 대화 상자 등으로 포커스가 옮겨갈 때 선택 영역을 고정 */
  locked?: boolean;
}

let session: EditorSession | null = null;
const listeners = new Set<() => void>();

export const getEditorSession = () => session;

export function setEditorSession(s: EditorSession | null) {
  session = s;
  listeners.forEach((l) => l());
}

export function onEditorSelectionChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function notifySelectionChange() {
  listeners.forEach((l) => l());
}

if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', () => {
    if (!session || session.locked) return;
    const sel = document.getSelection();
    if (sel && sel.rangeCount && session.root.contains(sel.anchorNode)) {
      session.savedRange = sel.getRangeAt(0).cloneRange();
      notifySelectionChange();
    }
  });
}

/** 현재 편집기 선택 영역을 고정 (대화 상자를 열기 직전에 호출) */
export function lockSelection() {
  if (!session) return;
  const sel = document.getSelection();
  if (sel && sel.rangeCount && session.root.contains(sel.anchorNode)) session.savedRange = sel.getRangeAt(0).cloneRange();
  session.locked = true;
}

/** 저장된 선택 영역 복원 (리본의 select 요소로 포커스가 옮겨간 경우) */
export function restoreSelection(): Selection | null {
  if (!session) return null;
  if (session.locked) {
    session.locked = false;
    const sel = document.getSelection();
    session.root.focus({ preventScroll: true });
    if (sel && session.savedRange) {
      sel.removeAllRanges();
      sel.addRange(session.savedRange);
    }
    return sel;
  }
  const sel = document.getSelection();
  if (!sel) return null;
  // 현재 선택이 편집기 안에 있으면 그대로 사용 (selectionchange는 비동기라 저장본이 늦을 수 있음)
  if (sel.rangeCount && session.root.contains(sel.anchorNode) && document.activeElement === session.root) {
    session.savedRange = sel.getRangeAt(0).cloneRange();
    return sel;
  }
  if (document.activeElement !== session.root) session.root.focus({ preventScroll: true });
  if (session.savedRange && session.root.contains(session.savedRange.startContainer)) {
    sel.removeAllRanges();
    sel.addRange(session.savedRange);
  }
  return sel;
}

/** 선택 영역과 겹치는 문단 요소들 */
export function selectedParagraphs(): HTMLElement[] {
  if (!session) return [];
  const root = session.root;
  const live = document.getSelection();
  if (live && live.rangeCount && root.contains(live.anchorNode)) session.savedRange = live.getRangeAt(0).cloneRange();
  const paras = Array.from(root.children).filter((c) => c instanceof HTMLElement) as HTMLElement[];
  const range = session.savedRange;
  if (!range) return paras;
  const hit = paras.filter((p) => range.intersectsNode(p));
  if (hit.length) return hit;
  return paras;
}
