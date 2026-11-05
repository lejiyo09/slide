/**
 * 문서 명령: immer draft(Presentation)를 직접 수정하는 순수 함수 모음.
 * 스토어의 commit()을 통해 실행되며, 하나의 commit = 하나의 실행 취소 단계.
 * UI와 독립적이므로 단위 테스트가 가능하다.
 */
import { deepClone } from '../../utils/clone';
import type {
  Fill,
  Paragraph,
  Presentation,
  Slide,
  SlideObject,
  SlideSize,
  Stroke,
  TextBody,
  TextRunStyle,
  Theme,
} from '../../types/model';
import { cloneObject, cloneSlide, createGroup, createSlide, type SlideLayout } from '../document/factory';
import { findSlide, hasText } from '../document/query';
import { degToRad, rotatePoint } from '../../utils/geometry';
import { newId } from '../../utils/id';

type Doc = Presentation;

/* ───────────── 슬라이드 ───────────── */

export function addSlide(doc: Doc, afterId: string | null, layout: SlideLayout = 'titleContent'): string {
  const slide = createSlide(layout, doc.size, doc.theme);
  const idx = afterId ? doc.slides.findIndex((s) => s.id === afterId) : doc.slides.length - 1;
  // 가져온 PPTX: 기준 슬라이드의 마스터/레이아웃 디자인을 이어받음
  const ref = doc.slides[idx];
  if (ref && doc.layouts?.[ref.layout]) slide.layout = ref.layout;
  doc.slides.splice(idx + 1, 0, slide);
  return slide.id;
}

export function duplicateSlides(doc: Doc, ids: string[]): string[] {
  const created: string[] = [];
  // 뒤에서부터 처리해 인덱스가 밀리지 않도록
  const ordered = doc.slides.map((s, i) => ({ s, i })).filter(({ s }) => ids.includes(s.id));
  let offset = 0;
  const lastIdx = ordered.length ? ordered[ordered.length - 1].i : -1;
  for (const { s } of ordered) {
    const copy = cloneSlide(s as Slide);
    doc.slides.splice(lastIdx + 1 + offset, 0, copy);
    offset++;
    created.push(copy.id);
  }
  return created;
}

/** 슬라이드 삭제. 최소 1장은 남긴다. 삭제 후 선택할 슬라이드 ID 반환 */
export function deleteSlides(doc: Doc, ids: string[]): string {
  const firstIdx = doc.slides.findIndex((s) => ids.includes(s.id));
  const remaining = doc.slides.filter((s) => !ids.includes(s.id));
  if (remaining.length === 0) {
    const fresh = createSlide('blank', doc.size, doc.theme);
    doc.slides = [fresh];
    doc.sections = [];
    return fresh.id;
  }
  // 섹션 시작 슬라이드가 삭제되면 다음 슬라이드로 이동
  for (const sec of doc.sections) {
    if (ids.includes(sec.startSlideId)) {
      const i = doc.slides.findIndex((s) => s.id === sec.startSlideId);
      const next = doc.slides.slice(i + 1).find((s) => !ids.includes(s.id));
      sec.startSlideId = next ? next.id : '';
    }
  }
  doc.sections = doc.sections.filter((s) => s.startSlideId);
  dedupeSections(doc);
  doc.slides = remaining;
  return remaining[Math.min(Math.max(0, firstIdx), remaining.length - 1)].id;
}

/** 선택된 슬라이드들을 targetIndex 위치(이동 전 기준 삽입 지점)로 이동 */
export function moveSlides(doc: Doc, ids: string[], targetIndex: number) {
  const moving = doc.slides.filter((s) => ids.includes(s.id));
  if (!moving.length) return;
  const before = doc.slides.slice(0, targetIndex).filter((s) => !ids.includes(s.id)).length;
  const rest = doc.slides.filter((s) => !ids.includes(s.id));
  rest.splice(before, 0, ...moving);
  doc.slides = rest;
  dedupeSections(doc);
}

export function moveSlidesBy(doc: Doc, ids: string[], delta: -1 | 1) {
  const idxs = doc.slides.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
  if (!idxs.length) return;
  const target = delta < 0 ? Math.max(0, idxs[0] - 1) : Math.min(doc.slides.length, idxs[idxs.length - 1] + 2);
  moveSlides(doc, ids, target);
}

function dedupeSections(doc: Doc) {
  const seen = new Set<string>();
  doc.sections = doc.sections.filter((s) => (seen.has(s.startSlideId) ? false : (seen.add(s.startSlideId), true)));
}

export function setSlideHidden(doc: Doc, ids: string[], hidden: boolean) {
  for (const s of doc.slides) if (ids.includes(s.id)) s.hidden = hidden;
}

export function setNotes(doc: Doc, slideId: string, notes: string) {
  const s = findSlide(doc, slideId);
  if (s) s.notes = notes;
}

/* ───────────── 섹션 ───────────── */

export function addSection(doc: Doc, startSlideId: string, name = '제목 없는 구역'): string {
  const existing = doc.sections.find((s) => s.startSlideId === startSlideId);
  if (existing) return existing.id;
  const id = newId();
  // PowerPoint와 동일하게, 첫 섹션이 첫 슬라이드가 아니면 '기본 구역'을 자동 생성
  if (doc.sections.length === 0 && doc.slides[0] && doc.slides[0].id !== startSlideId) {
    doc.sections.push({ id: newId(), name: '기본 구역', startSlideId: doc.slides[0].id });
  }
  doc.sections.push({ id, name, startSlideId });
  return id;
}

export function renameSection(doc: Doc, sectionId: string, name: string) {
  const s = doc.sections.find((x) => x.id === sectionId);
  if (s) s.name = name;
}

export function removeSection(doc: Doc, sectionId: string) {
  doc.sections = doc.sections.filter((s) => s.id !== sectionId);
}

/* ───────────── 슬라이드 크기 / 배경 / 테마 ───────────── */

/** 슬라이드 크기 변경. scaleContent=true면 객체를 비례 조정(맞춤) */
export function setSlideSize(doc: Doc, size: SlideSize, scaleContent = true) {
  const sx = size.width / doc.size.width;
  const sy = size.height / doc.size.height;
  if (scaleContent && (sx !== 1 || sy !== 1)) {
    const s = Math.min(sx, sy);
    const offX = (size.width - doc.size.width * s) / 2;
    const offY = (size.height - doc.size.height * s) / 2;
    for (const slide of doc.slides) {
      for (const o of slide.objects) {
        scaleObject(o, s, s);
        o.x = o.x * s + offX;
        o.y = o.y * s + offY;
      }
    }
  }
  doc.size = size;
}

export function setBackground(doc: Doc, slideIds: string[] | 'all', fill: Fill | null) {
  for (const s of doc.slides) {
    if (slideIds === 'all' || slideIds.includes(s.id)) s.background = fill ? { fill } : null;
  }
}

export function applyTheme(doc: Doc, theme: Theme) {
  const old = doc.theme;
  doc.theme = theme;
  // 기존 테마 글꼴/글자색을 사용하던 텍스트를 새 테마 값으로 교체
  const map = (o: SlideObject) => {
    if (o.type === 'group') return o.children.forEach(map);
    if (!hasText(o)) return;
    for (const p of o.text.paragraphs)
      for (const r of p.runs) {
        if (r.fontFamily === old.fonts.heading) r.fontFamily = theme.fonts.heading;
        else if (r.fontFamily === old.fonts.body) r.fontFamily = theme.fonts.body;
        if (r.color === old.colors.dark1) r.color = theme.colors.dark1;
        else if (r.color === old.colors.dark2) r.color = theme.colors.dark2;
      }
    if (o.type === 'shape' && o.fill.type === 'solid' && o.fill.color === old.colors.accent1) o.fill.color = theme.colors.accent1;
  };
  doc.slides.forEach((s) => s.objects.forEach(map));
}

/* ───────────── 객체 ───────────── */

export function addObjects(doc: Doc, slideId: string, objs: SlideObject[]) {
  const s = findSlide(doc, slideId);
  if (s) s.objects.push(...objs);
}

export function deleteObjects(doc: Doc, slideId: string, ids: string[]) {
  const s = findSlide(doc, slideId);
  if (s) s.objects = s.objects.filter((o) => !ids.includes(o.id));
}

export function updateObjects(doc: Doc, slideId: string, ids: string[], fn: (o: SlideObject) => void) {
  const s = findSlide(doc, slideId);
  if (!s) return;
  for (const o of s.objects) if (ids.includes(o.id)) fn(o);
}

export function duplicateObjects(doc: Doc, slideId: string, ids: string[], offset = 20): string[] {
  const s = findSlide(doc, slideId);
  if (!s) return [];
  const copies = s.objects.filter((o) => ids.includes(o.id)).map((o) => cloneObject(o, offset));
  s.objects.push(...copies);
  return copies.map((c) => c.id);
}

export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';

export function reorderObjects(doc: Doc, slideId: string, ids: string[], op: ZOrderOp) {
  const s = findSlide(doc, slideId);
  if (!s) return;
  const objs = s.objects;
  if (op === 'front') {
    s.objects = [...objs.filter((o) => !ids.includes(o.id)), ...objs.filter((o) => ids.includes(o.id))];
  } else if (op === 'back') {
    s.objects = [...objs.filter((o) => ids.includes(o.id)), ...objs.filter((o) => !ids.includes(o.id))];
  } else if (op === 'forward') {
    for (let i = objs.length - 2; i >= 0; i--) {
      if (ids.includes(objs[i].id) && !ids.includes(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]];
    }
  } else {
    for (let i = 1; i < objs.length; i++) {
      if (ids.includes(objs[i].id) && !ids.includes(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]];
    }
  }
}

export type AlignOp = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeH' | 'distributeV';

/** 정렬: 1개 선택 시 슬라이드 기준, 여러 개는 선택 영역 기준 */
export function alignObjects(doc: Doc, slideId: string, ids: string[], op: AlignOp) {
  const s = findSlide(doc, slideId);
  if (!s) return;
  const objs = s.objects.filter((o) => ids.includes(o.id));
  if (!objs.length) return;
  const box =
    objs.length === 1
      ? { x: 0, y: 0, width: doc.size.width, height: doc.size.height }
      : (() => {
          const minX = Math.min(...objs.map((o) => o.x));
          const minY = Math.min(...objs.map((o) => o.y));
          const maxX = Math.max(...objs.map((o) => o.x + o.width));
          const maxY = Math.max(...objs.map((o) => o.y + o.height));
          return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        })();
  if (op === 'distributeH' || op === 'distributeV') {
    if (objs.length < 3) return;
    const horiz = op === 'distributeH';
    const sorted = [...objs].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
    const total = sorted.reduce((acc, o) => acc + (horiz ? o.width : o.height), 0);
    const span = horiz ? box.width : box.height;
    const gap = (span - total) / (sorted.length - 1);
    let cur = horiz ? box.x : box.y;
    for (const o of sorted) {
      if (horiz) o.x = cur;
      else o.y = cur;
      cur += (horiz ? o.width : o.height) + gap;
    }
    return;
  }
  for (const o of objs) {
    switch (op) {
      case 'left': o.x = box.x; break;
      case 'center': o.x = box.x + (box.width - o.width) / 2; break;
      case 'right': o.x = box.x + box.width - o.width; break;
      case 'top': o.y = box.y; break;
      case 'middle': o.y = box.y + (box.height - o.height) / 2; break;
      case 'bottom': o.y = box.y + box.height - o.height; break;
    }
  }
}

export function groupObjects(doc: Doc, slideId: string, ids: string[]): string | null {
  const s = findSlide(doc, slideId);
  if (!s) return null;
  const members = s.objects.filter((o) => ids.includes(o.id));
  if (members.length < 2) return null;
  const topIndex = Math.max(...members.map((m) => s.objects.indexOf(m)));
  const group = createGroup(members.map((m) => deepClone(m)));
  const remaining = s.objects.filter((o, i) => !ids.includes(o.id) || i === topIndex);
  const at = remaining.findIndex((o) => o.id === s.objects[topIndex].id);
  remaining.splice(at, 1, group);
  s.objects = remaining;
  return group.id;
}

/** 그룹 해제: 그룹 회전/위치를 자식 좌표에 반영 */
export function ungroupObjects(doc: Doc, slideId: string, ids: string[]): string[] {
  const s = findSlide(doc, slideId);
  if (!s) return [];
  const result: string[] = [];
  const next: SlideObject[] = [];
  for (const o of s.objects) {
    if (o.type === 'group' && ids.includes(o.id)) {
      const gc = { x: o.x + o.width / 2, y: o.y + o.height / 2 };
      for (const c of o.children) {
        const child = deepClone(c);
        const cc = { x: o.x + c.x + c.width / 2, y: o.y + c.y + c.height / 2 };
        const rc = rotatePoint(cc, gc, o.rotation);
        child.x = rc.x - c.width / 2;
        child.y = rc.y - c.height / 2;
        child.rotation = (c.rotation + o.rotation) % 360;
        next.push(child);
        result.push(child.id);
      }
    } else next.push(o);
  }
  s.objects = next;
  return result;
}

/** 객체 크기 비례 조정 (그룹 자식/글자 크기는 유지, 그룹은 자식 위치·크기 스케일) */
export function scaleObject(o: SlideObject, sx: number, sy: number) {
  if (o.type === 'group') {
    for (const c of o.children) {
      c.x *= sx;
      c.y *= sy;
      scaleObject(c, sx, sy);
    }
  }
  o.width = Math.max(1, o.width * sx);
  o.height = Math.max(1, o.height * sy);
}

/** 그룹의 새 크기를 적용하며 자식 스케일 */
export function resizeGroup(o: SlideObject, width: number, height: number) {
  if (o.type !== 'group') {
    o.width = width;
    o.height = height;
    return;
  }
  const sx = width / o.width;
  const sy = height / o.height;
  scaleObject(o, sx, sy);
}

/* ───────────── 텍스트 서식 ───────────── */

/** 텍스트 객체의 모든 런에 스타일 적용 (편집 모드가 아닐 때) */
export function applyRunStyle(o: SlideObject, style: Partial<TextRunStyle>) {
  if (o.type === 'group') return o.children.forEach((c) => applyRunStyle(c, style));
  if (!hasText(o)) return;
  for (const p of o.text.paragraphs) {
    if (p.runs.length === 0) p.runs.push({ text: '' });
    for (const r of p.runs) Object.assign(r, style);
  }
}

export function applyParagraphStyle(o: SlideObject, style: Partial<Paragraph>) {
  if (o.type === 'group') return o.children.forEach((c) => applyParagraphStyle(c, style));
  if (!hasText(o)) return;
  for (const p of o.text.paragraphs) Object.assign(p, style);
}

export function applyTextBody(o: SlideObject, patch: Partial<Omit<TextBody, 'paragraphs'>>) {
  if (o.type === 'group') return o.children.forEach((c) => applyTextBody(c, patch));
  if (!hasText(o)) return;
  Object.assign(o.text, patch);
}

/** 굵게 등 토글: 모든 런이 이미 켜져 있으면 끄고, 아니면 켠다 */
export function toggleRunFlag(o: SlideObject, key: 'bold' | 'italic' | 'underline' | 'strike'): boolean {
  const runs = collectRuns(o);
  const allOn = runs.length > 0 && runs.every((r) => r[key]);
  applyRunStyle(o, { [key]: !allOn });
  return !allOn;
}

export function collectRuns(o: SlideObject): TextRunStyle[] {
  if (o.type === 'group') return o.children.flatMap(collectRuns);
  if (!hasText(o)) return [];
  return o.text.paragraphs.flatMap((p) => p.runs);
}

/* ───────────── 채우기 / 윤곽선 ───────────── */

export function setFill(o: SlideObject, fill: Fill) {
  if (o.type === 'group') return o.children.forEach((c) => setFill(c, fill));
  if (o.type === 'shape' || o.type === 'text') o.fill = fill;
}

export function setStroke(o: SlideObject, stroke: Stroke | null) {
  if (o.type === 'group') return o.children.forEach((c) => setStroke(c, stroke));
  if (o.type === 'line') {
    if (stroke) o.stroke = stroke;
  } else if (o.type === 'shape' || o.type === 'text' || o.type === 'image') o.stroke = stroke;
}

/* ───────────── 서식 복사 ───────────── */

export interface CopiedFormat {
  fill?: Fill;
  stroke?: Stroke | null;
  run?: TextRunStyle;
  paragraph?: Partial<Paragraph>;
  opacity?: number;
}

export function extractFormat(o: SlideObject): CopiedFormat {
  const f: CopiedFormat = { opacity: o.opacity };
  if (o.type === 'shape' || o.type === 'text') {
    f.fill = deepClone(o.fill);
    f.stroke = o.stroke ? { ...o.stroke } : null;
    const p = o.text.paragraphs[0];
    const r = p?.runs[0];
    if (r) {
      const { text: _t, ...style } = r;
      void _t;
      f.run = style;
    }
    if (p) f.paragraph = { align: p.align, lineSpacing: p.lineSpacing, bullet: p.bullet };
  } else if (o.type === 'line') {
    f.stroke = { ...o.stroke };
  } else if (o.type === 'image') {
    f.stroke = o.stroke ? { ...o.stroke } : null;
  }
  return f;
}

export function applyFormat(o: SlideObject, f: CopiedFormat) {
  if (f.opacity !== undefined) o.opacity = f.opacity;
  if (f.fill) setFill(o, deepClone(f.fill));
  if (f.stroke !== undefined) setStroke(o, f.stroke ? { ...f.stroke } : null);
  if (f.run) applyRunStyle(o, f.run);
  if (f.paragraph) applyParagraphStyle(o, f.paragraph);
}

/* ───────────── 기하 ───────────── */

export function nudgeObjects(doc: Doc, slideId: string, ids: string[], dx: number, dy: number) {
  updateObjects(doc, slideId, ids, (o) => {
    o.x += dx;
    o.y += dy;
  });
}

/** 선 객체의 양 끝점 (슬라이드 좌표) */
export function lineEndpoints(o: { x: number; y: number; width: number; height: number; flipH?: boolean; flipV?: boolean; rotation: number }) {
  let x1 = o.x, y1 = o.y, x2 = o.x + o.width, y2 = o.y + o.height;
  if (o.flipH) [x1, x2] = [x2, x1];
  if (o.flipV) [y1, y2] = [y2, y1];
  if (o.rotation) {
    const c = { x: o.x + o.width / 2, y: o.y + o.height / 2 };
    const a = rotatePoint({ x: x1, y: y1 }, c, o.rotation);
    const b = rotatePoint({ x: x2, y: y2 }, c, o.rotation);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  return { x1, y1, x2, y2 };
}

/** 두 끝점으로 선 객체 기하 설정 (회전 0, flip으로 방향 표현) */
export function setLineEndpoints(o: SlideObject, x1: number, y1: number, x2: number, y2: number) {
  o.rotation = 0;
  o.x = Math.min(x1, x2);
  o.y = Math.min(y1, y2);
  o.width = Math.abs(x2 - x1);
  o.height = Math.abs(y2 - y1);
  o.flipH = x2 < x1;
  o.flipV = y2 < y1;
}

export { degToRad };
