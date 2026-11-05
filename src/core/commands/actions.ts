/**
 * 고수준 편집 동작: 리본, 단축키, 컨텍스트 메뉴가 공통으로 사용한다.
 * 각 동작은 store.commit()을 통해 하나의 실행 취소 단계로 기록된다.
 */
import { getActiveSlide, getSelectedObjects, useEditor } from '../store/editorStore';
import * as C from './commands';
import { cloneObject, cloneSlide, createImage, createLine, createShape, createTextBox, type SlideLayout } from '../document/factory';
import type { Asset, Presentation, ShapeKind, SlideObject } from '../../types/model';
import { fileToAsset, pickFiles } from '../../services/storage/files';
import * as M from './masterActions';
import { allMasterSlides } from '../document/masters';
import { deepClone } from '../../utils/clone';

const st = () => useEditor.getState();

/* ───── 슬라이드 ───── */

export function newSlide(layout?: SlideLayout | string) {
  const s = st();
  if (s.masterView) return M.insertLayout();
  const after = s.selectedSlideIds.length ? s.doc.slides.filter((x) => s.selectedSlideIds.includes(x.id)).pop()!.id : s.activeSlideId;
  let id = '';
  s.commit('새 슬라이드', (d) => void (id = C.addSlide(d, after, layout)));
  st().setActiveSlide(id);
}

export function duplicateSelectedSlides() {
  const s = st();
  if (s.masterView) return M.duplicateLayout();
  let ids: string[] = [];
  s.commit('슬라이드 복제', (d) => void (ids = C.duplicateSlides(d, s.selectedSlideIds)));
  if (ids.length) {
    useEditor.setState({ activeSlideId: ids[0], selectedSlideIds: ids, selectedIds: [] });
  }
}

export function deleteSelectedSlides() {
  const s = st();
  if (s.masterView) return M.deleteLayout();
  let next = '';
  s.commit('슬라이드 삭제', (d) => void (next = C.deleteSlides(d, s.selectedSlideIds)));
  useEditor.setState({ activeSlideId: next, selectedSlideIds: [next], selectedIds: [] });
}

export function moveSelectedSlides(delta: -1 | 1) {
  const s = st();
  if (s.masterView) return;
  s.commit('슬라이드 이동', (d) => C.moveSlidesBy(d, s.selectedSlideIds, delta));
}

export function toggleHideSlides() {
  const s = st();
  const slides = s.doc.slides.filter((x) => s.selectedSlideIds.includes(x.id));
  const hide = !slides.every((x) => x.hidden);
  s.commit(hide ? '슬라이드 숨기기' : '슬라이드 숨기기 취소', (d) => C.setSlideHidden(d, s.selectedSlideIds, hide));
}

export function goToSlide(delta: number) {
  const s = st();
  if (s.masterView) {
    const ids = allMasterSlides(s.doc).map((m) => m.id);
    const n = ids[Math.max(0, Math.min(ids.length - 1, ids.indexOf(s.activeSlideId) + delta))];
    if (n) s.setActiveSlide(n);
    return;
  }
  const i = s.doc.slides.findIndex((x) => x.id === s.activeSlideId);
  const n = s.doc.slides[Math.max(0, Math.min(s.doc.slides.length - 1, i + delta))];
  if (n) s.setActiveSlide(n.id);
}

/* ───── 삽입 ───── */

function insertObjects(objs: SlideObject[], label: string) {
  const s = st();
  const slide = getActiveSlide();
  s.commit(label, (d) => C.addObjects(d, slide.id, objs));
  st().select(objs.map((o) => o.id));
}

export function insertTextBoxAt(x: number, y: number, width?: number, editNow = true) {
  const tb = createTextBox({
    x,
    y,
    width: width ?? 300,
    height: 40,
    text: '',
    style: { fontFamily: '@body', fontSize: 18, color: '@dark1' },
  });
  tb.text.autoFit = 'resize';
  tb.text.wrap = width !== undefined;
  insertObjects([tb], '텍스트 상자 삽입');
  if (editNow) st().setEditingText(tb.id);
  return tb.id;
}

export function insertShapeAt(kind: ShapeKind, x: number, y: number, w?: number, h?: number) {
  const shape = createShape(kind, x, y, w, h, st().doc.theme);
  insertObjects([shape], '도형 삽입');
  return shape.id;
}

export function insertShapeCentered(kind: ShapeKind) {
  const { size } = st().doc;
  insertShapeAt(kind, size.width / 2 - 100, size.height / 2 - 70);
}

export function insertLine(x1: number, y1: number, x2: number, y2: number, arrow: boolean) {
  const line = createLine(0, 0, 0, 0, arrow ? 'triangle' : 'none', st().doc.theme);
  C.setLineEndpoints(line, x1, y1, x2, y2);
  insertObjects([line], arrow ? '화살표 삽입' : '선 삽입');
  return line.id;
}

export async function insertImageFiles(files: File[], at?: { x: number; y: number }) {
  const s = st();
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    if (files.length) s.toast('이미지 파일만 삽입할 수 있습니다.', 'warning');
    return;
  }
  const assets: Asset[] = [];
  const objs: SlideObject[] = [];
  for (const [i, f] of images.entries()) {
    try {
      const { asset, width, height } = await fileToAsset(f);
      assets.push(asset);
      const img = createImage(asset.id, width, height, s.doc.size);
      img.name = f.name.replace(/\.[^.]+$/, '') || '그림';
      if (at) {
        img.x = at.x - img.width / 2 + i * 20;
        img.y = at.y - img.height / 2 + i * 20;
      } else {
        img.x += i * 20;
        img.y += i * 20;
      }
      objs.push(img);
    } catch (e) {
      s.toast(`${f.name}: ${(e as Error).message}`, 'error');
    }
  }
  if (!objs.length) return;
  const slide = getActiveSlide();
  s.commit('그림 삽입', (d) => {
    for (const a of assets) d.assets[a.id] = a;
    C.addObjects(d, slide.id, objs);
  });
  st().select(objs.map((o) => o.id));
}

export async function pickAndInsertImage(svgOnly = false) {
  const files = await pickFiles(svgOnly ? 'image/svg+xml,.svg' : 'image/*', true);
  if (files.length) await insertImageFiles(files);
}

export async function replaceSelectedImage() {
  const obj = getSelectedObjects()[0];
  if (!obj || obj.type !== 'image') return;
  const [file] = await pickFiles('image/*');
  if (!file) return;
  const { asset, width, height } = await fileToAsset(file);
  const slide = getActiveSlide();
  st().commit('그림 바꾸기', (d) => {
    d.assets[asset.id] = asset;
    C.updateObjects(d, slide.id, [obj.id], (o) => {
      if (o.type !== 'image') return;
      o.assetId = asset.id;
      o.naturalWidth = width;
      o.naturalHeight = height;
      o.crop = { left: 0, top: 0, right: 0, bottom: 0 };
      o.height = o.width * (height / width);
    });
  });
}

/* ───── 선택 개체 ───── */

export function deleteSelection() {
  const s = st();
  if (!s.selectedIds.length) return;
  const slide = getActiveSlide();
  s.commit('삭제', (d) => C.deleteObjects(d, slide.id, s.selectedIds));
  st().select([]);
}

export function selectAll() {
  const slide = getActiveSlide();
  st().select(slide.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id));
}

export function duplicateSelection() {
  const s = st();
  if (!s.selectedIds.length) return;
  const slide = getActiveSlide();
  let ids: string[] = [];
  s.commit('복제', (d) => void (ids = C.duplicateObjects(d, slide.id, s.selectedIds)));
  st().select(ids);
}

/** 사용된 이미지 자산만 추출 */
function collectAssets(objs: SlideObject[], doc: Presentation): Presentation['assets'] {
  const out: Presentation['assets'] = {};
  const walk = (o: SlideObject) => {
    if (o.type === 'image' && doc.assets[o.assetId]) out[o.assetId] = doc.assets[o.assetId];
    if ((o.type === 'shape' || o.type === 'text') && o.fill.type === 'image' && doc.assets[o.fill.assetId]) out[o.fill.assetId] = doc.assets[o.fill.assetId];
    if (o.type === 'group') o.children.forEach(walk);
  };
  objs.forEach(walk);
  return out;
}

export function copySelection(cut = false) {
  const s = st();
  const objs = getSelectedObjects();
  if (!objs.length) return false;
  const assets = collectAssets(objs, s.doc);
  s.set({ clipboard: { kind: 'objects', objects: deepClone(objs), assets, pasteCount: 0 } });
  // 시스템 클립보드에는 텍스트만 (다른 앱 붙여넣기용)
  const text = objs
    .map((o) => (o.type === 'text' || o.type === 'shape' ? o.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : ''))
    .filter(Boolean)
    .join('\n');
  // 권한이 없으면 내부 클립보드만 사용
  navigator.clipboard?.writeText(text || `[SlideLab 개체 ${objs.length}개]`).catch(() => {});
  if (cut) {
    const slide = getActiveSlide();
    s.commit('잘라내기', (d) => C.deleteObjects(d, slide.id, objs.map((o) => o.id)));
    st().select([]);
  }
  return true;
}

export function copySlides() {
  const s = st();
  const slides = s.doc.slides.filter((x) => s.selectedSlideIds.includes(x.id));
  const assets = collectAssets(slides.flatMap((x) => x.objects), s.doc);
  s.set({ clipboard: { kind: 'slides', slides: deepClone(slides), assets } });
}

export function paste() {
  const s = st();
  const clip = s.clipboard;
  if (!clip) return false;
  if (clip.kind === 'objects') {
    const n = clip.pasteCount + 1;
    const copies = clip.objects.map((o) => cloneObject(o, 20 * n));
    const slide = getActiveSlide();
    s.commit('붙여넣기', (d) => {
      Object.assign(d.assets, clip.assets);
      C.addObjects(d, slide.id, copies);
    });
    useEditor.setState({ clipboard: { ...clip, pasteCount: n } });
    st().select(copies.map((c) => c.id));
  } else {
    const copies = clip.slides.map((x) => cloneSlide(x));
    const idx = s.doc.slides.findIndex((x) => x.id === s.activeSlideId);
    s.commit('슬라이드 붙여넣기', (d) => {
      Object.assign(d.assets, clip.assets);
      d.slides.splice(idx + 1, 0, ...copies);
    });
    useEditor.setState({ activeSlideId: copies[0].id, selectedSlideIds: copies.map((c) => c.id), selectedIds: [] });
  }
  return true;
}

export function reorder(op: C.ZOrderOp) {
  const s = st();
  if (!s.selectedIds.length) return;
  s.commit('순서 변경', (d) => C.reorderObjects(d, getActiveSlide().id, s.selectedIds, op));
}

export function align(op: C.AlignOp) {
  const s = st();
  if (!s.selectedIds.length) return;
  s.commit('맞춤', (d) => C.alignObjects(d, getActiveSlide().id, s.selectedIds, op));
}

export function group() {
  const s = st();
  if (s.selectedIds.length < 2) return;
  let gid: string | null = null;
  s.commit('그룹화', (d) => void (gid = C.groupObjects(d, getActiveSlide().id, s.selectedIds)));
  if (gid) st().select([gid]);
}

export function ungroup() {
  const s = st();
  const groups = getSelectedObjects().filter((o) => o.type === 'group');
  if (!groups.length) return;
  let ids: string[] = [];
  s.commit('그룹 해제', (d) => void (ids = C.ungroupObjects(d, getActiveSlide().id, groups.map((g) => g.id))));
  st().select(ids);
}

export function rotateSelection(deg: number) {
  const s = st();
  s.commit('회전', (d) =>
    C.updateObjects(d, getActiveSlide().id, s.selectedIds, (o) => {
      o.rotation = (((o.rotation + deg) % 360) + 360) % 360;
    }),
  );
}

export function flipSelection(axis: 'h' | 'v') {
  const s = st();
  s.commit('대칭', (d) =>
    C.updateObjects(d, getActiveSlide().id, s.selectedIds, (o) => {
      if (axis === 'h') o.flipH = !o.flipH;
      else o.flipV = !o.flipV;
    }),
  );
}

export function nudge(dx: number, dy: number) {
  const s = st();
  if (!s.selectedIds.length) return;
  s.commit('이동', (d) => C.nudgeObjects(d, getActiveSlide().id, s.selectedIds, dx, dy));
}

/* ───── 서식 복사 ───── */

export function startFormatPainter(sticky = false) {
  const s = st();
  if (s.formatPainter) return s.set({ formatPainter: null });
  const obj = getSelectedObjects()[0];
  if (!obj) return s.toast('서식을 복사할 개체를 먼저 선택하세요.');
  s.set({ formatPainter: { format: C.extractFormat(obj), sticky } });
}

export function applyFormatPainterTo(id: string) {
  const s = st();
  const fp = s.formatPainter;
  if (!fp) return;
  s.commit('서식 붙여넣기', (d) => C.updateObjects(d, getActiveSlide().id, [id], (o) => C.applyFormat(o, fp.format)));
  if (!fp.sticky) s.set({ formatPainter: null });
}

/* ───── 확대/축소 ───── */

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function zoomBy(dir: 1 | -1) {
  const s = st();
  const z = s.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((v) => v > z + 0.001) ?? 4 : [...ZOOM_STEPS].reverse().find((v) => v < z - 0.001) ?? 0.1;
  s.set({ zoom: next, fitMode: false });
}
