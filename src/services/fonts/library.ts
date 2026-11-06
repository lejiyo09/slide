/**
 * 글꼴 라이브러리: 사용자가 추가한 글꼴(IndexedDB) + 웹 글꼴(Google Fonts) + 이 컴퓨터의 글꼴 확인.
 * 글꼴은 문서(document.fonts)에 FontFace로 등록되어 편집기·축소판·슬라이드 쇼에서 바로 쓰인다.
 * 청중 화면 창(별도 창)처럼 다른 문서에도 같은 글꼴을 등록할 수 있다.
 */
import { create } from 'zustand';
import { deleteUserFont, listUserFonts, putUserFont, type UserFontRecord } from '../storage/db';
import { readFontInfo } from './sfnt';
import { isWebFont, koreanUserFamilies, SYSTEM_FONTS, webFontCssUrl, WEB_FONTS } from './catalog';
import { newId } from '../../utils/id';

export type UserFontMeta = Omit<UserFontRecord, 'data'>;

const MAX_FONT_BYTES = 30 * 1024 * 1024;
const PREF_KEY = 'slidelab.fonts';

interface Prefs {
  webFonts: boolean;
  recent: string[];
  /** Local Font Access API로 읽은 이 컴퓨터의 글꼴 이름 */
  local: string[];
}

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return { webFonts: v.webFonts ?? true, recent: v.recent ?? [], local: v.local ?? [] };
  } catch {
    return { webFonts: true, recent: [], local: [] };
  }
}

interface FontState extends Prefs {
  userFonts: UserFontMeta[];
  /** 시스템 글꼴 설치 여부 (확인한 것만) */
  installed: Record<string, boolean>;
  /** 웹 글꼴 상태 */
  web: Record<string, 'loading' | 'ready' | 'error'>;
  ready: boolean;
  /** 열린 문서에 쓰였지만 이 브라우저에 없는 글꼴 (알려진 시스템 글꼴 제외) */
  missing: string[];
}

export const useFonts = create<FontState>()(() => ({ ...loadPrefs(), userFonts: [], installed: {}, web: {}, ready: false, missing: [] }));

function savePrefs() {
  const { webFonts, recent, local } = useFonts.getState();
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ webFonts, recent, local }));
  } catch {
    /* 저장 불가 (사생활 보호 모드 등) */
  }
}

export function setWebFontsEnabled(v: boolean) {
  useFonts.setState({ webFonts: v });
  savePrefs();
}

export function addRecent(family: string) {
  if (!family || family.startsWith('@')) return;
  const recent = [family, ...useFonts.getState().recent.filter((f) => f.toLowerCase() !== family.toLowerCase())].slice(0, 8);
  useFonts.setState({ recent });
  savePrefs();
}

const strip = (r: UserFontRecord): UserFontMeta => {
  const { data, ...meta } = r;
  void data;
  return meta;
};

/* ───────────── 문서에 등록 ───────────── */

type FontFaceCtor = typeof FontFace;
/** 문서별로 등록한 FontFace (id → 이름별 FontFace) */
const registered = new WeakMap<Document, Map<string, FontFace[]>>();

async function registerRecord(doc: Document, rec: UserFontRecord) {
  const win = doc.defaultView as (Window & { FontFace?: FontFaceCtor }) | null;
  const Ctor = win?.FontFace ?? (typeof FontFace !== 'undefined' ? FontFace : undefined);
  if (!Ctor || !doc.fonts) return;
  let map = registered.get(doc);
  if (!map) registered.set(doc, (map = new Map()));
  unregisterRecord(doc, rec.id);
  const buf = await rec.data.arrayBuffer();
  const faces: FontFace[] = [];
  for (const name of [rec.family, ...rec.aliases]) {
    const face = new Ctor(name, buf.slice(0), { weight: String(rec.weight), style: rec.italic ? 'italic' : 'normal', display: 'swap' });
    try {
      await face.load();
      doc.fonts.add(face);
      faces.push(face);
    } catch {
      /* 손상된 파일: 목록에는 남기고 경고는 추가할 때 표시 */
    }
  }
  map.set(rec.id, faces);
}

function unregisterRecord(doc: Document, id: string) {
  const faces = registered.get(doc)?.get(id);
  if (!faces) return;
  for (const f of faces) doc.fonts.delete(f);
  registered.get(doc)!.delete(id);
}

/** 앱 시작 시: 저장된 글꼴을 모두 불러와 등록 */
export async function initFonts(doc: Document = document) {
  try {
    const recs = await listUserFonts();
    await Promise.all(recs.map((r) => registerRecord(doc, r)));
    setUserFonts(recs.map(strip));
    useFonts.setState({ ready: true });
  } catch {
    useFonts.setState({ ready: true });
  }
}

/** 다른 문서(청중 화면 창)에도 사용자 글꼴·웹 글꼴 등록 */
export async function registerFontsIn(doc: Document) {
  const recs = await listUserFonts().catch(() => [] as UserFontRecord[]);
  await Promise.all(recs.map((r) => registerRecord(doc, r)));
}

const byFamily = (a: UserFontMeta, b: UserFontMeta) => a.family.localeCompare(b.family) || a.weight - b.weight || Number(a.italic) - Number(b.italic);

/* ───────────── 추가 / 이름 바꾸기 / 삭제 ───────────── */

export interface AddResult {
  added: UserFontMeta[];
  replaced: number;
  errors: string[];
  warnings: string[];
}

export async function addFontFiles(files: File[]): Promise<AddResult> {
  const res: AddResult = { added: [], replaced: 0, errors: [], warnings: [] };
  const existing = await listUserFonts();
  for (const file of files) {
    try {
      if (file.size > MAX_FONT_BYTES) throw new Error(`${file.name}: 30MB보다 큰 글꼴 파일은 추가할 수 없습니다.`);
      const buf = await file.arrayBuffer();
      const info = await readFontInfo(buf, file.name);
      // 브라우저가 실제로 읽을 수 있는지 확인
      if (typeof FontFace !== 'undefined') {
        try {
          await new FontFace('__slidelab_probe__', buf.slice(0)).load();
        } catch {
          throw new Error(`${file.name}: 브라우저가 이 글꼴 파일을 읽지 못했습니다 (손상되었거나 지원하지 않는 형식).`);
        }
      }
      if (info.embedding === 'restricted') res.warnings.push(`${info.family}: 글꼴 제작사가 문서 포함을 제한한 글꼴입니다. 이 컴퓨터에서 편집·발표하는 데는 쓸 수 있지만, 파일과 함께 배포하려면 라이선스를 확인하세요.`);
      if (info.guessed) res.warnings.push(`${file.name}: 글꼴 이름을 파일 이름에서 추정했습니다(${info.family}). 다르면 글꼴 관리에서 이름을 고치세요.`);
      const same = existing.find((e) => e.family.toLowerCase() === info.family.toLowerCase() && e.weight === info.weight && e.italic === info.italic);
      const rec: UserFontRecord = {
        id: same?.id ?? newId(),
        family: info.family,
        aliases: info.localNames,
        weight: info.weight,
        italic: info.italic,
        fileName: file.name,
        format: info.format,
        size: file.size,
        embedding: info.embedding,
        addedAt: Date.now(),
        data: new Blob([buf], { type: file.type || 'font/' + (info.format === 'woff2' ? 'woff2' : info.format === 'woff' ? 'woff' : 'ttf') }),
      };
      await putUserFont(rec);
      await registerRecord(document, rec);
      if (same) res.replaced++;
      else existing.push(rec);
      res.added.push(strip(rec));
    } catch (e) {
      res.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  await refreshList();
  return res;
}

async function refreshList() {
  setUserFonts((await listUserFonts()).map(strip));
}

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
function setUserFonts(list: UserFontMeta[]) {
  koreanUserFamilies.clear();
  for (const f of list) if (f.aliases.some((a) => HANGUL.test(a)) || HANGUL.test(f.family)) koreanUserFamilies.add(f.family.toLowerCase());
  useFonts.setState({ userFonts: list.sort(byFamily) });
}

/** 글꼴 패밀리 이름 바꾸기 (같은 패밀리의 모든 스타일) */
export async function renameFamily(oldFamily: string, newFamily: string) {
  const name = newFamily.trim();
  if (!name || name === oldFamily) return;
  for (const r of await listUserFonts()) {
    if (r.family !== oldFamily) continue;
    const next = { ...r, family: name, aliases: [...new Set([...r.aliases, oldFamily])].filter((a) => a !== name) };
    await putUserFont(next);
    await registerRecord(document, next);
  }
  await refreshList();
}

export async function removeFonts(ids: string[]) {
  for (const id of ids) {
    await deleteUserFont(id);
    unregisterRecord(document, id);
  }
  await refreshList();
}

/** 사용자 글꼴 파일 (내보내기용) */
export async function userFontRecords(families: string[]): Promise<UserFontRecord[]> {
  const want = new Set(families.map((f) => f.toLowerCase()));
  return (await listUserFonts()).filter((r) => want.has(r.family.toLowerCase()) || r.aliases.some((a) => want.has(a.toLowerCase())));
}

/** .slidelab 파일에 들어 있던 글꼴을 라이브러리에 추가 (같은 글꼴이 있으면 건너뜀) */
export async function importEmbeddedFonts(items: { family: string; aliases?: string[]; weight: number; italic: boolean; fileName: string; format: string; data: Blob }[]): Promise<number> {
  const existing = await listUserFonts();
  let n = 0;
  for (const it of items) {
    if (existing.some((e) => e.family.toLowerCase() === it.family.toLowerCase() && e.weight === it.weight && e.italic === it.italic)) continue;
    const rec: UserFontRecord = { id: newId(), family: it.family, aliases: it.aliases ?? [], weight: it.weight, italic: it.italic, fileName: it.fileName, format: it.format, size: it.data.size, embedding: 'unknown', addedAt: Date.now(), data: it.data };
    await putUserFont(rec);
    await registerRecord(document, rec);
    n++;
  }
  if (n) await refreshList();
  return n;
}

/* ───────────── 웹 글꼴 ───────────── */

const linkFor = new WeakMap<Document, Map<string, Promise<void>>>();

function addStylesheet(doc: Document, href: string, key: string): Promise<void> {
  let m = linkFor.get(doc);
  if (!m) linkFor.set(doc, (m = new Map()));
  const cached = m.get(key);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.webfont = key;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('웹 글꼴을 불러오지 못했습니다.'));
    doc.head.appendChild(link);
  });
  m.set(key, p);
  p.catch(() => m!.delete(key));
  return p;
}

/** 웹 글꼴 쓰기: 스타일시트를 넣고 글꼴 파일까지 받아 둠 */
export async function ensureWebFont(family: string, doc: Document = document): Promise<boolean> {
  if (!isWebFont(family) || !useFonts.getState().webFonts) return false;
  const st = useFonts.getState();
  if (doc === document && st.web[family] === 'ready') return true;
  if (doc === document) useFonts.setState({ web: { ...st.web, [family]: 'loading' } });
  try {
    await addStylesheet(doc, webFontCssUrl(family), family);
    await Promise.all([doc.fonts.load(`16px "${family}"`, '가A'), doc.fonts.load(`bold 16px "${family}"`, '가A')]);
    if (doc === document) useFonts.setState({ web: { ...useFonts.getState().web, [family]: 'ready' } });
    return true;
  } catch {
    if (doc === document) useFonts.setState({ web: { ...useFonts.getState().web, [family]: 'error' } });
    return false;
  }
}

/** 목록 미리 보기: 이름 글자만 담은 작은 파일 */
export function previewWebFont(family: string, label: string) {
  if (!useFonts.getState().webFonts) return;
  void addStylesheet(document, webFontCssUrl(family, `${family}${label}`), `preview:${family}`).catch(() => {});
}

/* ───────────── 이 컴퓨터의 글꼴 ───────────── */

let canvas: CanvasRenderingContext2D | null | undefined;
const SAMPLE = 'mmmmmmmmmmlli가나다WWW@#';

/** 글꼴이 설치됐는지: 기본 글꼴과 글자 폭을 비교 (사용자/웹 글꼴은 제외하고 판단) */
export function isFontInstalled(family: string): boolean | undefined {
  const st = useFonts.getState();
  if (family in st.installed) return st.installed[family];
  if (canvas === undefined) {
    try {
      canvas = document.createElement('canvas').getContext('2d');
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return undefined;
  const width = (font: string) => {
    canvas!.font = `72px ${font}`;
    return canvas!.measureText(SAMPLE).width;
  };
  const bases = ['monospace', 'serif', 'sans-serif'];
  const ok = bases.some((b) => width(`"${family}", ${b}`) !== width(b));
  useFonts.setState({ installed: { ...useFonts.getState().installed, [family]: ok } });
  return ok;
}

/** Local Font Access API (Chromium): 이 컴퓨터의 글꼴 목록 (사용자 허락 필요) */
export async function queryLocalFonts(): Promise<string[]> {
  const q = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) throw new Error('이 브라우저는 컴퓨터의 글꼴 목록 읽기를 지원하지 않습니다 (Chrome·Edge에서 사용 가능).');
  const fonts = await q();
  const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  useFonts.setState({ local: families });
  savePrefs();
  return families;
}

/* ───────────── 상태 ───────────── */

export type FontSource = 'user' | 'web' | 'system' | 'local' | 'unknown';

/** 글꼴을 이 브라우저에서 쓸 수 있는지와 출처 */
export function fontStatus(family: string): { source: FontSource; available: boolean | undefined } {
  const st = useFonts.getState();
  const low = family.toLowerCase();
  if (st.userFonts.some((f) => f.family.toLowerCase() === low || f.aliases.some((a) => a.toLowerCase() === low))) return { source: 'user', available: true };
  if (isWebFont(family)) return { source: 'web', available: st.webFonts && st.web[WEB_FONTS.find((w) => w.family.toLowerCase() === low)!.family] !== 'error' };
  if (st.local.some((f) => f.toLowerCase() === low)) return { source: 'local', available: true };
  const sys = SYSTEM_FONTS.some((f) => f.family.toLowerCase() === low);
  return { source: sys ? 'system' : 'unknown', available: isFontInstalled(family) };
}
