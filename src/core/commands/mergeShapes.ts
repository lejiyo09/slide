/**
 * 도형 병합 컨트롤러: 선택(선택한 순서) → 검사 → 엔진 계산(필요할 때 불러옴) → 원본 삭제·결과 삽입을 실행 취소 한 단계로.
 * 결과가 비었거나 계산에 실패하면 문서를 바꾸지 않고(실행 취소 기록도 없음) 안내만 한다.
 * 서식: 처음 선택한 개체(그룹이면 그 안 첫 도형)의 채우기·선·투명도. 통합·결합·교차·빼기는 처음 선택한 도형의 글자를 유지.
 */
import type { ShapeObject, SlideObject, TextBody, TextObject } from '../../types/model';
import { getActiveSlide, useEditor } from '../store/editorStore';
import { createShape } from '../document/factory';
import { newId } from '../../utils/id';
import type { MergedShape, MergeOp } from '../../engines/geometry/shapeBoolean';

export const MERGE_OPS: { id: MergeOp; name: string; en: string; desc: string }[] = [
  { id: 'union', name: '통합', en: 'Union', desc: '모든 도형을 하나로 합칩니다' },
  { id: 'combine', name: '결합', en: 'Combine', desc: '겹친 부분을 지우고 나머지를 합칩니다' },
  { id: 'fragment', name: '조각', en: 'Fragment', desc: '겹침 경계마다 따로 떨어진 조각으로 나눕니다' },
  { id: 'intersect', name: '교차', en: 'Intersect', desc: '모든 도형이 겹친 부분만 남깁니다' },
  { id: 'subtract', name: '빼기', en: 'Subtract', desc: '처음 선택한 도형에서 나머지를 뺍니다' },
];

const engine = () => import('../../engines/geometry/shapeBoolean');

/** 선택한 순서대로의 개체 (Ctrl/Shift+클릭 순서; 범위 선택은 쌓는 순서) */
export function selectedInOrder(): SlideObject[] {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  return s.selectedIds.map((id) => slide.objects.find((o) => o.id === id)).filter((o): o is SlideObject => !!o);
}

const leaves = (o: SlideObject): SlideObject[] => (o.type === 'group' ? o.children.flatMap(leaves) : [o]);

export interface MergeAvailability {
  ok: boolean;
  /** 비활성 이유 */
  reason?: string;
  /** 빼기 기준 개체 이름 */
  base?: string;
  /** 처음 선택이 그림: 교차·빼기만 (그림을 도형 모양으로 자르기) */
  image?: boolean;
}

/** 그림을 기준으로 할 때 쓸 수 있는 연산 */
export const IMAGE_OPS: MergeOp[] = ['intersect', 'subtract'];

/** 메뉴 활성 조건 (엔진을 불러오지 않고 판단) */
export function mergeAvailability(objs: SlideObject[]): MergeAvailability {
  const count = objs.flatMap(leaves).length;
  if (count < 2) return { ok: false, reason: '도형을 두 개 이상 선택하세요 (Ctrl+클릭).' };
  // 그림: 처음 선택한 개체일 때만 (그림 ∩ 도형 = 도형 모양으로 자르기, 그림 − 도형 = 도형 모양 오려 내기)
  const image = objs[0].type === 'image';
  if (objs.slice(1).some((o) => leaves(o).some((x) => x.type === 'image'))) return { ok: false, reason: '그림은 처음 선택한 개체일 때만 쓸 수 있습니다 (그림을 먼저 선택한 뒤 도형을 Ctrl+클릭).' };
  for (const o of image ? objs.slice(1).flatMap(leaves) : objs.flatMap(leaves)) {
    if (o.locked || objs.some((x) => x.locked)) return { ok: false, reason: '잠긴 개체가 있습니다. 잠금을 풀고 다시 선택하세요.' };
    if (o.type === 'line') return { ok: false, reason: "선은 면적이 없습니다. '선을 도형으로'로 바꾼 뒤 병합하세요." };
    if (o.type !== 'shape' && o.type !== 'text') return { ok: false, reason: '도형과 텍스트 상자만 병합할 수 있습니다.' };
    if (o.type === 'shape' && o.shape === 'custom' && o.geometry && !o.geometry.paths.some((p) => p.fill && p.cmds.some((c) => c.c === 'Z'))) return { ok: false, reason: '닫히지 않은 자유형(열린 경로)은 병합할 수 없습니다.' };
  }
  if (image && objs[0].locked) return { ok: false, reason: '잠긴 개체가 있습니다. 잠금을 풀고 다시 선택하세요.' };
  return { ok: true, base: objs[0].name || '첫 번째 도형', ...(image ? { image } : {}) };
}

/** 결과 도형의 서식 기준 (처음 선택한 개체, 그룹이면 그 안 첫 도형) */
function styleSource(objs: SlideObject[]): SlideObject {
  return leaves(objs[0])[0];
}

function buildShape(m: MergedShape, src: SlideObject, op: MergeOp, sources: string[], text: TextBody | null, n: number): ShapeObject {
  const base = createShape('custom', m.x, m.y, m.width, m.height);
  const fill = src.type === 'shape' || src.type === 'text' ? JSON.parse(JSON.stringify(src.fill)) : base.fill;
  const stroke = src.type === 'shape' || src.type === 'text' ? (src.stroke ? JSON.parse(JSON.stringify(src.stroke)) : null) : base.stroke;
  const body: TextBody = text ? JSON.parse(JSON.stringify(text)) : { ...base.text, paragraphs: [{ runs: [{ text: '' }] }] as TextBody['paragraphs'] };
  return {
    ...base,
    id: newId(),
    name: `자유형: ${MERGE_OPS.find((x) => x.id === op)!.name} ${n}`,
    geometry: m.geometry,
    fill,
    stroke,
    ...(src.opacity !== undefined ? { opacity: src.opacity } : {}),
    text: body,
    merged: { op, sources },
  };
}

/** 그림을 도형 모양으로 자르기 (교차·빼기). 그림은 같은 개체(ID·애니메이션 유지)로 바뀌고 도형은 사라짐 */
async function clipSelectedImage(op: MergeOp, objs: SlideObject[]): Promise<string[]> {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const img = objs[0];
  if (img.type !== 'image') return [];
  if (!IMAGE_OPS.includes(op)) {
    s.toast('그림은 교차(도형 모양으로 자르기)와 빼기(도형 모양 오려 내기)만 할 수 있습니다.', 'warning');
    return [];
  }
  let r;
  try {
    r = (await engine()).clipImage(op as 'intersect' | 'subtract', img, objs.slice(1));
  } catch (e) {
    console.error(e);
    s.toast('그림을 자르지 못했습니다. 원본은 그대로 둡니다.', 'error');
    return [];
  }
  if (!r) {
    s.toast(op === 'intersect' ? '그림과 도형이 겹치는 부분이 없습니다.' : '빼고 나면 남는 부분이 없습니다.', 'warning');
    return [];
  }
  const ids = new Set(objs.slice(1).map((o) => o.id));
  s.commit(`도형 병합: 그림 ${op === 'intersect' ? '교차' : '빼기'}`, (d) => {
    const sl = d.slides.find((x) => x.id === slide.id)!;
    const o = sl.objects.find((x) => x.id === img.id);
    if (o?.type === 'image') Object.assign(o, { x: r.x, y: r.y, width: r.width, height: r.height, crop: r.crop, clip: r.clip });
    sl.objects = sl.objects.filter((x) => !ids.has(x.id));
    if (sl.animations) sl.animations = sl.animations.filter((a) => !ids.has(a.targetId));
  });
  useEditor.getState().select([img.id]);
  return [img.id];
}

/** 미리 보기 (메뉴에 마우스를 올렸을 때): 결과 윤곽만 계산 */
export async function previewMerge(op: MergeOp): Promise<MergedShape[]> {
  const objs = selectedInOrder();
  const av = mergeAvailability(objs);
  if (!av.ok) return [];
  if (av.image) {
    if (!IMAGE_OPS.includes(op) || objs[0].type !== 'image') return [];
    try {
      const e = await engine();
      const r = e.clipImage(op as 'intersect' | 'subtract', objs[0], objs.slice(1));
      return r && !objs[0].rotation ? [{ x: r.x, y: r.y, width: r.width, height: r.height, geometry: r.clip }] : [];
    } catch {
      return [];
    }
  }
  try {
    return (await engine()).mergeObjects(op, objs).shapes;
  } catch {
    return [];
  }
}

/** 실행. 성공하면 결과 개체 ID들 */
export async function mergeShapes(op: MergeOp): Promise<string[]> {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const objs = selectedInOrder();
  const av = mergeAvailability(objs);
  if (!av.ok) {
    s.toast(av.reason!, 'warning');
    return [];
  }
  if (av.image) return clipSelectedImage(op, objs);
  // 글자가 있는 텍스트 상자는 사각형이 아니라 글자 윤곽으로 병합 (PowerPoint와 같음)
  let operands: SlideObject[];
  let textStyle: SlideObject | null = null;
  try {
    const conv = await outlineTextBoxes(objs);
    if (!conv) return [];
    operands = conv.objs;
    textStyle = conv.firstStyle;
  } catch (e) {
    console.error(e);
    s.toast('글자를 윤곽선으로 바꾸지 못했습니다. 원본은 그대로 둡니다.', 'error');
    return [];
  }
  let shapes: MergedShape[];
  try {
    shapes = (await engine()).mergeObjects(op, operands).shapes;
  } catch (e) {
    console.error(e);
    s.toast('도형을 병합하지 못했습니다. 원본은 그대로 둡니다.', 'error');
    return [];
  }
  if (!shapes.length) {
    s.toast(op === 'intersect' ? '모든 도형이 함께 겹치는 부분이 없습니다.' : op === 'subtract' ? '빼고 나면 남는 부분이 없습니다.' : op === 'combine' ? '겹친 부분을 지우고 나면 남는 부분이 없습니다.' : '결과 도형이 없습니다.', 'warning');
    return [];
  }
  // 문서가 그사이 바뀌었으면 (엔진을 불러오는 동안) 중단
  if (getActiveSlide() !== slide) return [];
  if (textStyle || objs.some(hasTextBox)) s.toast('텍스트 상자의 글자를 윤곽선으로 바꿔 병합했습니다. 이제 글자로 편집할 수 없습니다 (Ctrl+Z로 되돌리기).', 'info');
  const src = textStyle ?? styleSource(objs);
  const first = objs[0];
  // 처음 선택한 도형의 글자 유지 (텍스트 상자는 글자 자체가 윤곽선이 되었으므로 유지하지 않음)
  const text = op !== 'fragment' && first.type === 'shape' && first.text.paragraphs.some((p) => p.runs.some((r) => r.text)) ? first.text : null;
  const sources = objs.map((o) => o.id);
  const results = shapes.map((m, i) => buildShape(m, src, op, sources, i === 0 ? text : null, i + 1));
  const ids = new Set(sources);
  s.commit(`도형 병합: ${MERGE_OPS.find((x) => x.id === op)!.name}`, (d) => {
    const sl = d.slides.find((x) => x.id === slide.id)!;
    // 처음 선택한 개체가 있던 쌓는 순서 자리에
    const at = sl.objects.findIndex((o) => o.id === first.id);
    const before = sl.objects.slice(0, at).filter((o) => ids.has(o.id)).length;
    sl.objects = sl.objects.filter((o) => !ids.has(o.id));
    sl.objects.splice(Math.max(0, at - before), 0, ...results);
    if (sl.animations) sl.animations = sl.animations.filter((a) => !ids.has(a.targetId));
  });
  useEditor.getState().select(results.map((r) => r.id));
  return results.map((r) => r.id);
}

/**
 * 선을 도형으로 (Stroke to Outline): 선택한 선·도형 테두리를 같은 모양의 면(선 색으로 칠한 자유형)으로.
 * 선 개체는 면으로 바뀌고, 채우기가 있는 도형은 채우기만 남긴 채 그 위에 테두리 면을 놓음. 실행 취소 한 단계.
 */
export async function convertStrokeToOutline(): Promise<string[]> {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const objs = selectedInOrder().filter((o) => (o.type === 'line' || o.type === 'shape' || o.type === 'text') && !o.locked && (o as { stroke?: { width: number } | null }).stroke);
  if (!objs.length) {
    s.toast('테두리(선)가 있는 도형이나 선을 선택하세요.', 'warning');
    return [];
  }
  const { strokeOutline } = await engine();
  const made: { src: SlideObject; shape: ShapeObject }[] = [];
  for (const o of objs) {
    const m = strokeOutline(o);
    if (!m) continue;
    const st = (o as { stroke: { color: string; opacity?: number } }).stroke;
    const base = createShape('custom', m.x, m.y, m.width, m.height);
    made.push({
      src: o,
      shape: { ...base, id: newId(), name: `자유형: ${o.name || '선'} 윤곽`, geometry: m.geometry, fill: { type: 'solid', color: st.color, ...(st.opacity !== undefined && st.opacity < 1 ? { opacity: st.opacity } : {}) }, stroke: null, ...(o.opacity !== undefined ? { opacity: o.opacity } : {}), text: { ...base.text, paragraphs: [{ runs: [{ text: '' }] }] as TextBody['paragraphs'] } },
    });
  }
  if (!made.length) {
    s.toast('선을 면으로 바꾸지 못했습니다.', 'error');
    return [];
  }
  const keep: string[] = [];
  s.commit('선을 도형으로', (d) => {
    const sl = d.slides.find((x) => x.id === slide.id)!;
    for (const { src, shape } of made) {
      const i = sl.objects.findIndex((o) => o.id === src.id);
      const cur = sl.objects[i];
      const hasFill = (cur.type === 'shape' || cur.type === 'text') && cur.fill.type !== 'none';
      const hasText = (cur.type === 'shape' || cur.type === 'text') && cur.text.paragraphs.some((p) => p.runs.some((r) => r.text));
      if (cur.type === 'line' || (!hasFill && !hasText)) {
        sl.objects.splice(i, 1, shape);
        if (sl.animations) sl.animations = sl.animations.filter((a) => a.targetId !== src.id);
      } else {
        (cur as ShapeObject).stroke = null;
        sl.objects.splice(i + 1, 0, shape);
        keep.push(cur.id);
      }
    }
  });
  const ids = made.map((m) => m.shape.id);
  useEditor.getState().select([...keep, ...ids]);
  return ids;
}

const hasTextBox = (o: SlideObject) => o.type === 'text' && o.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()));

/**
 * 선택에서 글자가 있는 텍스트 상자를 글자 윤곽(그룹처럼 묶은 자유형들)으로 바꾼 목록.
 * 글꼴 파일이 없으면 안내하고 null. firstStyle: 처음 선택이 텍스트 상자면 그 글자 색으로 칠한 서식
 */
async function outlineTextBoxes(objs: SlideObject[]): Promise<{ objs: SlideObject[]; firstStyle: SlideObject | null } | null> {
  if (!objs.some(hasTextBox)) return { objs, firstStyle: null };
  const { textToOutlines } = await import('../../engines/geometry/textOutline');
  const doc = useEditor.getState().doc;
  const out: SlideObject[] = [];
  let firstStyle: SlideObject | null = null;
  for (const [i, o] of objs.entries()) {
    if (!hasTextBox(o)) {
      out.push(o);
      continue;
    }
    const r = await textToOutlines(doc, o as TextObject);
    if (r.missing.length) {
      useEditor.getState().toast(`글꼴 파일을 구할 수 없어 글자를 윤곽선으로 바꾸지 못했습니다: ${r.missing.join(', ')} — 홈 › 글꼴 관리에서 '내 글꼴'로 추가하거나 웹 글꼴로 바꾸세요.`, 'warning');
      return null;
    }
    if (!r.pieces.length) continue;
    const children = r.pieces.map((p) => ({ ...createShape('custom', p.x, p.y, p.width, p.height), id: `${o.id}~${newId()}`, geometry: p.geometry, fill: { type: 'solid', color: p.color }, stroke: null }) as ShapeObject);
    if (i === 0) firstStyle = children[0];
    // 슬라이드 좌표 그대로 담는 묶음 (회전 없음, 왼쪽 위 0,0)
    out.push({ id: o.id, type: 'group', name: o.name, x: 0, y: 0, width: 1, height: 1, rotation: 0, children } as SlideObject);
  }
  return { objs: out, firstStyle };
}

/** 텍스트를 윤곽선으로: 선택한 텍스트 상자의 글자를 글자 색별 자유형으로 (실행 취소 한 단계) */
export async function convertTextToOutlines(): Promise<string[]> {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const objs = selectedInOrder().filter((o) => (o.type === 'text' || o.type === 'shape') && !o.locked && o.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim())));
  if (!objs.length) {
    s.toast('글자가 있는 텍스트 상자나 도형을 선택하세요.', 'warning');
    return [];
  }
  const { textToOutlines } = await import('../../engines/geometry/textOutline');
  const made: { src: SlideObject; shapes: ShapeObject[] }[] = [];
  for (const o of objs) {
    const r = await textToOutlines(s.doc, o as TextObject);
    if (r.missing.length) {
      s.toast(`글꼴 파일을 구할 수 없어 바꾸지 못했습니다: ${r.missing.join(', ')} — '내 글꼴'로 추가하거나 웹 글꼴로 바꾸세요.`, 'warning');
      return [];
    }
    made.push({ src: o, shapes: r.pieces.map((p, i) => ({ ...createShape('custom', p.x, p.y, p.width, p.height), id: newId(), name: `${o.name || '텍스트'} 윤곽${r.pieces.length > 1 ? ` ${i + 1}` : ''}`, geometry: p.geometry, fill: { type: 'solid', color: p.color }, stroke: null }) as ShapeObject) });
  }
  const keep: string[] = [];
  s.commit('텍스트를 윤곽선으로', (d) => {
    const sl = d.slides.find((x) => x.id === slide.id)!;
    for (const { src, shapes } of made) {
      const i = sl.objects.findIndex((o) => o.id === src.id);
      const cur = sl.objects[i];
      if (cur.type !== 'text' && cur.type !== 'shape') continue;
      // 채우기·테두리가 보이면 상자(도형)는 글자 없이 남기고 그 위에 윤곽
      if (cur.fill.type !== 'none' || cur.stroke || cur.type === 'shape') {
        cur.text.paragraphs = [{ ...cur.text.paragraphs[0], runs: [{ ...cur.text.paragraphs[0].runs[0], text: '' }] }];
        sl.objects.splice(i + 1, 0, ...shapes);
        keep.push(cur.id);
      } else {
        sl.objects.splice(i, 1, ...shapes);
        if (sl.animations) sl.animations = sl.animations.filter((a) => a.targetId !== src.id);
      }
    }
  });
  const ids = made.flatMap((m) => m.shapes.map((x) => x.id));
  useEditor.getState().select(ids);
  s.toast('글자를 윤곽선으로 바꿨습니다. 이제 글자로 편집할 수 없습니다 (Ctrl+Z로 되돌리기).', 'info');
  return ids;
}
