import type { Presentation } from '../../types/model';

/** 저장된 문서의 스키마 버전 호환 처리 (향후 버전 변경 시 확장) */
export function migrate(doc: Presentation): Presentation {
  if (!doc.sections) doc.sections = [];
  if (!doc.assets) doc.assets = {};
  for (const s of doc.slides) {
    if (s.notes === undefined) s.notes = '';
    if (!s.layout) s.layout = 'blank';
  }
  return doc;
}
