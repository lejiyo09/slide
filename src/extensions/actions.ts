/** 확장 개체 넣기 (리본 [삽입]): 등록된 확장의 insert를 불러 문서에 추가 (실행 취소 한 단계) */
import { getExtension, type ExtensionInsertResult } from './registry';
import { getActiveSlide, useEditor } from '../core/store/editorStore';
import * as C from '../core/commands/commands';

export async function insertExtension(kind: string, preset?: ExtensionInsertResult) {
  const st = useEditor.getState();
  const ext = getExtension(kind);
  if (!ext) return;
  try {
    const r = preset ?? (ext.insert ? await ext.insert(st.doc) : null);
    if (!r) return;
    const slide = getActiveSlide();
    useEditor.getState().commit(`${ext.name} 삽입`, (d) => {
      for (const a of r.assets) d.assets[a.id] = a;
      C.addObjects(d, slide.id, [r.obj]);
    });
    useEditor.getState().select([r.obj.id]);
  } catch (e) {
    useEditor.getState().toast(`${ext.name}을(를) 넣지 못했습니다: ${(e as Error).message}`, 'error');
  }
}
