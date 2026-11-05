/**
 * 슬라이드 마스터 / 레이아웃.
 *
 * - 마스터: 공통 디자인 개체 + 제목/본문 개체 틀(서식 원형)
 * - 레이아웃: 마스터 디자인 위에 자기 디자인 + 개체 틀 배치
 * - 슬라이드: 레이아웃의 개체 틀을 복제해 만든다 (ph로 연결)
 *
 * 전파 규칙(propagateMasters): 마스터 → 레이아웃 → 슬라이드 순으로, 대상 속성 값이
 * '변경 전 원형 값과 같을 때만' 새 값으로 바꾼다. 사용자가 직접 바꾼 위치·서식은 유지된다.
 */
import type { Draft } from 'immer';
import type { MasterSlide, Paragraph, PlaceholderType, Presentation, Slide, SlideObject, SlideSize, TextObject, TextRun } from '../../types/model';
import { createTextBox, paragraph } from './factory';
import { newId } from '../../utils/id';
import { deepClone } from '../../utils/clone';

export type BuiltinLayout = 'title' | 'titleContent' | 'sectionHeader' | 'twoContent' | 'titleOnly' | 'blank';

export const BUILTIN_LAYOUTS: { id: BuiltinLayout; name: string }[] = [
  { id: 'title', name: '제목 슬라이드' },
  { id: 'titleContent', name: '제목 및 내용' },
  { id: 'sectionHeader', name: '구역 머리글' },
  { id: 'twoContent', name: '콘텐츠 2개' },
  { id: 'titleOnly', name: '제목만' },
  { id: 'blank', name: '빈 화면' },
];

export const PH_PROMPTS: Record<PlaceholderType, string> = {
  title: '제목을 입력하십시오',
  ctrTitle: '제목을 입력하십시오',
  subTitle: '부제목을 입력하십시오',
  body: '텍스트를 입력하십시오',
  dt: '날짜',
  ftr: '바닥글',
  sldNum: '슬라이드 번호',
};

const PH_NAMES: Record<PlaceholderType, string> = {
  title: '제목',
  ctrTitle: '제목',
  subTitle: '부제목',
  body: '내용',
  dt: '날짜',
  ftr: '바닥글',
  sldNum: '슬라이드 번호',
};

const BODY_LEVELS = ['마스터 텍스트 스타일 편집', '둘째 수준', '셋째 수준', '넷째 수준', '다섯째 수준'];
const BODY_SIZES = [28, 24, 20, 18, 18];

function phBox(type: PlaceholderType, idx: number | undefined, x: number, y: number, w: number, h: number, size: SlideSize): TextObject {
  void size;
  const title = type === 'title' || type === 'ctrTitle';
  const t = createTextBox({ x, y, width: w, height: h, text: '', name: PH_NAMES[type] });
  t.ph = { type, ...(idx !== undefined ? { idx } : {}) };
  t.placeholder = PH_PROMPTS[type];
  if (title) {
    t.text.paragraphs = [paragraph(type === 'ctrTitle' ? '마스터 제목 스타일 편집' : '마스터 제목 스타일 편집', { fontFamily: '@heading', fontSize: type === 'ctrTitle' ? 54 : 40, color: '@dark1' }, { align: type === 'ctrTitle' ? 'center' : 'left' })];
    t.text.vAlign = type === 'ctrTitle' ? 'bottom' : 'middle';
  } else if (type === 'subTitle') {
    t.text.paragraphs = [paragraph('마스터 부제목 스타일 편집', { fontFamily: '@body', fontSize: 24, color: '@dark2' }, { align: 'center' })];
  } else if (type === 'body') {
    t.text.paragraphs = BODY_LEVELS.map((txt, i) => paragraph(txt, { fontFamily: '@body', fontSize: BODY_SIZES[i], color: '@dark1' }, { bullet: 'bullet', level: i, spaceBefore: 6 }));
  } else {
    t.text.paragraphs = [paragraph(PH_PROMPTS[type], { fontFamily: '@body', fontSize: 12, color: '@dark1^0.45' }, { align: type === 'sldNum' ? 'right' : type === 'ftr' ? 'center' : 'left' })];
    t.text.vAlign = 'middle';
  }
  return t;
}

export function createMaster(size: SlideSize): MasterSlide {
  const W = size.width, H = size.height, m = W * 0.07;
  return {
    id: 'master',
    kind: 'master',
    name: '슬라이드 마스터',
    objects: [
      phBox('title', undefined, m, H * 0.06, W - 2 * m, H * 0.16, size),
      phBox('body', 1, m, H * 0.26, W - 2 * m, H * 0.64, size),
    ],
    background: null,
    notes: '',
    layout: '',
  };
}

export function createBuiltinLayout(id: BuiltinLayout, size: SlideSize): MasterSlide {
  const W = size.width, H = size.height, m = W * 0.07;
  const objects: SlideObject[] = [];
  switch (id) {
    case 'title':
      objects.push(phBox('ctrTitle', undefined, m, H * 0.28, W - 2 * m, H * 0.24, size), phBox('subTitle', 1, m, H * 0.55, W - 2 * m, H * 0.14, size));
      break;
    case 'titleContent':
      objects.push(phBox('title', undefined, m, H * 0.06, W - 2 * m, H * 0.16, size), phBox('body', 1, m, H * 0.26, W - 2 * m, H * 0.64, size));
      break;
    case 'sectionHeader': {
      const t = phBox('title', undefined, m, H * 0.3, W - 2 * m, H * 0.24, size);
      t.text.vAlign = 'bottom';
      t.text.paragraphs[0].runs[0].fontSize = 48;
      const b = phBox('body', 1, m, H * 0.56, W - 2 * m, H * 0.12, size);
      b.text.paragraphs = [paragraph('마스터 텍스트 스타일 편집', { fontFamily: '@body', fontSize: 24, color: '@dark2' })];
      objects.push(t, b);
      break;
    }
    case 'twoContent':
      objects.push(
        phBox('title', undefined, m, H * 0.06, W - 2 * m, H * 0.16, size),
        phBox('body', 1, m, H * 0.26, (W - 2 * m) / 2 - 12, H * 0.64, size),
        phBox('body', 2, W / 2 + 12, H * 0.26, (W - 2 * m) / 2 - 12, H * 0.64, size),
      );
      break;
    case 'titleOnly':
      objects.push(phBox('title', undefined, m, H * 0.06, W - 2 * m, H * 0.16, size));
      break;
    case 'blank':
      break;
  }
  return { id, kind: 'layout', name: BUILTIN_LAYOUTS.find((l) => l.id === id)!.name, objects, background: null, notes: '', layout: '' };
}

export function createBuiltinLayouts(size: SlideSize): { layouts: Record<string, MasterSlide>; order: string[] } {
  const layouts: Record<string, MasterSlide> = {};
  for (const l of BUILTIN_LAYOUTS) layouts[l.id] = createBuiltinLayout(l.id, size);
  return { layouts, order: BUILTIN_LAYOUTS.map((l) => l.id) };
}

/** 레이아웃의 개체 틀로 새 슬라이드 만들기 */
export function slideFromLayout(layout: MasterSlide): Slide {
  const objects: SlideObject[] = [];
  for (const o of layout.objects) {
    if (o.type !== 'text' || !o.ph || ['dt', 'ftr', 'sldNum'].includes(o.ph.type)) continue;
    const c = deepClone(o);
    c.id = newId();
    c.name = PH_NAMES[o.ph.type];
    c.placeholder = PH_PROMPTS[o.ph.type];
    // 첫 문단 서식만 남긴 빈 문단 (수준 0)
    const first = c.text.paragraphs[0];
    c.text.paragraphs = [{ ...first, runs: [{ ...first.runs[0], text: '' }] }];
    objects.push(c);
  }
  return { id: newId(), objects, background: null, notes: '', layout: layout.id };
}

/* ───────────── 찾기 ───────────── */

export function allMasterSlides(doc: Pick<Presentation, 'master' | 'layouts' | 'layoutOrder'>): MasterSlide[] {
  const out: MasterSlide[] = [];
  if (doc.master) out.push(doc.master);
  const order = doc.layoutOrder ?? Object.keys(doc.layouts ?? {});
  for (const id of order) if (doc.layouts?.[id]) out.push(doc.layouts[id]);
  return out;
}

const normType = (t: PlaceholderType) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t);

/** 대상 개체 틀에 대응하는 원형 개체 틀 */
function findProto(list: SlideObject[], ph: NonNullable<TextObject['ph']>, loose: boolean): TextObject | undefined {
  const phs = list.filter((o): o is TextObject => o.type === 'text' && !!o.ph);
  const exact = phs.find((o) => o.ph!.type === ph.type && (o.ph!.idx ?? 0) === (ph.idx ?? 0)) ?? phs.find((o) => o.ph!.type === ph.type);
  if (exact || !loose) return exact;
  // 마스터에는 제목/본문만 있으므로 종류를 정규화해 매칭
  return phs.find((o) => normType(o.ph!.type) === normType(ph.type));
}

/* ───────────── 전파 ───────────── */

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const RUN_KEYS = ['fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline', 'strike'] as const;
const PARA_KEYS = ['align', 'lineSpacing', 'bullet', 'bulletChar', 'spaceBefore', 'spaceAfter'] as const;
const BODY_KEYS = ['vAlign', 'direction', 'autoFit', 'wrap'] as const;

const paraFor = (paras: Paragraph[], level: number) => paras.find((p) => (p.level ?? 0) === level) ?? paras[0];

/** 원형(old → next)의 변경을 대상 개체에 반영. 대상 값이 old와 같은 속성만 바꾼다 */
function syncPlaceholder(target: Draft<TextObject>, old: TextObject, next: TextObject, geometry: boolean) {
  if (geometry && near(target.x, old.x) && near(target.y, old.y) && near(target.width, old.width) && near(target.height, old.height) && near(target.rotation, old.rotation)) {
    target.x = next.x;
    target.y = next.y;
    target.width = next.width;
    target.height = next.height;
    target.rotation = next.rotation;
  }
  for (const k of BODY_KEYS) if (same(target.text[k], old.text[k])) (target.text as unknown as Record<string, unknown>)[k] = deepClone(next.text[k]);
  if (same(target.text.padding, old.text.padding)) target.text.padding = { ...next.text.padding };
  if (same(target.fill, old.fill)) target.fill = deepClone(next.fill);
  if (same(target.stroke, old.stroke)) target.stroke = next.stroke ? { ...next.stroke } : null;
  for (const p of target.text.paragraphs) {
    const lvl = p.level ?? 0;
    const op = paraFor(old.text.paragraphs, lvl);
    const np = paraFor(next.text.paragraphs, lvl);
    if (!op || !np) continue;
    for (const k of PARA_KEYS) if (same(p[k], op[k])) (p as unknown as Record<string, unknown>)[k] = np[k];
    const or = op.runs[0] ?? ({} as TextRun);
    const nr = np.runs[0] ?? ({} as TextRun);
    for (const r of p.runs) for (const k of RUN_KEYS) if (same(r[k], or[k])) (r as unknown as Record<string, unknown>)[k] = nr[k];
  }
}

/**
 * 문서 변경 후 호출: 마스터/레이아웃이 바뀌었으면 하위로 전파.
 * before: 변경 전 문서, d: 변경 후 draft
 */
export function propagateMasters(before: Presentation, after: Presentation, d: Draft<Presentation>) {
  // 1) 마스터 → 레이아웃
  if (before.master && after.master && before.master !== after.master) {
    const oldM = before.master, newM = after.master;
    for (const id of Object.keys(d.layouts ?? {})) {
      const lay = d.layouts![id];
      for (const o of lay.objects) {
        if (o.type !== 'text' || !o.ph) continue;
        const op = findProto(oldM.objects, o.ph, true);
        const np = findProto(newM.objects, o.ph, true);
        // 가운데 제목/부제목은 마스터와 위치가 다르므로 서식만 전파
        if (op && np) syncPlaceholder(o, op, np, o.ph.type === 'title' || o.ph.type === 'body');
      }
    }
  }
}

/** 레이아웃 → 슬라이드 (마스터 전파 후 결과 기준으로 다시 호출) */
export function propagateLayouts(before: Presentation, after: Presentation, d: Draft<Presentation>) {
  const beforeLayouts = before.layouts ?? {};
  for (const id of Object.keys(after.layouts ?? {})) {
    const oldL = beforeLayouts[id];
    const newL = after.layouts![id];
    if (!oldL || oldL === newL) continue;
    for (const s of d.slides) {
      if (s.layout !== id) continue;
      for (const o of s.objects) {
        if (o.type !== 'text' || !o.ph) continue;
        const op = findProto(oldL.objects, o.ph, false);
        const np = findProto(newL.objects, o.ph, false);
        if (op && np) syncPlaceholder(o, op, np, true);
      }
    }
  }
}

/* ───────────── 마이그레이션 (이전 버전 문서) ───────────── */

const NAME_TO_PH: Record<string, NonNullable<TextObject['ph']>> = {
  제목: { type: 'title' },
  '구역 제목': { type: 'title' },
  부제목: { type: 'subTitle', idx: 1 },
  내용: { type: 'body', idx: 1 },
  설명: { type: 'body', idx: 1 },
  '내용 1': { type: 'body', idx: 1 },
  '내용 2': { type: 'body', idx: 2 },
};

export function ensureMasters(doc: Presentation) {
  if (!doc.master) doc.master = createMaster(doc.size);
  const builtin = createBuiltinLayouts(doc.size);
  if (!doc.layouts) {
    doc.layouts = builtin.layouts;
    doc.layoutOrder = builtin.order;
  } else {
    // 7단계 형식(가져온 레이아웃: kind/background 형식이 다름) 변환
    for (const [id, l] of Object.entries(doc.layouts)) {
      const old = l as unknown as { background?: unknown; kind?: string };
      if (!old.kind) {
        const bg = old.background as Presentation['theme']['background'] | undefined;
        doc.layouts[id] = { ...(l as MasterSlide), kind: 'layout', background: bg ? { fill: bg } : null, notes: '', layout: '', showMasterShapes: false };
      }
    }
    // 슬라이드가 참조하는 기본 레이아웃이 없으면 추가
    for (const s of doc.slides) if (!doc.layouts[s.layout] && builtin.layouts[s.layout]) doc.layouts[s.layout] = builtin.layouts[s.layout];
    doc.layoutOrder ??= Object.keys(doc.layouts);
  }
  for (const s of doc.slides) {
    for (const o of s.objects) if (o.type === 'text' && !o.ph && o.placeholder && NAME_TO_PH[o.name]) o.ph = NAME_TO_PH[o.name];
  }
}

/** 변경 전/후 문서를 받아 전파를 적용한 최종 문서를 돌려줌 (store에서 사용) */
export function withPropagation(before: Presentation, after: Presentation, produceFn: <T>(base: T, recipe: (d: Draft<T>) => void) => T): Presentation {
  if (before.master === after.master && before.layouts === after.layouts) return after;
  let next = after;
  if (before.master !== after.master) next = produceFn(next, (d) => propagateMasters(before, after, d as Draft<Presentation>));
  if (before.layouts !== next.layouts) {
    const snap = next;
    next = produceFn(next, (d) => propagateLayouts(before, snap, d as Draft<Presentation>));
  }
  return next;
}
