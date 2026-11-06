/**
 * 그림·PDF로 내보내기 (PowerPoint: 파일 › 내보내기 › 파일 형식 변경 / PDF/XPS 문서 만들기)
 * - 그림: PNG/JPEG, 현재 슬라이드 또는 모든 슬라이드(ZIP, "슬라이드1.png"…)
 * - PDF: 슬라이드마다 그림 한 페이지 (표준 1.5배·JPEG 92% / 최소 크기 1배·JPEG 75%), 숨긴 슬라이드 포함 여부
 */
import JSZip from 'jszip';
import type { Presentation } from '../../types/model';
import { canvasToBlob, SlideRasterizer } from './rasterize';
import { buildPdf } from './pdf';

export type Progress = (done: number, total: number) => void;

export interface ImageExportOptions {
  format: 'png' | 'jpeg';
  /** 슬라이드 원본(px) 대비 배율 */
  scale: number;
  /** 내보낼 슬라이드 ID (순서대로) */
  slideIds: string[];
  onProgress?: Progress;
  signal?: AbortSignal;
}

const checkAbort = (s?: AbortSignal) => {
  if (s?.aborted) throw new DOMException('취소했습니다.', 'AbortError');
};

export async function renderSlideImages(doc: Presentation, opts: ImageExportOptions): Promise<{ name: string; blob: Blob }[]> {
  const r = new SlideRasterizer(doc);
  const out: { name: string; blob: Blob }[] = [];
  try {
    const slides = opts.slideIds.map((id) => doc.slides.find((s) => s.id === id)).filter((s) => !!s);
    for (let i = 0; i < slides.length; i++) {
      checkAbort(opts.signal);
      const s = slides[i];
      await r.render(s);
      const canvas = await r.capture({ scale: opts.scale });
      const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
      out.push({ name: `슬라이드${doc.slides.indexOf(s) + 1}.${opts.format === 'png' ? 'png' : 'jpg'}`, blob: await canvasToBlob(canvas, type, 0.92) });
      opts.onProgress?.(i + 1, slides.length);
    }
  } finally {
    r.destroy();
  }
  return out;
}

/** 그림 내보내기: 한 장이면 그 파일, 여러 장이면 ZIP */
export async function exportSlideImages(doc: Presentation, opts: ImageExportOptions): Promise<{ blob: Blob; fileName: string; count: number }> {
  const files = await renderSlideImages(doc, opts);
  const base = safeName(doc.title);
  if (files.length === 1) return { blob: files[0].blob, fileName: `${base}-${files[0].name}`, count: 1 };
  const zip = new JSZip();
  const dir = zip.folder(base)!;
  for (const f of files) dir.file(f.name, f.blob);
  return { blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), fileName: `${base}.zip`, count: files.length };
}

export interface PdfExportOptions {
  quality: 'standard' | 'minimum';
  includeHidden: boolean;
  onProgress?: Progress;
  signal?: AbortSignal;
}

export async function exportPdf(doc: Presentation, opts: PdfExportOptions): Promise<Blob> {
  const slides = doc.slides.filter((s) => opts.includeHidden || !s.hidden);
  if (!slides.length) throw new Error('내보낼 슬라이드가 없습니다 (모든 슬라이드가 숨겨져 있음).');
  const scale = opts.quality === 'standard' ? 1.5 : 1;
  const q = opts.quality === 'standard' ? 0.92 : 0.75;
  const r = new SlideRasterizer(doc);
  const pages = [];
  try {
    for (let i = 0; i < slides.length; i++) {
      checkAbort(opts.signal);
      await r.render(slides[i]);
      const canvas = await r.capture({ scale });
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', q)).arrayBuffer());
      // 1px = 0.75pt (96dpi 기준) → 1280×720px 슬라이드 = 960×540pt (PowerPoint 16:9와 같음)
      pages.push({ width: doc.size.width * 0.75, height: doc.size.height * 0.75, jpeg, pixelWidth: canvas.width, pixelHeight: canvas.height });
      opts.onProgress?.(i + 1, slides.length);
    }
  } finally {
    r.destroy();
  }
  return new Blob([buildPdf(pages, { title: doc.title }) as BlobPart], { type: 'application/pdf' });
}

export const safeName = (s: string) => (s || '프레젠테이션').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || '프레젠테이션';
