/**
 * 표 엔진: 생성, 행/열 추가·삭제, 셀 병합/분할, 테두리, 채우기, 스타일 프리셋.
 * 모든 함수는 TableObject(또는 immer draft)를 직접 수정하는 순수 함수다.
 */
import type { CellBorders, Color, Fill, Stroke, TableCell, TableObject, TableStylePreset, Theme } from '../../types/model';
import { paragraph, textBody } from '../../core/document/factory';
import { newId } from '../../utils/id';
import { deepClone } from '../../utils/clone';

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const normRange = (r: CellRange): CellRange => ({
  r1: Math.min(r.r1, r.r2),
  c1: Math.min(r.c1, r.c2),
  r2: Math.max(r.r1, r.r2),
  c2: Math.max(r.c1, r.c2),
});

const noBorders = (): CellBorders => ({ top: null, right: null, bottom: null, left: null });

export function createCell(theme?: Theme, fontSize = 18): TableCell {
  return {
    text: textBody([paragraph('', { fontSize, color: theme?.colors.dark1 ?? '#000000', fontFamily: theme?.fonts.body })], {
      vAlign: 'top',
      padding: { top: 4.8, right: 9.6, bottom: 4.8, left: 9.6 },
    }),
    fill: { type: 'none' },
    borders: noBorders(),
  };
}

export function createTable(rows: number, cols: number, x: number, y: number, width: number, theme: Theme): TableObject {
  const rowH = 38;
  const t: TableObject = {
    id: newId(),
    type: 'table',
    name: '표',
    x,
    y,
    width,
    height: rowH * rows,
    rotation: 0,
    columns: Array.from({ length: cols }, () => width / cols),
    rows: Array.from({ length: rows }, () => ({ height: rowH, cells: Array.from({ length: cols }, () => createCell(theme)) })),
    style: { preset: 'medium2', accent: 1, firstRow: true, bandRows: true, firstCol: false, lastRow: false },
  };
  applyTableStyle(t, theme);
  return t;
}

export const tableHeight = (t: TableObject) => t.rows.reduce((a, r) => a + r.height, 0);
export const tableWidth = (t: TableObject) => t.columns.reduce((a, c) => a + c, 0);

/** 병합 정보를 고려해 (r, c)를 덮는 기준 셀 좌표 */
export function anchorOf(t: TableObject, r: number, c: number): [number, number] {
  for (let rr = r; rr >= 0; rr--)
    for (let cc = c; cc >= 0; cc--) {
      const cell = t.rows[rr]?.cells[cc];
      if (!cell || cell.merged) continue;
      if (rr + (cell.rowSpan ?? 1) > r && cc + (cell.colSpan ?? 1) > c) return [rr, cc];
    }
  return [r, c];
}

/** 병합 셀을 포함하도록 범위 확장 */
export function expandRange(t: TableObject, range: CellRange): CellRange {
  let { r1, c1, r2, c2 } = normRange(range);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const [ar, ac] = anchorOf(t, r, c);
        const a = t.rows[ar].cells[ac];
        const er = ar + (a.rowSpan ?? 1) - 1, ec = ac + (a.colSpan ?? 1) - 1;
        if (ar < r1) (r1 = ar), (changed = true);
        if (ac < c1) (c1 = ac), (changed = true);
        if (er > r2) (r2 = er), (changed = true);
        if (ec > c2) (c2 = ec), (changed = true);
      }
  }
  return { r1, c1, r2, c2 };
}

function syncHeight(t: TableObject) {
  t.height = tableHeight(t);
  t.width = tableWidth(t);
}

/* ───────────── 행/열 ───────────── */

export function insertRow(t: TableObject, at: number, theme?: Theme) {
  const ref = t.rows[Math.min(Math.max(at - 1, 0), t.rows.length - 1)];
  const row = {
    height: ref?.height ?? 38,
    cells: t.columns.map((_, c) => {
      const cell = createCell(theme, ref?.cells[c]?.text.paragraphs[0]?.runs[0]?.fontSize ?? 18);
      if (ref) {
        cell.fill = deepClone(ref.cells[c].fill);
        cell.borders = deepClone(ref.cells[c].borders);
        const run = ref.cells[c].text.paragraphs[0]?.runs[0];
        if (run) Object.assign(cell.text.paragraphs[0].runs[0], { ...run, text: '' });
      }
      return cell;
    }),
  };
  // 병합 영역 안에 삽입되면 해당 병합을 확장
  if (at > 0 && at < t.rows.length) {
    for (let c = 0; c < t.columns.length; c++) {
      const [ar, ac] = anchorOf(t, at, c);
      if (ar < at) {
        const a = t.rows[ar].cells[ac];
        if (ac === c) a.rowSpan = (a.rowSpan ?? 1) + 1;
        row.cells[c].merged = true;
      }
    }
  }
  t.rows.splice(at, 0, row);
  syncHeight(t);
}

export function insertColumn(t: TableObject, at: number, theme?: Theme) {
  const refIdx = Math.min(Math.max(at - 1, 0), t.columns.length - 1);
  const width = t.columns[refIdx] ?? 120;
  t.rows.forEach((row, r) => {
    const ref = row.cells[refIdx];
    const cell = createCell(theme, ref?.text.paragraphs[0]?.runs[0]?.fontSize ?? 18);
    if (ref) {
      cell.fill = deepClone(ref.fill);
      cell.borders = deepClone(ref.borders);
      const run = ref.text.paragraphs[0]?.runs[0];
      if (run) Object.assign(cell.text.paragraphs[0].runs[0], { ...run, text: '' });
    }
    if (at > 0 && at < t.columns.length) {
      const [ar, ac] = anchorOf(t, r, at);
      if (ac < at) {
        const a = t.rows[ar].cells[ac];
        if (ar === r) a.colSpan = (a.colSpan ?? 1) + 1;
        cell.merged = true;
      }
    }
    row.cells.splice(at, 0, cell);
  });
  t.columns.splice(at, 0, width);
  syncHeight(t);
}

export function deleteRows(t: TableObject, r1: number, r2: number) {
  if (r2 - r1 + 1 >= t.rows.length) return false;
  // 삭제 범위에 걸친 병합 조정
  for (let c = 0; c < t.columns.length; c++) {
    for (let r = 0; r < t.rows.length; r++) {
      const cell = t.rows[r].cells[c];
      if (cell.merged || (cell.rowSpan ?? 1) === 1) continue;
      const end = r + (cell.rowSpan ?? 1) - 1;
      const overlap = Math.max(0, Math.min(end, r2) - Math.max(r, r1) + 1);
      if (r >= r1 && r <= r2 && end > r2) {
        // 기준 셀이 삭제됨 → 병합을 첫 남은 행으로 이동
        const next = t.rows[r2 + 1].cells[c];
        Object.assign(next, { ...deepClone(cell), merged: false, rowSpan: end - r2 });
      } else cell.rowSpan = (cell.rowSpan ?? 1) - overlap;
      if (cell.rowSpan === 1) delete cell.rowSpan;
    }
  }
  t.rows.splice(r1, r2 - r1 + 1);
  syncHeight(t);
  return true;
}

export function deleteColumns(t: TableObject, c1: number, c2: number) {
  if (c2 - c1 + 1 >= t.columns.length) return false;
  for (const row of t.rows) {
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      if (cell.merged || (cell.colSpan ?? 1) === 1) continue;
      const end = c + (cell.colSpan ?? 1) - 1;
      const overlap = Math.max(0, Math.min(end, c2) - Math.max(c, c1) + 1);
      if (c >= c1 && c <= c2 && end > c2) {
        const next = row.cells[c2 + 1];
        Object.assign(next, { ...deepClone(cell), merged: false, colSpan: end - c2 });
      } else cell.colSpan = (cell.colSpan ?? 1) - overlap;
      if (cell.colSpan === 1) delete cell.colSpan;
    }
    row.cells.splice(c1, c2 - c1 + 1);
  }
  const removed = t.columns.splice(c1, c2 - c1 + 1).reduce((a, b) => a + b, 0);
  void removed;
  syncHeight(t);
  return true;
}

/* ───────────── 병합/분할 ───────────── */

export function mergeCells(t: TableObject, range: CellRange): boolean {
  const { r1, c1, r2, c2 } = expandRange(t, range);
  if (r1 === r2 && c1 === c2) return false;
  const anchor = t.rows[r1].cells[c1];
  // 텍스트 합치기 (비어 있지 않은 셀의 문단을 이어 붙임)
  const extra = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      if (r === r1 && c === c1) continue;
      const cell = t.rows[r].cells[c];
      if (!cell.merged && cell.text.paragraphs.some((p) => p.runs.some((x) => x.text))) extra.push(...deepClone(cell.text.paragraphs));
      // 병합되어 덮이는 셀은 텍스트를 비움
      cell.merged = true;
      delete cell.colSpan;
      delete cell.rowSpan;
      cell.text.paragraphs = [{ ...cell.text.paragraphs[0], runs: [{ ...cell.text.paragraphs[0].runs[0], text: '' }] }];
    }
  if (extra.length) {
    const empty = anchor.text.paragraphs.every((p) => p.runs.every((x) => !x.text));
    anchor.text.paragraphs = empty ? extra : [...anchor.text.paragraphs, ...extra];
  }
  anchor.colSpan = c2 - c1 + 1;
  anchor.rowSpan = r2 - r1 + 1;
  if (anchor.colSpan === 1) delete anchor.colSpan;
  if (anchor.rowSpan === 1) delete anchor.rowSpan;
  return true;
}

export function splitCells(t: TableObject, range: CellRange): boolean {
  const { r1, c1, r2, c2 } = expandRange(t, range);
  let changed = false;
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const cell = t.rows[r].cells[c];
      if (cell.merged) {
        cell.merged = false;
        changed = true;
      }
      if (cell.colSpan || cell.rowSpan) {
        delete cell.colSpan;
        delete cell.rowSpan;
        changed = true;
      }
    }
  return changed;
}

/* ───────────── 셀 서식 ───────────── */

export function forEachCell(t: TableObject, range: CellRange | null, fn: (cell: TableCell, r: number, c: number) => void) {
  const { r1, c1, r2, c2 } = range ? expandRange(t, range) : { r1: 0, c1: 0, r2: t.rows.length - 1, c2: t.columns.length - 1 };
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(t.rows[r].cells[c], r, c);
}

export type BorderMode = 'all' | 'outer' | 'inner' | 'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV' | 'none';

export function setBorders(t: TableObject, range: CellRange | null, mode: BorderMode, stroke: Stroke | null) {
  const R = range ? expandRange(t, range) : { r1: 0, c1: 0, r2: t.rows.length - 1, c2: t.columns.length - 1 };
  const s = () => (stroke ? { ...stroke } : null);
  forEachCell(t, R, (cell, r, c) => {
    const b = cell.borders;
    const top = r === R.r1, bottom = r === R.r2, left = c === R.c1, right = c === R.c2;
    switch (mode) {
      case 'none':
        b.top = b.bottom = b.left = b.right = null;
        break;
      case 'all':
        b.top = s(); b.bottom = s(); b.left = s(); b.right = s();
        break;
      case 'outer':
        if (top) b.top = s();
        if (bottom) b.bottom = s();
        if (left) b.left = s();
        if (right) b.right = s();
        break;
      case 'inner':
        if (!top) b.top = s();
        if (!bottom) b.bottom = s();
        if (!left) b.left = s();
        if (!right) b.right = s();
        break;
      case 'insideH':
        if (!top) b.top = s();
        if (!bottom) b.bottom = s();
        break;
      case 'insideV':
        if (!left) b.left = s();
        if (!right) b.right = s();
        break;
      case 'top':
        if (top) b.top = s();
        break;
      case 'bottom':
        if (bottom) b.bottom = s();
        break;
      case 'left':
        if (left) b.left = s();
        break;
      case 'right':
        if (right) b.right = s();
        break;
    }
  });
}

export function setCellFill(t: TableObject, range: CellRange | null, fill: Fill) {
  forEachCell(t, range, (cell) => (cell.fill = deepClone(fill)));
}

export function distributeColumns(t: TableObject) {
  const w = tableWidth(t) / t.columns.length;
  t.columns = t.columns.map(() => w);
}

export function distributeRows(t: TableObject) {
  const h = tableHeight(t) / t.rows.length;
  t.rows.forEach((r) => (r.height = h));
}

/** 표 전체 크기 조절: 열 너비/행 높이를 비례 조정 */
export function scaleTable(t: TableObject, width: number, height: number) {
  const sx = width / Math.max(1, tableWidth(t));
  const sy = height / Math.max(1, tableHeight(t));
  t.columns = t.columns.map((c) => Math.max(8, c * sx));
  t.rows.forEach((r) => (r.height = Math.max(8, r.height * sy)));
  syncHeight(t);
}

/* ───────────── 스타일 프리셋 ───────────── */

function mix(hex: Color, toward: Color, amount: number): Color {
  const a = hex.replace('#', ''), b = toward.replace('#', '');
  const ch = (i: number) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
}

export const TABLE_PRESETS: { id: TableStylePreset; name: string }[] = [
  { id: 'medium2', name: '보통 스타일 2' },
  { id: 'light1', name: '밝은 스타일 1' },
  { id: 'grid', name: '표 눈금' },
  { id: 'dark1', name: '어두운 스타일 1' },
  { id: 'plain', name: '스타일 없음' },
];

/** 테마 강조색 기반 표 스타일을 셀 서식으로 구워 넣음 (PowerPoint 기본 스타일 근사) */
export function applyTableStyle(t: TableObject, theme: Theme) {
  const st = t.style ?? { preset: 'medium2', accent: 1, firstRow: true, bandRows: true, firstCol: false, lastRow: false };
  const accent = (theme.colors as unknown as Record<string, string>)[`accent${st.accent}`] ?? theme.colors.accent1;
  const white = '#FFFFFF';
  const text = theme.colors.dark1;
  const last = t.rows.length - 1;
  t.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      const header = st.firstRow && r === 0;
      const footer = st.lastRow && r === last && r > 0;
      const firstCol = st.firstCol && c === 0;
      const dataIdx = r - (st.firstRow ? 1 : 0);
      const band = st.bandRows && dataIdx % 2 === 0;
      let fill: Fill = { type: 'none' };
      let color = text;
      let bold = false;
      let borders: CellBorders = noBorders();
      const line = (col: Color, w = 1): Stroke => ({ color: col, width: w, dash: 'solid' });
      switch (st.preset) {
        case 'medium2':
          fill = { type: 'solid', color: header || footer ? accent : band ? mix(accent, white, 0.6) : mix(accent, white, 0.8) };
          if (header || footer) (color = white), (bold = true);
          borders = { top: line(white), bottom: line(white), left: line(white), right: line(white) };
          break;
        case 'light1':
          if (header) bold = true;
          fill = band && !header ? { type: 'solid', color: mix(accent, white, 0.8) } : { type: 'none' };
          borders = { top: r === 0 ? line(accent) : null, bottom: header || r === last ? line(accent) : null, left: null, right: null };
          break;
        case 'grid':
          if (header) bold = true;
          borders = { top: line(text, 0.75), bottom: line(text, 0.75), left: line(text, 0.75), right: line(text, 0.75) };
          break;
        case 'dark1':
          fill = { type: 'solid', color: header ? '#000000' : band ? mix(accent, '#000000', 0.25) : accent };
          color = white;
          if (header) bold = true;
          borders = { top: line(white), bottom: line(white), left: line(white), right: line(white) };
          break;
        case 'plain':
          break;
      }
      if (firstCol) bold = true;
      cell.fill = fill;
      cell.borders = borders;
      for (const p of cell.text.paragraphs)
        for (const run of p.runs) {
          run.color = color;
          run.bold = bold || undefined;
        }
    }),
  );
}
