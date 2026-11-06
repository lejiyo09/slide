/** 가져오기 결과 보고서 (UI에서 가볍게 import할 수 있도록 분리) */
import type { UnsupportedKind } from '../../types/model';

export interface ImportReport {
  fileName: string;
  slides: number;
  objects: number;
  unsupported: Partial<Record<UnsupportedKind, number>>;
  /** 편집 가능한 개체로 변환한 표·차트·미디어 */
  converted: Partial<Record<'table' | 'chart' | 'media', number>>;
  preservedTransitions: number;
  preservedTimings: number;
  approximated: string[];
  warnings: string[];
  /** 파일에 포함되어 있던 글꼴 (내 글꼴에 추가됨) */
  embeddedFonts?: string[];
}

/** UI 표시용 요약 */
export function summarizeReport(r: ImportReport): string[] {
  const names: Record<UnsupportedKind, string> = { table: '표', chart: '차트', smartart: 'SmartArt', media: '오디오/비디오', ole: 'OLE 개체', image: 'EMF/WMF 그림', other: '기타 개체' };
  const lines: string[] = [];
  const conv = { table: '표', chart: '차트', media: '오디오/비디오' } as const;
  for (const [k, n] of Object.entries(r.converted ?? {}))
    lines.push(`${conv[k as keyof typeof conv]} ${n}개: 편집할 수 있게 가져왔습니다. 내용을 바꾸지 않으면 저장 시 원본 서식 그대로 복원됩니다.`);
  for (const [k, n] of Object.entries(r.unsupported)) lines.push(`${names[k as UnsupportedKind]} ${n}개: 편집은 아직 지원하지 않지만 원본 그대로 보존되며, PPTX로 저장하면 복원됩니다. (이동·크기 조절·삭제 가능)`);
  if (r.preservedTransitions) lines.push(`슬라이드 전환 ${r.preservedTransitions}개: 편집·재생할 수 있게 가져왔습니다 (바꾸지 않으면 저장 시 원본 그대로).`);
  if (r.preservedTimings) lines.push(`애니메이션이 있는 슬라이드 ${r.preservedTimings}개: 애니메이션 창에서 편집·재생할 수 있습니다 (바꾸지 않으면 저장 시 원본 그대로).`);
  if (r.embeddedFonts?.length) lines.push(`포함 글꼴 ${r.embeddedFonts.length}개(${r.embeddedFonts.join(', ')}): 파일에서 꺼내 '내 글꼴'에 추가했습니다.`);
  return [...lines, ...r.approximated, ...r.warnings];
}
