/** 가져오기 결과 보고서 (UI에서 가볍게 import할 수 있도록 분리) */
import type { UnsupportedKind } from '../../types/model';

export interface ImportReport {
  fileName: string;
  slides: number;
  objects: number;
  unsupported: Partial<Record<UnsupportedKind, number>>;
  preservedTransitions: number;
  preservedTimings: number;
  approximated: string[];
  warnings: string[];
}

/** UI 표시용 요약 */
export function summarizeReport(r: ImportReport): string[] {
  const names: Record<UnsupportedKind, string> = { table: '표', chart: '차트', smartart: 'SmartArt', media: '오디오/비디오', ole: 'OLE 개체', image: 'EMF/WMF 그림', other: '기타 개체' };
  const lines: string[] = [];
  for (const [k, n] of Object.entries(r.unsupported)) lines.push(`${names[k as UnsupportedKind]} ${n}개: 편집은 아직 지원하지 않지만 원본 그대로 보존되며, PPTX로 저장하면 복원됩니다. (이동·크기 조절·삭제 가능)`);
  if (r.preservedTransitions) lines.push(`슬라이드 전환 ${r.preservedTransitions}개: 원본 보존 (편집·미리 보기는 10단계)`);
  if (r.preservedTimings) lines.push(`애니메이션이 있는 슬라이드 ${r.preservedTimings}개: 원본 보존 (편집·재생은 10단계, 대상 개체를 삭제하면 해당 애니메이션은 저장되지 않음)`);
  return [...lines, ...r.approximated, ...r.warnings];
}
