import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import * as T from './table';
import { DEFAULT_THEME } from '../../themes/themes';
import type { TableObject } from '../../types/model';

const make = (r = 3, c = 3) => T.createTable(r, c, 0, 0, 600, DEFAULT_THEME);
const text = (t: TableObject, r: number, c: number) => t.rows[r].cells[c].text.paragraphs.map((p) => p.runs.map((x) => x.text).join('')).join('\n');
const setText = (t: TableObject, r: number, c: number, v: string) => (t.rows[r].cells[c].text.paragraphs[0].runs[0].text = v);

describe('표 엔진', () => {
  it('생성: 크기와 기본 스타일(머리글 강조색)', () => {
    const t = make(3, 4);
    expect(t.columns).toHaveLength(4);
    expect(t.rows).toHaveLength(3);
    expect(t.width).toBe(600);
    expect(t.rows[0].cells[0].fill).toEqual({ type: 'solid', color: '@accent1' }); // 테마 토큰
    expect(t.rows[0].cells[0].text.paragraphs[0].runs[0].bold).toBe(true);
  });

  it('행/열 삽입·삭제 (draft에서도 동작)', () => {
    let t = make();
    t = produce(t, (d) => T.insertRow(d, 1, DEFAULT_THEME));
    expect(t.rows).toHaveLength(4);
    expect(t.height).toBe(4 * 38);
    t = produce(t, (d) => T.insertColumn(d, 3, DEFAULT_THEME));
    expect(t.columns).toHaveLength(4);
    expect(t.rows.every((r) => r.cells.length === 4)).toBe(true);
    t = produce(t, (d) => void T.deleteRows(d, 0, 1));
    expect(t.rows).toHaveLength(2);
    t = produce(t, (d) => void T.deleteColumns(d, 1, 2));
    expect(t.columns).toHaveLength(2);
    expect(T.deleteRows(t, 0, 1)).toBe(false); // 모든 행 삭제 불가
  });

  it('셀 병합: 텍스트 합치기, 덮인 셀 표시 / 분할', () => {
    const t = make();
    setText(t, 0, 0, 'A');
    setText(t, 1, 1, 'B');
    expect(T.mergeCells(t, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(true);
    expect(t.rows[0].cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(t.rows[0].cells[1].merged).toBe(true);
    expect(t.rows[1].cells[1].merged).toBe(true);
    expect(text(t, 0, 0)).toBe('A\nB');
    expect(T.anchorOf(t, 1, 1)).toEqual([0, 0]);
    // 병합 일부만 선택해도 병합 전체로 확장
    expect(T.expandRange(t, { r1: 1, c1: 1, r2: 1, c2: 2 })).toEqual({ r1: 0, c1: 0, r2: 1, c2: 2 });
    T.splitCells(t, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(t.rows[0].cells[0].colSpan).toBeUndefined();
    expect(t.rows[1].cells[1].merged).toBe(false);
  });

  it('병합 영역 안에 행을 넣으면 병합이 늘어남, 병합된 행 삭제 시 축소', () => {
    const t = make(3, 2);
    T.mergeCells(t, { r1: 0, c1: 0, r2: 2, c2: 0 });
    T.insertRow(t, 1);
    expect(t.rows[0].cells[0].rowSpan).toBe(4);
    expect(t.rows[1].cells[0].merged).toBe(true);
    T.deleteRows(t, 1, 2);
    expect(t.rows[0].cells[0].rowSpan).toBe(2);
  });

  it('테두리: 바깥쪽 / 안쪽 / 없음', () => {
    const t = make();
    const pen = { color: '#FF0000', width: 2, dash: 'solid' as const };
    T.setBorders(t, null, 'none', null);
    T.setBorders(t, null, 'outer', pen);
    expect(t.rows[0].cells[0].borders.top).toEqual(pen);
    expect(t.rows[0].cells[0].borders.left).toEqual(pen);
    expect(t.rows[0].cells[0].borders.bottom).toBeNull();
    expect(t.rows[1].cells[1].borders.top).toBeNull();
    T.setBorders(t, null, 'inner', pen);
    expect(t.rows[1].cells[1].borders.top).toEqual(pen);
    expect(t.rows[0].cells[0].borders.top).toEqual(pen); // 바깥쪽은 유지
  });

  it('표 크기 조절은 열/행을 비례 조정', () => {
    const t = make(2, 2);
    T.scaleTable(t, 1200, 152);
    expect(t.columns).toEqual([600, 600]);
    expect(t.rows.map((r) => r.height)).toEqual([76, 76]);
  });

  it('스타일 프리셋 변경', () => {
    const t = make();
    t.style = { ...t.style!, preset: 'grid' };
    T.applyTableStyle(t, DEFAULT_THEME);
    expect(t.rows[1].cells[1].fill.type).toBe('none');
    expect(t.rows[1].cells[1].borders.left).toMatchObject({ width: 0.75 });
  });
});
