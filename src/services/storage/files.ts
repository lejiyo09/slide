/** 파일 입출력 도우미 */
import type { Asset, Presentation } from '../../types/model';
import { newId } from '../../utils/id';
import { getPackage, savePackage } from './db';

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

/** SlideLab 고유 형식 (.slidelab = JSON). 가져온 PPTX의 원본 패키지도 함께 포함해 보존 개체를 유지한다 */
export async function exportNative(doc: Presentation) {
  let sourcePackage: string | undefined;
  if (doc.source) {
    const pkg = await getPackage(doc.source.packageId);
    if (pkg) sourcePackage = await readAsDataUrl(pkg);
  }
  const blob = new Blob([JSON.stringify({ format: 'slidelab', version: 1, doc, sourcePackage })], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(doc.title)}.slidelab`);
}

export async function importNative(file: File): Promise<Presentation> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.format !== 'slidelab' || !data.doc?.slides) throw new Error('SlideLab 파일 형식이 아닙니다');
  const doc = data.doc as Presentation;
  doc.id = newId(); // 기존 프로젝트를 덮어쓰지 않도록 새 ID
  if (doc.source && typeof data.sourcePackage === 'string') {
    const packageId = newId();
    await savePackage(packageId, await (await fetch(data.sourcePackage)).blob());
    doc.source = { ...doc.source, packageId };
  }
  return doc;
}
