import type { SlideObject } from '../../types/model';

/** 슬라이드 타이밍(p:timing)에 기록되는 미디어 재생 설정 지문: 자동 재생·쇼 중 숨기기·반복 */
export function mediaPlaybackSignature(objects: SlideObject[]): string {
  return JSON.stringify(objects.filter((o) => o.type === 'media' && (o.autoPlay || o.hideInShow || o.loop)).map((o) => (o.type === 'media' ? [o.id, !!o.autoPlay, !!o.hideInShow, !!o.loop] : [])));
}

/** 위치·크기·이름 등 배치 정보를 제외한 '내용' 지문. 가져온 뒤 내용이 바뀌었는지 판단한다. */
const LAYOUT_KEYS = new Set(['id', 'name', 'x', 'y', 'width', 'height', 'rotation', 'flipH', 'flipV', 'preserved', 'sourceId', 'opacity', 'locked', 'hidden', 'link',
  // 재생 설정은 도형 XML이 아니라 슬라이드 타이밍에 기록됨
  'autoPlay', 'loop', 'hideInShow', 'narration']);

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
