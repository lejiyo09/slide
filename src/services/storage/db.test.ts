import { describe, expect, it } from 'vitest';
import { createPresentation } from '../../core/document/factory';
import { deleteProject, listProjects, loadProject, saveProject, saveVersion, listVersions } from './db';

describe('IndexedDB 저장소', () => {
  it('저장/목록/불러오기/삭제', async () => {
    const doc = createPresentation('저장 테스트');
    await saveProject(doc);
    const list = await listProjects();
    expect(list.find((m) => m.id === doc.id)?.title).toBe('저장 테스트');
    const loaded = await loadProject(doc.id);
    expect(loaded?.slides).toHaveLength(1);
    await saveVersion(doc, '버전 1');
    expect(await listVersions(doc.id)).toHaveLength(1);
    await deleteProject(doc.id);
    expect(await loadProject(doc.id)).toBeUndefined();
    expect(await listVersions(doc.id)).toHaveLength(0);
  });
});
