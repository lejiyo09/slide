/**
 * IndexedDB 저장소 (idb 라이브러리 사용, ISC 라이선스)
 * - projects: 전체 프레젠테이션 문서
 * - meta: 프로젝트 목록 표시용 요약(제목, 수정 시각, 축소판 정보)
 * - versions: 수동 저장 시점의 버전 스냅샷 (최대 N개)
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Presentation } from '../../types/model';

export interface ProjectMeta {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  slideCount: number;
}

export interface VersionEntry {
  key: string; // `${projectId}:${savedAt}`
  projectId: string;
  savedAt: number;
  label: string;
  doc: Presentation;
}

interface SlideLabDB extends DBSchema {
  projects: { key: string; value: Presentation };
  meta: { key: string; value: ProjectMeta; indexes: { byUpdated: number } };
  versions: { key: string; value: VersionEntry; indexes: { byProject: string } };
  settings: { key: string; value: unknown };
  /** 가져온 원본 PPTX 패키지 (보존 개체 복원용) */
  packages: { key: string; value: Blob };
}

const DB_NAME = 'slidelab';
const DB_VERSION = 2;
const MAX_VERSIONS = 20;

let dbPromise: Promise<IDBPDatabase<SlideLabDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SlideLabDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' });
          const meta = db.createObjectStore('meta', { keyPath: 'id' });
          meta.createIndex('byUpdated', 'updatedAt');
          const versions = db.createObjectStore('versions', { keyPath: 'key' });
          versions.createIndex('byProject', 'projectId');
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) db.createObjectStore('packages');
      },
    });
  }
  return dbPromise;
}

export function toMeta(doc: Presentation): ProjectMeta {
  return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, createdAt: doc.createdAt, slideCount: doc.slides.length };
}

export async function saveProject(doc: Presentation) {
  const db = await getDB();
  const tx = db.transaction(['projects', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('projects').put(doc), tx.objectStore('meta').put(toMeta(doc)), tx.done]);
}

export async function loadProject(id: string): Promise<Presentation | undefined> {
  return (await getDB()).get('projects', id);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await getDB()).getAll('meta');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string) {
  const db = await getDB();
  const doc = await db.get('projects', id);
  if (doc?.source) await db.delete('packages', doc.source.packageId);
  const tx = db.transaction(['projects', 'meta', 'versions'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  await tx.objectStore('meta').delete(id);
  const keys = await tx.objectStore('versions').index('byProject').getAllKeys(id);
  for (const k of keys) await tx.objectStore('versions').delete(k);
  await tx.done;
}

export async function setSetting(key: string, value: unknown) {
  await (await getDB()).put('settings', value, key);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await getDB()).get('settings', key)) as T | undefined;
}

export async function saveVersion(doc: Presentation, label: string) {
  const db = await getDB();
  const savedAt = Date.now();
  await db.put('versions', { key: `${doc.id}:${savedAt}`, projectId: doc.id, savedAt, label, doc });
  const all = await db.getAllFromIndex('versions', 'byProject', doc.id);
  all.sort((a, b) => b.savedAt - a.savedAt);
  for (const old of all.slice(MAX_VERSIONS)) await db.delete('versions', old.key);
}

export async function listVersions(projectId: string): Promise<Omit<VersionEntry, 'doc'>[]> {
  const all = await (await getDB()).getAllFromIndex('versions', 'byProject', projectId);
  return all.sort((a, b) => b.savedAt - a.savedAt).map(({ doc: _d, ...rest }) => (void _d, rest));
}

export async function loadVersion(key: string) {
  return (await getDB()).get('versions', key);
}

export async function savePackage(id: string, data: Blob) {
  await (await getDB()).put('packages', data, id);
}

export async function getPackage(id: string): Promise<Blob | undefined> {
  return (await getDB()).get('packages', id);
}
