import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import type { ChartObject, ChartType } from '../../types/model';
import { createChart } from './chart';

export function insertChart(type: ChartType) {
  const s = useEditor.getState();
  const { width: W, height: H } = s.doc.size;
  const c = createChart(type, 0, 0, Math.min(720, W * 0.6), Math.min(420, H * 0.6));
  c.x = (W - c.width) / 2;
  c.y = (H - c.height) / 2;
  s.commit('차트 삽입', (d) => C.addObjects(d, getActiveSlide().id, [c]));
  useEditor.getState().select([c.id]);
  useEditor.getState().set({ chartEditorId: c.id });
}

export function currentChart(): ChartObject | null {
  const s = useEditor.getState();
  const id = s.chartEditorId ?? (s.selectedIds.length === 1 ? s.selectedIds[0] : null);
  const o = id ? getActiveSlide().objects.find((x) => x.id === id) : undefined;
  return o?.type === 'chart' ? o : null;
}

export function editChart(label: string, fn: (c: ChartObject) => void, id?: string) {
  const s = useEditor.getState();
  const target = id ?? currentChart()?.id;
  if (!target) return;
  s.commit(label, (d) => C.updateObjects(d, getActiveSlide().id, [target], (o) => o.type === 'chart' && fn(o)));
}
