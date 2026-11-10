/**
 * 도형 병합 컨트롤러: 선택(선택한 순서) → 검사 → 엔진 계산(필요할 때 불러옴) → 원본 삭제·결과 삽입을 실행 취소 한 단계로.
 * 결과가 비었거나 계산에 실패하면 문서를 바꾸지 않고(실행 취소 기록도 없음) 안내만 한다.
 * 서식: 처음 선택한 개체(그룹이면 그 안 첫 도형)의 채우기·선·투명도. 통합·결합·교차·빼기는 처음 선택한 도형의 글자를 유지.
 */
import type { ShapeObject, SlideObject, TextBody } from '../../types/model';
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
}

/** 메뉴 활성 조건 (엔진을 불러오지 않고 판단) */
export function mergeAvailability(objs: SlideObject[]): MergeAvailability {
  const count = objs.flatMap(leaves).length;
  if (count < 2) return { ok: false, reason: '도형을 두 개 이상 선택하세요 (Ctrl+클릭).' };
  for (const o of objs.flatMap(leaves)) {
    if (o.locked || objs.some((x) => x.locked)) return { ok: false, reason: '잠긴 개체가 있습니다. 잠금을 풀고 다시 선택하세요.' };
    if (o.type === 'image') return { ok: false, reason: '그림은 도형 병합에 쓸 수 없습니다 (벡터 도형만).' };
    if (o.type !== 'shape' && o.type !== 'text') return { ok: false, reason: '도형과 텍스트 상자만 병합할 수 있습니다.' };
    if (o.type === 'shape' && o.shape === 'custom' && o.geometry && !o.geometry.paths.some((p) => p.fill && p.cmds.some((c) => c.c === 'Z'))) return { ok: false, reason: '닫히지 않은 자유형(열린 경로)은 병합할 수 없습니다.' };
  }
  return { ok: true, base: objs[0].name || '첫 번째 도형' };
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

/** 미리 보기 (메뉴에 마우스를 올렸을 때): 결과 윤곽만 계산 */
export async function previewMerge(op: MergeOp): Promise<MergedShape[]> {
  const objs = selectedInOrder();
  if (!mergeAvailability(objs).ok) return [];
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
  let shapes: MergedShape[];
  try {
    shapes = (await engine()).mergeObjects(op, objs).shapes;
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
  const src = styleSource(objs);
  const first = objs[0];
  const text = op !== 'fragment' && (first.type === 'shape' || first.type === 'text') && first.text.paragraphs.some((p) => p.runs.some((r) => r.text)) ? first.text : null;
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
