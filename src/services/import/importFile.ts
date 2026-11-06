/**
 * 파일 열기: .pptx → 편집 가능한 문서 (원본 패키지는 IndexedDB에 보관)
 */
import { useEditor } from '../../core/store/editorStore';
import { saveBlob, savePackage } from '../storage/db';
import { saveNow } from '../storage/autosave';
import { importNative } from '../storage/files';
import type { ImportReport } from './report';
import { newId } from '../../utils/id';

type ReportListener = (r: ImportReport | null) => void;
let reportListener: ReportListener | null = null;
export const onImportReport = (fn: ReportListener) => {
  reportListener = fn;
  return () => {
    if (reportListener === fn) reportListener = null;
  };
};

const isPptx = (f: File) => /\.pptx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const isNative = (f: File) => /\.slidelab$/i.test(f.name);
export const isOpenableFile = (f: File) => isPptx(f) || isNative(f);

export async function openPresentationFile(file: File): Promise<boolean> {
  const s = useEditor.getState();
  if (/\.(ppt|pps|pot)$/i.test(file.name)) {
    s.toast('이전 형식(.ppt)은 지원하지 않습니다. PowerPoint에서 .pptx로 저장한 뒤 여세요.', 'warning');
    return false;
  }
  if (!isOpenableFile(file)) {
    s.toast('.pptx 또는 .slidelab 파일만 열 수 있습니다.', 'warning');
    return false;
  }
  // 현재 문서 먼저 저장
  if (s.saveStatus !== 'saved') await saveNow();
  try {
    if (isNative(file)) {
      const doc = await importNative(file);
      useEditor.getState().loadDocument(doc);
      await saveNow();
      return true;
    }
    const progress = s.toast(`'${file.name}' 가져오는 중…`);
    const { importPptx } = await import('./pptxImport');
    const buf = await file.arrayBuffer();
    const { doc, report, blobs, fonts } = await importPptx(buf, file.name);
    for (const b of blobs) await saveBlob(b.key, new Blob([b.data as BlobPart], { type: b.mime }));
    if (fonts.length) {
      // 포함 글꼴 → 내 글꼴 (같은 이름·스타일이 이미 있으면 건너뜀)
      const { importEmbeddedFonts } = await import('../fonts/library');
      await importEmbeddedFonts(fonts.map((f) => ({ family: f.family, aliases: f.aliases, weight: f.weight, italic: f.italic, fileName: `${f.typeface}-${f.weight}${f.italic ? 'i' : ''}.ttf`, format: 'truetype', data: new Blob([f.ttf as BlobPart], { type: 'font/ttf' }) })), 'pptx');
    }
    const packageId = newId();
    await savePackage(packageId, new Blob([buf], { type: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    doc.source = { packageId, fileName: file.name, importedAt: Date.now() };
    useEditor.getState().loadDocument(doc);
    useEditor.setState({ saveStatus: 'unsaved', backstageOpen: false });
    await saveNow();
    useEditor.getState().dismissToast(progress);
    reportListener?.(report);
    return true;
  } catch (e) {
    console.error(e);
    useEditor.getState().toast(`파일을 열 수 없습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

/** PWA 파일 처리기(launchQueue)로 열린 파일 */
export function registerLaunchQueue() {
  const lq = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
  lq?.setConsumer(async (params) => {
    for (const h of params.files ?? []) {
      const f = await h.getFile();
      await openPresentationFile(f);
      break;
    }
  });
}
