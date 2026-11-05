/** 사용자 지정 테마 / 사용자 템플릿 보관 (IndexedDB settings) */
import { getSetting, setSetting } from './db';
import type { Theme } from '../../types/model';
import type { snapshotDesign } from '../../core/commands/masterActions';

export interface UserTemplate {
  id: string;
  name: string;
  savedAt: number;
  design: ReturnType<typeof snapshotDesign>;
}

const listeners = new Set<() => void>();
export const onLibraryChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const notify = () => listeners.forEach((f) => f());

export async function getCustomThemes(): Promise<Theme[]> {
  return (await getSetting<Theme[]>('customThemes').catch(() => undefined)) ?? [];
}

export async function saveCustomTheme(t: Theme) {
  const list = (await getCustomThemes()).filter((x) => x.id !== t.id);
  await setSetting('customThemes', [...list, t]);
  notify();
}

export async function deleteCustomTheme(id: string) {
  await setSetting('customThemes', (await getCustomThemes()).filter((x) => x.id !== id));
  notify();
}

export async function getUserTemplates(): Promise<UserTemplate[]> {
  return (await getSetting<UserTemplate[]>('userTemplates').catch(() => undefined)) ?? [];
}

export async function saveUserTemplate(t: UserTemplate) {
  const list = (await getUserTemplates()).filter((x) => x.id !== t.id);
  await setSetting('userTemplates', [...list, t]);
  notify();
}

export async function deleteUserTemplate(id: string) {
  await setSetting('userTemplates', (await getUserTemplates()).filter((x) => x.id !== id));
  notify();
}
