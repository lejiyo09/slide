/**
 * 차트 데이터 편집기: 스프레드시트 형태의 격자.
 * - 첫 행: 계열 이름, 첫 열: 항목(분산형은 X 값)
 * - Excel/스프레드시트에서 복사한 표(탭 구분)를 붙여넣기 가능
 * - 적용 시 하나의 실행 취소 단계로 기록
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { Dialog } from './Dialog';
import { useEditor } from '../../core/store/editorStore';
import { editChart } from '../../editors/chart/chartActions';
import { isRadial } from '../../editors/chart/chart';
import { ChartView } from '../../engines/rendering/ChartView';
import type { ChartObject } from '../../types/model';

type Grid = string[][];

function toGrid(c: ChartObject): Grid {
  const scatter = c.chartType === 'scatter';
  const header = [scatter ? 'X 값' : '', ...c.series.map((s) => s.name)];
  const n = scatter ? Math.max(...c.series.map((s) => s.values.length), 0) : c.categories.length;
  const rows = Array.from({ length: n }, (_, i) => [
    scatter ? String(c.series[0]?.xValues?.[i] ?? c.categories[i] ?? i + 1) : c.categories[i] ?? '',
    ...c.series.map((s) => (s.values[i] === undefined || Number.isNaN(s.values[i]) ? '' : String(s.values[i]))),
  ]);
  return [header, ...rows];
}

function fromGrid(g: Grid, c: ChartObject): Pick<ChartObject, 'categories' | 'series'> {
  const scatter = c.chartType === 'scatter';
  const body = g.slice(1).filter((r) => r.some((v) => v.trim() !== ''));
  const num = (v: string) => {
    const n = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const series = g[0].slice(1).map((name, si) => ({
    ...(c.series[si] ?? {}),
    name: name || `계열 ${si + 1}`,
    values: body.map((r) => num(r[si + 1] ?? '')),
    ...(scatter ? { xValues: body.map((r) => num(r[0] ?? '')) } : {}),
  }));
  return { categories: body.map((r) => r[0] ?? ''), series: series.map((s) => (scatter ? s : { ...s, xValues: undefined })) };
}

export function ChartDataEditor() {
  const id = useEditor((s) => s.chartEditorId);
  const chart = useEditor((s) => {
    const slide = s.doc.slides.find((x) => x.id === s.activeSlideId);
    const o = slide?.objects.find((x) => x.id === s.chartEditorId);
    return o?.type === 'chart' ? o : null;
  });
  const theme = useEditor((s) => s.doc.theme);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (chart) {
      setGrid(toGrid(chart));
      setTitle(chart.title ?? '');
    } else setGrid(null);
    // 창을 열 때 한 번만 초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const preview = useMemo(() => (chart && grid ? { ...chart, ...fromGrid(grid, chart), title, width: 360, height: 220 } : null), [chart, grid, title]);
  if (!id || !chart || !grid) return null;
  const close = () => useEditor.getState().set({ chartEditorId: null });
  const radial = isRadial(chart.chartType);
  const set = (r: number, c: number, v: string) => setGrid((g) => g!.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)));
  const addRow = () => setGrid((g) => [...g!, g![0].map(() => '')]);
  const delRow = () => setGrid((g) => (g!.length > 2 ? g!.slice(0, -1) : g));
  const addCol = () => setGrid((g) => g!.map((row, i) => [...row, i === 0 ? `계열 ${row.length}` : '']));
  const delCol = () => setGrid((g) => (g![0].length > 2 ? g!.map((row) => row.slice(0, -1)) : g));
  const onPaste = (e: React.ClipboardEvent, r0: number, c0: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    setGrid((g) => {
      const out = g!.map((r) => [...r]);
      const width = Math.max(out[0].length, c0 + Math.max(...rows.map((r) => r.length)));
      while (out.length < r0 + rows.length) out.push(Array(width).fill(''));
      out.forEach((r) => {
        while (r.length < width) r.push('');
      });
      rows.forEach((row, i) => row.forEach((v, j) => (out[r0 + i][c0 + j] = v)));
      return out;
    });
  };
  const apply = () => {
    const data = fromGrid(grid, chart);
    editChart('차트 데이터 편집', (c) => {
      c.categories = data.categories;
      c.series = data.series;
      c.title = title;
    }, chart.id);
    close();
  };
  return (
    <Dialog title="차트 데이터 편집" onClose={close} onOk={apply} okLabel="적용">
      <div className="chart-editor">
        <div className="ce-left">
          <label className="field">
            <span>차트 제목</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <div className="ce-grid-wrap">
            <table className="ce-grid">
              <tbody>
                {grid.map((row, r) => (
                  <tr key={r}>
                    {row.map((v, c) => (
                      <td key={c} className={r === 0 || c === 0 ? 'ce-head' : ''}>
                        <input
                          value={v}
                          aria-label={`${r + 1}행 ${c + 1}열`}
                          placeholder={r === 0 && c === 0 ? '' : r === 0 ? '계열 이름' : c === 0 ? (chart.chartType === 'scatter' ? 'X' : '항목') : '0'}
                          disabled={r === 0 && c === 0}
                          inputMode={r > 0 && c > 0 ? 'decimal' : undefined}
                          onChange={(e) => set(r, c, e.target.value)}
                          onPaste={(e) => onPaste(e, r, c)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const next = (e.target as HTMLElement).closest('tr')?.nextElementSibling?.children[c]?.querySelector('input');
                              (next as HTMLInputElement | undefined)?.focus();
                            }
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ce-actions">
            <button type="button" className="btn btn-sm" onClick={addRow}>
              <Plus size={13} /> {radial || chart.chartType !== 'scatter' ? '항목' : '점'} 추가
            </button>
            <button type="button" className="btn btn-sm" onClick={delRow}>
              <Minus size={13} /> 마지막 행 삭제
            </button>
            {!radial && (
              <>
                <button type="button" className="btn btn-sm" onClick={addCol}>
                  <Plus size={13} /> 계열 추가
                </button>
                <button type="button" className="btn btn-sm" onClick={delCol}>
                  <Minus size={13} /> 마지막 계열 삭제
                </button>
              </>
            )}
          </div>
          <p className="muted ce-hint">Excel 등에서 복사한 표를 셀에 붙여넣을 수 있습니다. {radial && '원형/도넛형은 첫 번째 계열만 사용합니다.'}</p>
        </div>
        <div className="ce-preview">{preview && <div style={{ position: 'relative', width: 360, height: 220 }}><ChartView chart={preview} theme={theme} /></div>}</div>
      </div>
    </Dialog>
  );
}
