import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createPresentation, createShape } from '../document/factory';
import { addSlide } from '../commands/commands';
import { applyChange, comparePresentations, diffWords, matchSlides, similarity, slideText } from './compare';
import type { Presentation, TextObject } from '../../types/model';

const setTitle = (d: Presentation, i: number, t: string) => {
  const o = d.slides[i].objects.find((x) => x.type === 'text') as TextObject;
  o.text.paragraphs = [{ runs: [{ text: t }] } as TextObject['text']['paragraphs'][number]];
};

function original() {
  return produce(createPresentation('원본'), (d) => {
    addSlide(d, d.slides[0].id, 'titleContent');
    addSlide(d, d.slides[1].id, 'titleContent');
    setTitle(d, 0, '분기 실적 보고 2026년 3분기');
    setTitle(d, 1, '매출 현황 지역별 성장률 요약');
    setTitle(d, 2, '다음 분기 계획 및 위험 요인');
    d.slides[1].notes = '매출은 12% 늘었습니다';
  });
}

/** 검토본: ID를 모두 새로 (다른 파일에서 열면 ID가 다르므로) + 변경 */
function revised(base: Presentation) {
  const r = JSON.parse(JSON.stringify(base).replace(/"id":"([^"]+)"/g, (_m, id) => `"id":"R${id}"`).replace(/"targetId":"([^"]+)"/g, (_m, id) => `"targetId":"R${id}"`)) as Presentation;
  return produce(r, (d) => {
    setTitle(d, 1, '매출 현황 지역별 성장률 상세 요약');
    d.slides[1].notes = '매출은 15% 늘었습니다';
    const t = d.slides[0].objects.find((x) => x.type === 'text')!;
    t.x += 40;
    const star = createShape('star5', 100, 100, 120, 120);
    star.id = 'Rstar';
    d.slides[0].objects.push(star);
    // 2번과 3번 사이에 새 슬라이드, 3번 삭제
    const extra = JSON.parse(JSON.stringify(d.slides[2]));
    extra.id = 'Rnew';
    extra.objects.forEach((o: { id: string }, i: number) => (o.id = `Rnew${i}`));
    d.slides.splice(2, 1, extra);
    setTitle(d, 2, '고객 설문 결과 만족도 87%');
  });
}

describe('비교', () => {
  it('낱말 차이, 유사도', () => {
    expect(diffWords('매출은 12% 늘었습니다', '매출은 15% 늘었습니다')).toEqual([
      { op: 'same', text: '매출은 ' },
      { op: 'del', text: '12%' },
      { op: 'add', text: '15%' },
      { op: 'same', text: ' 늘었습니다' },
    ]);
    expect(similarity('a b c d', 'a b c e')).toBeCloseTo(0.75);
    expect(similarity('', '')).toBe(1);
  });

  it('슬라이드 짝짓기: ID가 달라도 내용으로, 순서 유지', () => {
    const a = original(), b = revised(original());
    expect(matchSlides(a.slides, b.slides)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('변경 목록: 삽입/삭제 슬라이드, 글자·위치·삽입 개체, 노트', () => {
    const a = original(), b = revised(a);
    const ch = comparePresentations(a, b);
    const kinds = ch.map((c) => `${c.kind}${c.slideId ? `@${a.slides.findIndex((s) => s.id === c.slideId) + 1}` : ''}`);
    expect(kinds).toEqual(['objectInserted@1', 'objectMoved@1', 'textChanged@2', 'notesChanged@2', 'slideInserted@2', 'slideDeleted@3']);
    const text = ch.find((c) => c.kind === 'textChanged')!;
    expect(text.diff!.filter((p) => p.op === 'add').map((p) => p.text.trim())).toEqual(['상세']);
    expect(ch.find((c) => c.kind === 'objectInserted')!.label).toContain('도형');
  });

  it('모두 적용 → 검토본과 같은 내용 (다시 비교하면 변경 없음)', () => {
    let a = original();
    const b = revised(a);
    // 하나씩 적용하고 다시 비교 (UI와 같은 방식)
    for (let guard = 0; guard < 20; guard++) {
      const ch = comparePresentations(a, b);
      if (!ch.length) break;
      a = produce(a, (d) => void applyChange(d, b, ch[0]));
    }
    expect(comparePresentations(a, b)).toEqual([]);
    expect(a.slides.map(slideText)).toEqual(b.slides.map(slideText));
    expect(a.slides[1].notes).toBe('매출은 15% 늘었습니다');
    // 현재 문서의 ID 체계 유지 (검토본 ID를 그대로 가져오지 않음)
    const revisedIds = new Set(b.slides.flatMap((s) => [s.id, ...s.objects.map((o) => o.id)]));
    expect(a.slides.flatMap((s) => [s.id, ...s.objects.map((o) => o.id)]).filter((id) => revisedIds.has(id))).toEqual([]);
  });

  it('PPTX로 저장했다 다시 연 같은 문서는 변경 없음 (저장 형식 차이 무시)', async () => {
    const { exportPptxBytes } = await import('../../services/export/pptxExport');
    const { importPptx } = await import('../../services/import/pptxImport');
    const a = original();
    const back = (await importPptx((await exportPptxBytes(a)).bytes)).doc;
    expect(comparePresentations(a, back)).toEqual([]);
  });

  it('적용은 선택한 변경만', () => {
    const a = original(), b = revised(a);
    const notes = comparePresentations(a, b).find((c) => c.kind === 'notesChanged')!;
    const r = produce(a, (d) => void applyChange(d, b, notes));
    expect(r.slides[1].notes).toBe('매출은 15% 늘었습니다');
    expect(slideText(r.slides[1])).toBe(slideText(a.slides[1]));
    expect(r.slides).toHaveLength(3);
  });
});
