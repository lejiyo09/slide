/** 슬라이드 마스터 보기 / 레이아웃 관리 / 테마·템플릿 적용 */
import { useEditor } from '../store/editorStore';
import type { MasterSlide, PlaceholderType, Presentation, Theme, ThemeColors } from '../../types/model';
import { createBuiltinLayout, PH_PROMPTS } from '../document/masters';
import { createTextBox, paragraph } from '../document/factory';
import { newId } from '../../utils/id';
import { deepClone } from '../../utils/clone';
import { findSlide, isMasterSlide } from '../document/query';
import { tokenizeLegacy } from '../../utils/themeColor';
import type { DesignTemplate } from '../../themes/templates';

const st = () => useEditor.getState();
let returnSlideId: string | null = null;

export function openMasterView() {
  const s = st();
  if (s.masterView) return;
  s.setEditingText(null);
  returnSlideId = s.activeSlideId;
  const slide = findSlide(s.doc, s.activeSlideId);
  const target = slide && !isMasterSlide(slide) && s.doc.layouts?.[slide.layout] ? slide.layout : s.doc.master?.id ?? 'master';
  useEditor.setState({ masterView: true, viewMode: 'normal', activeSlideId: target, selectedSlideIds: [target], selectedIds: [], focusArea: 'slides' });
}

export function closeMasterView() {
  const s = st();
  if (!s.masterView) return;
  s.setEditingText(null);
  const back = returnSlideId && s.doc.slides.some((x) => x.id === returnSlideId) ? returnSlideId : s.doc.slides[0].id;
  useEditor.setState({ masterView: false, activeSlideId: back, selectedSlideIds: [back], selectedIds: [] });
}

const usedBy = (doc: Presentation, layoutId: string) => doc.slides.filter((x) => x.layout === layoutId).length;

export function insertLayout() {
  const s = st();
  const id = `layout-${newId()}`;
  const base = createBuiltinLayout('titleOnly', s.doc.size);
  const lay: MasterSlide = { ...base, id, name: '사용자 지정 레이아웃' };
  s.commit('레이아웃 삽입', (d) => {
    d.layouts![id] = lay;
    const order = d.layoutOrder ?? Object.keys(d.layouts!);
    const at = order.indexOf(s.activeSlideId);
    order.splice(at >= 0 ? at + 1 : order.length, 0, id);
    d.layoutOrder = order;
  });
  useEditor.setState({ activeSlideId: id, selectedSlideIds: [id], selectedIds: [] });
}

export function duplicateLayout() {
  const s = st();
  const src = s.doc.layouts?.[s.activeSlideId];
  if (!src) return;
  const id = `layout-${newId()}`;
  const copy = deepClone(src);
  copy.id = id;
  copy.name = `${src.name} 복사본`;
  copy.objects.forEach((o) => (o.id = newId()));
  s.commit('레이아웃 복제', (d) => {
    d.layouts![id] = copy;
    const order = d.layoutOrder!;
    order.splice(order.indexOf(src.id) + 1, 0, id);
  });
  useEditor.setState({ activeSlideId: id, selectedSlideIds: [id], selectedIds: [] });
}

export function deleteLayout() {
  const s = st();
  const id = s.activeSlideId;
  if (!s.doc.layouts?.[id]) return s.toast('슬라이드 마스터는 삭제할 수 없습니다.');
  const n = usedBy(s.doc, id);
  if (n > 0) return s.toast(`이 레이아웃을 사용하는 슬라이드가 ${n}장 있어 삭제할 수 없습니다.`, 'warning');
  if (Object.keys(s.doc.layouts).length <= 1) return;
  const order = s.doc.layoutOrder ?? Object.keys(s.doc.layouts);
  const next = order[Math.max(0, order.indexOf(id) - 1)] === id ? order[1] : order[Math.max(0, order.indexOf(id) - 1)];
  s.commit('레이아웃 삭제', (d) => {
    delete d.layouts![id];
    d.layoutOrder = d.layoutOrder?.filter((x) => x !== id);
  });
  useEditor.setState({ activeSlideId: next, selectedSlideIds: [next], selectedIds: [] });
}

export function renameMasterSlide(id: string, name: string) {
  st().commit('이름 바꾸기', (d) => {
    const target = d.master?.id === id ? d.master : d.layouts?.[id];
    if (target) target.name = name;
  });
}

export function toggleHideBackgroundGraphics() {
  const s = st();
  const lay = s.doc.layouts?.[s.activeSlideId];
  const slide = s.doc.slides.find((x) => x.id === s.activeSlideId);
  s.commit('배경 그래픽 숨기기', (d) => {
    if (lay) d.layouts![lay.id].showMasterShapes = lay.showMasterShapes === false ? undefined : false;
    else if (slide) {
      const t = d.slides.find((x) => x.id === slide.id)!;
      t.showMasterShapes = slide.showMasterShapes === false ? undefined : false;
    }
  });
}

/** 현재 마스터/레이아웃에 개체 틀 삽입 */
export function insertPlaceholder(type: PlaceholderType) {
  const s = st();
  const target = findSlide(s.doc, s.activeSlideId);
  if (!target || !isMasterSlide(target)) return;
  const { width: W, height: H } = s.doc.size;
  const boxes: Record<string, [number, number, number, number]> = {
    title: [W * 0.07, H * 0.06, W * 0.86, H * 0.16],
    body: [W * 0.07, H * 0.26, W * 0.86, H * 0.6],
    dt: [W * 0.07, H * 0.92, W * 0.2, H * 0.06],
    ftr: [W * 0.33, H * 0.92, W * 0.34, H * 0.06],
    sldNum: [W * 0.73, H * 0.92, W * 0.2, H * 0.06],
  };
  const [x, y, w, h] = boxes[type] ?? boxes.body;
  const t = createTextBox({ x, y, width: w, height: h, name: PH_PROMPTS[type] });
  const idx = type === 'body' ? Math.max(0, ...target.objects.map((o) => (o.type === 'text' && o.ph?.type === 'body' ? o.ph.idx ?? 1 : 0))) + 1 : undefined;
  t.ph = { type, ...(idx ? { idx } : {}) };
  t.placeholder = PH_PROMPTS[type];
  const title = type === 'title';
  t.text.paragraphs = [
    paragraph(title ? '마스터 제목 스타일 편집' : type === 'body' ? '마스터 텍스트 스타일 편집' : PH_PROMPTS[type], {
      fontFamily: title ? '@heading' : '@body',
      fontSize: title ? 40 : type === 'body' ? 24 : 12,
      color: type === 'body' || title ? '@dark1' : '@dark1^0.45',
    }, type === 'body' ? { bullet: 'bullet' } : {}),
  ];
  t.text.vAlign = title ? 'middle' : 'top';
  s.commit('개체 틀 삽입', (d) => {
    const tgt = d.master?.id === target.id ? d.master : d.layouts![target.id];
    tgt!.objects.push(t);
  });
  st().select([t.id]);
}

/* ───────────── 테마 ───────────── */

/** 현재 테마와 같은 고정 색/글꼴을 토큰으로 (테마 변경을 따라가도록) */
function tokenize(d: Presentation) {
  const theme = d.theme as Theme;
  d.slides = tokenizeLegacy(deepClone(d.slides), theme);
  if (d.master) d.master = tokenizeLegacy(deepClone(d.master), theme);
  if (d.layouts) d.layouts = tokenizeLegacy(deepClone(d.layouts), theme);
}

export function applyThemeColors(colors: ThemeColors, name?: string) {
  st().commit('테마 색', (d) => {
    tokenize(d as Presentation);
    d.theme.colors = { ...colors };
    if (name) d.theme.name = `${d.theme.name.split(' · ')[0]} · ${name}`;
  });
}

export function applyThemeFonts(heading: string, body: string) {
  st().commit('테마 글꼴', (d) => {
    tokenize(d as Presentation);
    d.theme.fonts = { heading, body };
  });
}

export function applyFullTheme(theme: Theme) {
  st().commit('테마 적용', (d) => {
    tokenize(d as Presentation);
    const old = d.theme;
    d.theme = deepClone(theme);
    // 테마 배경을 그대로 쓰던 경우만 따라감 (슬라이드별 배경은 유지)
    void old;
  });
}

/** 디자인 템플릿 적용: 테마 + 마스터 디자인 + 레이아웃 배경/디자인 */
export function applyTemplate(t: DesignTemplate) {
  const s = st();
  s.commit(`템플릿: ${t.name}`, (d) => applyTemplateDraft(d as Presentation, t));
}

/** 템플릿 적용 (draft 대상 — 미리 보기·AI 디자인 아이디어에서도 사용) */
export function applyTemplateDraft(d: Presentation, t: DesignTemplate) {
  const design = t.build(d.size);
  tokenize(d);
  d.theme = deepClone(t.theme);
  if (d.master) {
    const phs = d.master.objects.filter((o) => o.type === 'text' && o.ph);
    d.master.objects = [...design.master, ...phs];
    d.master.background = design.masterBackground ? { fill: design.masterBackground } : null;
    // 마스터 개체 틀 서식(제목 색 등)
    for (const o of d.master.objects) {
      if (o.type !== 'text' || !o.ph) continue;
      const style = design.placeholderStyle?.[o.ph.type];
      if (style) for (const p of o.text.paragraphs) for (const r of p.runs) Object.assign(r, style);
    }
  }
  for (const [lid, lay] of Object.entries(design.layouts ?? {})) {
    const target = d.layouts?.[lid];
    if (!target) continue;
    const phs = target.objects.filter((o) => o.type === 'text' && o.ph);
    target.objects = [...(lay.objects ?? []), ...phs];
    target.background = lay.background ? { fill: lay.background } : null;
    target.showMasterShapes = lay.hideMaster ? false : undefined;
    for (const o of target.objects) {
      if (o.type !== 'text' || !o.ph) continue;
      const style = lay.placeholderStyle?.[o.ph.type];
      if (style) for (const p of o.text.paragraphs) for (const r of p.runs) Object.assign(r, style);
    }
  }
}

/** 현재 문서의 디자인(테마+마스터+레이아웃)을 사용자 템플릿 데이터로 */
export function snapshotDesign(doc: Presentation) {
  return { theme: deepClone(doc.theme), master: deepClone(doc.master!), layouts: deepClone(doc.layouts!), layoutOrder: [...(doc.layoutOrder ?? [])] };
}

export function applyDesignSnapshot(snap: ReturnType<typeof snapshotDesign>, name: string) {
  st().commit(`템플릿: ${name}`, (d) => {
    d.theme = deepClone(snap.theme);
    d.master = deepClone(snap.master);
    // 기존 레이아웃 ID를 유지하면서 디자인 교체 (슬라이드 연결 유지)
    for (const [id, lay] of Object.entries(snap.layouts)) d.layouts![id] = deepClone(lay);
    for (const id of snap.layoutOrder) if (!d.layoutOrder!.includes(id)) d.layoutOrder!.push(id);
  });
}
