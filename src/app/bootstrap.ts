import { useEditor } from '../core/store/editorStore';
import { getSetting, loadProject } from '../services/storage/db';
import { saveNow, startAutosave } from '../services/storage/autosave';
import { migrate } from '../core/document/migrate';

/** 앱 시작: 마지막으로 연 프로젝트 복원 후 자동 저장 시작 */
export async function bootstrap() {
  try {
    const lastId = await getSetting<string>('lastProjectId');
    if (lastId) {
      const doc = await loadProject(lastId);
      if (doc) useEditor.getState().loadDocument(migrate(doc));
    }
    if (!lastId) await saveNow();
  } catch (e) {
    console.warn('저장된 프로젝트를 불러오지 못했습니다', e);
    useEditor.getState().toast('이 브라우저에서 저장소(IndexedDB)를 사용할 수 없어 자동 저장이 비활성화됩니다.', 'warning');
  }
  startAutosave();
}
