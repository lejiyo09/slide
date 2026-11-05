/**
 * 자동 저장: 문서가 바뀌면 debounce 후 IndexedDB에 저장.
 * 마지막으로 연 프로젝트 ID를 기억해 다음 실행 시 복원한다.
 */
import { useEditor } from '../../core/store/editorStore';
import { saveProject, setSetting } from './db';

const DELAY = 800;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export async function saveNow() {
  const s = useEditor.getState();
  const doc = s.doc;
  if (timer) clearTimeout(timer);
  timer = null;
  useEditor.setState({ saveStatus: 'saving' });
  try {
    await saveProject(doc);
    await setSetting('lastProjectId', doc.id);
    // 저장 중 다시 변경되었으면 unsaved 유지
    if (useEditor.getState().doc === doc) useEditor.setState({ saveStatus: 'saved', lastSavedAt: Date.now() });
  } catch (e) {
    console.error('자동 저장 실패', e);
    useEditor.setState({ saveStatus: 'error' });
    useEditor.getState().toast('자동 저장에 실패했습니다. 저장 공간을 확인하세요.', 'error');
  }
}

export function startAutosave() {
  if (started) return;
  started = true;
  useEditor.subscribe((state, prev) => {
    if (state.doc === prev.doc) return;
    if (state.gestureBase) return; // 드래그 중에는 저장하지 않음
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveNow, DELAY);
  });
  // 제스처 종료 시 저장 예약
  useEditor.subscribe((state, prev) => {
    if (prev.gestureBase && !state.gestureBase) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveNow, DELAY);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (useEditor.getState().saveStatus === 'unsaved') {
      void saveNow();
      e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && useEditor.getState().saveStatus === 'unsaved') void saveNow();
  });
}
