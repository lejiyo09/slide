/**
 * 편집기 전역 상태 (zustand)
 * - doc: 현재 프레젠테이션 (immer로 불변 갱신)
 * - history: 실행 취소/다시 실행 스냅샷
 * - 선택, 확대율, 보기 모드 등 UI 상태
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { produce, freeze } from 'immer';
import type { Presentation, ShapeKind, Slide, SlideObject } from '../../types/model';
import { createPresentation } from '../document/factory';
import { findSlide } from '../document/query';
import * as H from '../history/history';
import type { CopiedFormat } from '../commands/commands';

export type InsertTool =
  | { kind: 'text' }
  | { kind: 'shape'; shape: ShapeKind }
  | { kind: 'line'; arrow: boolean }
  | null;

export type ViewMode = 'normal' | 'sorter';

export type Clipboard =
  | { kind: 'objects'; objects: SlideObject[]; assets: Presentation['assets']; pasteCount: number }
  | { kind: 'slides'; slides: Slide[]; assets: Presentation['assets'] }
  | null;

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface EditorState {
  doc: Presentation;
  history: H.HistoryState<Presentation>;
  /** 드래그 등 연속 동작 중 시작 시점 문서 (끝날 때 한 번만 기록) */
  gestureBase: Presentation | null;
  gestureLabel: string;

  activeSlideId: string;
  selectedSlideIds: string[];
  selectedIds: string[];
  editingTextId: string | null;
  /** 이미지 자르기 모드인 객체 */
  cropId: string | null;
  /** 키보드 단축키 대상 영역 */
  focusArea: 'canvas' | 'slides';

  zoom: number;
  fitMode: boolean;
  viewMode: ViewMode;
  showNotes: boolean;
  notesHeight: number;
  showProperties: boolean;
  showGrid: boolean;
  showGuides: boolean;
  snapEnabled: boolean;
  darkMode: boolean;
  insertTool: InsertTool;
  formatPainter: { format: CopiedFormat; sticky: boolean } | null;
  clipboard: Clipboard;
  slideshow: { startIndex: number } | null;
  backstageOpen: boolean;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  lastSavedAt: number | null;
  toasts: Toast[];
  /** 0 이상이면 텍스트 편집기 등 하위 컴포넌트가 다시 그려져야 함 */
  revision: number;

  // ── 문서 변경 ──
  commit: (label: string, recipe: (draft: Presentation) => void) => void;
  beginGesture: (label: string) => void;
  updateGesture: (recipe: (draft: Presentation) => void) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadDocument: (doc: Presentation) => void;
  newDocument: () => void;

  // ── 선택 ──
  setActiveSlide: (id: string, opts?: { additive?: boolean; range?: boolean }) => void;
  setSelectedSlides: (ids: string[]) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setEditingText: (id: string | null) => void;

  // ── UI ──
  set: (patch: Partial<EditorState>) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

const initialDoc = freeze(createPresentation(), true);

const loadBool = (key: string, def: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
};

export const useEditor = create<EditorState>()((set, get) => ({
  doc: initialDoc,
  history: H.emptyHistory(),
  gestureBase: null,
  gestureLabel: '',

  activeSlideId: initialDoc.slides[0].id,
  selectedSlideIds: [initialDoc.slides[0].id],
  selectedIds: [],
  editingTextId: null,
  cropId: null,
  focusArea: 'canvas',

  zoom: 0.6,
  fitMode: true,
  viewMode: 'normal',
  showNotes: loadBool('slidelab.showNotes', true),
  notesHeight: 96,
  showProperties: loadBool('slidelab.showProperties', true),
  showGrid: false,
  showGuides: true,
  snapEnabled: true,
  darkMode: loadBool('slidelab.darkMode', false),
  insertTool: null,
  formatPainter: null,
  clipboard: null,
  slideshow: null,
  backstageOpen: false,
  saveStatus: 'saved',
  lastSavedAt: null,
  toasts: [],
  revision: 0,

  commit: (label, recipe) => {
    const { doc, history, gestureBase } = get();
    const next = produce(doc, (d) => {
      recipe(d);
      d.updatedAt = Date.now();
    });
    if (next === doc) return;
    // 제스처 진행 중이면 기록은 제스처 종료 때 한 번만
    set({
      doc: next,
      history: gestureBase ? history : H.record(history, doc, label),
      saveStatus: 'unsaved',
    });
    reconcileSelection();
  },

  beginGesture: (label) => {
    if (get().gestureBase) return;
    set({ gestureBase: get().doc, gestureLabel: label });
  },
  updateGesture: (recipe) => {
    const { doc } = get();
    const next = produce(doc, recipe);
    if (next !== doc) set({ doc: next, saveStatus: 'unsaved' });
  },
  endGesture: () => {
    const { gestureBase, gestureLabel, doc, history } = get();
    if (!gestureBase) return;
    if (gestureBase !== doc) {
      const stamped = produce(doc, (d) => {
        d.updatedAt = Date.now();
      });
      set({ doc: stamped, history: H.record(history, gestureBase, gestureLabel), gestureBase: null });
    } else set({ gestureBase: null });
  },
  cancelGesture: () => {
    const { gestureBase } = get();
    if (gestureBase) set({ doc: gestureBase, gestureBase: null });
  },

  undo: () => {
    const s = get();
    if (s.editingTextId) s.setEditingText(null);
    const r = H.undo(get().history, get().doc);
    if (!r) return;
    set({ doc: r.state, history: r.history, saveStatus: 'unsaved', revision: s.revision + 1 });
    reconcileSelection();
  },
  redo: () => {
    const s = get();
    if (s.editingTextId) s.setEditingText(null);
    const r = H.redo(get().history, get().doc);
    if (!r) return;
    set({ doc: r.state, history: r.history, saveStatus: 'unsaved', revision: s.revision + 1 });
    reconcileSelection();
  },

  loadDocument: (doc) => {
    const frozen = freeze(doc, true);
    set({
      doc: frozen,
      history: H.emptyHistory(),
      gestureBase: null,
      activeSlideId: frozen.slides[0].id,
      selectedSlideIds: [frozen.slides[0].id],
      selectedIds: [],
      editingTextId: null,
      saveStatus: 'saved',
      revision: get().revision + 1,
    });
  },
  newDocument: () => {
    get().loadDocument(createPresentation());
    set({ saveStatus: 'unsaved' });
  },

  setActiveSlide: (id, opts) => {
    const { doc, selectedSlideIds, activeSlideId } = get();
    let sel = [id];
    if (opts?.additive) {
      sel = selectedSlideIds.includes(id) ? selectedSlideIds.filter((x) => x !== id) : [...selectedSlideIds, id];
      if (!sel.length) sel = [id];
    } else if (opts?.range) {
      const a = doc.slides.findIndex((s) => s.id === activeSlideId);
      const b = doc.slides.findIndex((s) => s.id === id);
      const [from, to] = a < b ? [a, b] : [b, a];
      sel = doc.slides.slice(from, to + 1).map((s) => s.id);
    }
    set({
      activeSlideId: id,
      selectedSlideIds: sel,
      selectedIds: id === activeSlideId ? get().selectedIds : [],
      editingTextId: null,
    });
  },
  setSelectedSlides: (ids) => set({ selectedSlideIds: ids }),
  select: (ids) => set({ cropId: ids.includes(get().cropId ?? '') ? get().cropId : null, selectedIds: ids, editingTextId: get().editingTextId && ids.includes(get().editingTextId!) ? get().editingTextId : null }),
  toggleSelect: (id) => {
    const cur = get().selectedIds;
    set({ selectedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], editingTextId: null });
  },
  setEditingText: (id) => set({ editingTextId: id, selectedIds: id ? [id] : get().selectedIds }),

  set: (patch) => {
    if (Object.keys(patch).length) set(patch);
  },
  toast: (message, tone = 'info') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), tone === 'error' || tone === 'warning' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** 문서 변경 후 존재하지 않는 슬라이드/객체 선택을 정리 */
function reconcileSelection() {
  const s = useEditor.getState();
  const slide = findSlide(s.doc, s.activeSlideId) ?? s.doc.slides[0];
  const ids = new Set(slide.objects.map((o) => o.id));
  const slideIds = new Set(s.doc.slides.map((x) => x.id));
  const selectedIds = s.selectedIds.filter((id) => ids.has(id));
  const selectedSlideIds = s.selectedSlideIds.filter((id) => slideIds.has(id));
  const patch: Partial<EditorState> = {};
  if (slide.id !== s.activeSlideId) patch.activeSlideId = slide.id;
  if (selectedIds.length !== s.selectedIds.length) patch.selectedIds = selectedIds;
  if (selectedSlideIds.length !== s.selectedSlideIds.length || !selectedSlideIds.length)
    patch.selectedSlideIds = selectedSlideIds.length ? selectedSlideIds : [slide.id];
  if (s.editingTextId && !ids.has(s.editingTextId)) patch.editingTextId = null;
  if (Object.keys(patch).length) useEditor.setState(patch);
}

/* ───── 편의 선택자 ───── */
export const useActiveSlide = () => useEditor((s) => findSlide(s.doc, s.activeSlideId) ?? s.doc.slides[0]);

export const getActiveSlide = () => {
  const s = useEditor.getState();
  return findSlide(s.doc, s.activeSlideId) ?? s.doc.slides[0];
};

export const getSelectedObjects = (): SlideObject[] => {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  return slide.objects.filter((o) => s.selectedIds.includes(o.id));
};

const EMPTY: SlideObject[] = [];
/** 선택된 개체 목록 (얕은 비교로 불필요한 재렌더링/무한 루프 방지) */
export const useSelectedObjects = (): SlideObject[] =>
  useEditor(
    useShallow((s) => {
      if (!s.selectedIds.length) return EMPTY;
      const slide = findSlide(s.doc, s.activeSlideId);
      return slide ? slide.objects.filter((o) => s.selectedIds.includes(o.id)) : EMPTY;
    }),
  );
