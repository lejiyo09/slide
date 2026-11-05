/**
 * 표 관련 고수준 동작 (리본/메뉴/단축키 공용).
 * 대상: 선택된 표 1개, 범위: 셀 선택 영역(없으면 표 전체 또는 편집 중인 셀)
 */
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import * as T from './table';
import type { HAlign, Stroke, TableObject, TableStylePreset, VAlign } from '../../types/model';

const st = () => useEditor.getState();

export function currentTable(): TableObject | null {
  const s = st();
  const id = s.editingTextId ?? (s.selectedIds.length === 1 ? s.selectedIds[0] : null);
  const o = id ? getActiveSlide().objects.find((x) => x.id === id) : undefined;
  return o?.type === 'table' ? o : null;
}

export function currentRange(t: TableObject): T.CellRange | null {
  const sel = st().cellSelection;
  if (sel && sel.id === t.id) return { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 };
  return null;
}

function editTable(label: string, fn: (t: TableObject) => void, id?: string) {
  const s = st();
  const t = id ? (getActiveSlide().objects.find((o) => o.id === id) as TableObject | undefined) : currentTable();
  if (!t) return;
  const wasEditing = s.editingTextId === t.id ? s.editingCell : null;
  if (wasEditing) s.setEditingText(null); // 편집 내용 확정 후 구조 변경
  s.commit(label, (d) => C.updateObjects(d, getActiveSlide().id, [t.id], (o) => o.type === 'table' && fn(o)));
}

export function insertTable(rows: number, cols: number) {
  const s = st();
  const { width: W, height: H } = s.doc.size;
  const width = Math.min(W * 0.8, cols * 160);
  const t = T.createTable(rows, cols, (W - width) / 2, 0, width, s.doc.theme);
  t.y = Math.max(20, (H - t.height) / 2);
  s.commit('표 삽입', (d) => C.addObjects(d, getActiveSlide().id, [t]));
  st().select([t.id]);
  st().set({ cellSelection: { id: t.id, r1: 0, c1: 0, r2: 0, c2: 0 } });
}

const rangeOrAll = (t: TableObject) => currentRange(t) ?? { r1: 0, c1: 0, r2: t.rows.length - 1, c2: t.columns.length - 1 };

export async function tableInsertRow(where: 'above' | 'below', id?: string, rowIndex?: number) {
  editTable('행 삽입', (t) => {
    const r = rowIndex !== undefined ? { r1: rowIndex, r2: rowIndex } : T.expandRange(t, rangeOrAll(t));
    T.insertRow(t, where === 'above' ? r.r1 : r.r2 + 1, st().doc.theme);
  }, id);
}

export function tableInsertColumn(where: 'left' | 'right') {
  editTable('열 삽입', (t) => {
    const r = T.expandRange(t, rangeOrAll(t));
    T.insertColumn(t, where === 'left' ? r.c1 : r.c2 + 1, st().doc.theme);
  });
}

export function tableDeleteRows() {
  const t = currentTable();
  if (!t) return;
  const r = T.expandRange(t, currentRange(t) ?? rangeOrAll(t));
  if (r.r2 - r.r1 + 1 >= t.rows.length) return deleteWholeTable();
  editTable('행 삭제', (tt) => void T.deleteRows(tt, r.r1, r.r2));
  st().set({ cellSelection: null });
}

export function tableDeleteColumns() {
  const t = currentTable();
  if (!t) return;
  const r = T.expandRange(t, currentRange(t) ?? rangeOrAll(t));
  if (r.c2 - r.c1 + 1 >= t.columns.length) return deleteWholeTable();
  editTable('열 삭제', (tt) => void T.deleteColumns(tt, r.c1, r.c2));
  st().set({ cellSelection: null });
}

export function deleteWholeTable() {
  const t = currentTable();
  if (!t) return;
  st().setEditingText(null);
  st().commit('표 삭제', (d) => C.deleteObjects(d, getActiveSlide().id, [t.id]));
  st().select([]);
}

export function tableMerge() {
  const t = currentTable();
  if (!t) return;
  const r = currentRange(t);
  if (!r || (r.r1 === r.r2 && r.c1 === r.c2)) return st().toast('병합할 셀 범위를 선택하세요 (셀을 클릭한 뒤 Shift+클릭).');
  editTable('셀 병합', (tt) => void T.mergeCells(tt, r));
  const e = T.expandRange(t, r);
  st().set({ cellSelection: { id: t.id, r1: e.r1, c1: e.c1, r2: e.r1, c2: e.c1 } });
}

export function tableSplit() {
  const t = currentTable();
  if (!t) return;
  editTable('셀 분할', (tt) => void T.splitCells(tt, currentRange(tt) ?? rangeOrAll(tt)));
}

export function tableBorders(mode: T.BorderMode, stroke: Stroke | null) {
  editTable('테두리', (t) => T.setBorders(t, currentRange(t), mode, stroke));
}

export function tableFill(color: string | null) {
  editTable('셀 음영', (t) => T.setCellFill(t, currentRange(t), color ? { type: 'solid', color } : { type: 'none' }));
}

export function tableAlign(h?: HAlign, v?: VAlign) {
  editTable('셀 맞춤', (t) =>
    T.forEachCell(t, currentRange(t), (cell) => {
      if (h) cell.text.paragraphs.forEach((p) => (p.align = h));
      if (v) cell.text.vAlign = v;
    }),
  );
}

export function tableDistribute(what: 'rows' | 'cols') {
  editTable(what === 'rows' ? '행 높이를 같게' : '열 너비를 같게', (t) => (what === 'rows' ? T.distributeRows(t) : T.distributeColumns(t)));
}

export function tableStyle(patch: Partial<NonNullable<TableObject['style']>> & { preset?: TableStylePreset }) {
  editTable('표 스타일', (t) => {
    t.style = { ...(t.style ?? { preset: 'medium2', accent: 1, firstRow: true, bandRows: true, firstCol: false, lastRow: false }), ...patch };
    T.applyTableStyle(t, st().doc.theme);
  });
}

export function setCellSelectionFromPoint(tableId: string, r: number, c: number, extend: boolean) {
  const s = st();
  const sel = s.cellSelection;
  if (extend && sel && sel.id === tableId) s.set({ cellSelection: { id: tableId, r1: sel.r1, c1: sel.c1, r2: r, c2: c } });
  else s.set({ cellSelection: { id: tableId, r1: r, c1: c, r2: r, c2: c } });
}
