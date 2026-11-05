import type { SlideObject } from '../../types/model';

/** 위치·크기·이름 등 배치 정보를 제외한 '내용' 지문. 가져온 뒤 내용이 바뀌었는지 판단한다. */
const LAYOUT_KEYS = new Set(['id', 'name', 'x', 'y', 'width', 'height', 'rotation', 'flipH', 'flipV', 'preserved', 'sourceId', 'opacity', 'locked', 'hidden', 'link']);

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = stable(x);
    }
    return out;
  }
  return v;
}

export function contentFingerprint(o: SlideObject): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!LAYOUT_KEYS.has(k)) rest[k] = v;
  return JSON.stringify(stable(rest));
}

/** 원본 XML로 복원 가능한가 (내용 변경 없음) */
export const isPristine = (o: SlideObject) => !!o.preserved && o.preserved.fingerprint === contentFingerprint(o);
