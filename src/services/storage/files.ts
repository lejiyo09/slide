/** 파일 입출력 도우미 */
import type { Asset, Presentation } from '../../types/model';
import { newId } from '../../utils/id';
import { getBlob, getPackage, saveBlob, savePackage } from './db';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 200 });
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'));
    img.src = src;
  });
}

export async function fileToAsset(file: File): Promise<{ asset: Asset; width: number; height: number }> {
  const dataUrl = await readAsDataUrl(file);
  const { width, height } = await loadImageSize(dataUrl);
  return { asset: { id: newId(), mime: file.type || 'image/png', dataUrl, name: file.name }, width, height };
}

export const safeFileName = (title: string) => (title.trim() || 'presentation').replace(/[\\/:*?"<>|]+/g, '_');

/** .slidelab에 함께 넣는 사용자 글꼴 */
export interface NativeFont {
  family: string;
  aliases?: string[];
  weight: number;
  italic: boolean;
  fileName: string;
  format: string;
  dataUrl: string;
}

/**
 * SlideLab 고유 형식 (.slidelab = JSON). 가져온 PPTX의 원본 패키지도 함께 포함해 보존 개체를 유지한다.
 * 문서에 쓴 '내 글꼴'도 포함해 다른 브라우저에서 열어도 같은 모양이 되게 한다 (제작사가 포함을 제한한 글꼴은 제외).
 */
export async function exportNative(doc: Presentation): Promise<{ skippedFonts: string[] }> {
  let sourcePackage: string | undefined;
  if (doc.source) {
    const pkg = await getPackage(doc.source.packageId);
    if (pkg) sourcePackage = await readAsDataUrl(pkg);
  }
  const { fontsUsed } = await import('../fonts/docFonts');
  const { userFontRecords } = await import('../fonts/library');
  const recs = await userFontRecords([...fontsUsed(doc).keys()]);
  const skippedFonts = [...new Set(recs.filter((r) => r.embedding === 'restricted').map((r) => r.family))];
  const fonts: NativeFont[] = [];
  // 오프라인 보관한 웹 글꼴은 SlideLab 기본 웹 글꼴이라 받는 쪽에서도 쓸 수 있으므로 넣지 않음 (파일 크기 절약)
  for (const r of recs.filter((x) => x.embedding !== 'restricted' && x.origin !== 'web'))
    fonts.push({ family: r.family, aliases: r.aliases, weight: r.weight, italic: r.italic, fileName: r.fileName, format: r.format, dataUrl: await readAsDataUrl(r.data) });
  // IndexedDB에 따로 둔 큰 바이너리(동영상·오디오·내레이션·3D 모델)도 포함 — 다른 브라우저에서 열어도 그대로
  const blobs: Record<string, string> = {};
  for (const a of Object.values(doc.assets)) {
    if (!a.blobKey || blobs[a.blobKey]) continue;
    const b = await getBlob(a.blobKey);
    if (b) blobs[a.blobKey] = await readAsDataUrl(b);
  }
  const blob = new Blob([JSON.stringify({ format: 'slidelab', version: 1, doc, sourcePackage, ...(fonts.length ? { fonts } : {}), ...(Object.keys(blobs).length ? { blobs } : {}) })], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(doc.title)}.slidelab`);
  return { skippedFonts };
}

export async function importNative(file: File): Promise<Presentation> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.format !== 'slidelab' || !data.doc?.slides) throw new Error('SlideLab 파일 형식이 아닙니다');
  const doc = data.doc as Presentation;
  doc.id = newId(); // 기존 프로젝트를 덮어쓰지 않도록 새 ID
  // 함께 들어 있던 바이너리(동영상·오디오·3D 모델) 복원
  if (data.blobs && typeof data.blobs === 'object') {
    for (const [key, url] of Object.entries(data.blobs as Record<string, unknown>)) {
      if (typeof url !== 'string' || !url.startsWith('data:')) continue;
      await saveBlob(key, await (await fetch(url)).blob());
    }
  }
  if (doc.source && typeof data.sourcePackage === 'string') {
    const packageId = newId();
    await savePackage(packageId, await (await fetch(data.sourcePackage)).blob());
    doc.source = { ...doc.source, packageId };
  }
  // 함께 들어 있던 글꼴을 내 글꼴에 추가
  if (Array.isArray(data.fonts) && data.fonts.length) {
    const { importEmbeddedFonts } = await import('../fonts/library');
    const items = [];
    for (const f of data.fonts as NativeFont[]) {
      if (!f?.family || typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) continue;
      items.push({ ...f, data: await (await fetch(f.dataUrl)).blob() });
    }
    await importEmbeddedFonts(items);
  }
  return doc;
}
