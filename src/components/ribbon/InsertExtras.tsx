import { lazy, Suspense, useState } from 'react';
import { BarChart3, BarChartHorizontal, LineChart, AreaChart, PieChart, Donut, ScatterChart } from 'lucide-react';
import type { ChartType } from '../../types/model';
import { CHART_TYPES } from '../../editors/chart/chart';
import { insertTable } from '../../editors/table/tableActions';
import { insertChart } from '../../editors/chart/chartActions';
import { MenuItem, MenuSeparator } from '../common/Buttons';
import { Dialog } from '../dialogs/Dialog';
import { useEditor } from '../../core/store/editorStore';
import { applyFormat } from '../../editors/text/formatting';
import { getEditorSession } from '../../editors/text/editorSession';

/** 표 삽입: 마우스로 행×열 선택 (PowerPoint와 같은 격자) */
export function TableGridPicker({ close }: { close: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const [dialog, setDialog] = useState(false);
  const R = 8, Cn = 10;
  if (dialog) return <InsertTableDialog onClose={() => (setDialog(false), close())} />;
  return (
    <div className="table-picker">
      <div className="tp-title">{hover[0] ? `${hover[1]}×${hover[0]} 표` : '표 삽입'}</div>
      <div className="tp-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: R }, (_, r) =>
          Array.from({ length: Cn }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`tp-cell ${r < hover[0] && c < hover[1] ? 'on' : ''}`}
              aria-label={`${c + 1}열 ${r + 1}행 표`}
              onMouseEnter={() => setHover([r + 1, c + 1])}
              onClick={() => {
                insertTable(r + 1, c + 1);
                close();
              }}
            />
          )),
        )}
      </div>
      <MenuSeparator />
      <MenuItem label="표 삽입…" onClick={() => setDialog(true)} />
    </div>
  );
}

function InsertTableDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('4');
  const ok = () => {
    const r = Math.max(1, Math.min(50, parseInt(rows, 10) || 0));
    const c = Math.max(1, Math.min(30, parseInt(cols, 10) || 0));
    insertTable(r, c);
    onClose();
  };
  return (
    <Dialog title="표 삽입" onClose={onClose} onOk={ok}>
      <label className="field">
        <span>열 개수 (1~30)</span>
        <input value={cols} onChange={(e) => setCols(e.target.value)} inputMode="numeric" autoFocus />
      </label>
      <label className="field">
        <span>행 개수 (1~50)</span>
        <input value={rows} onChange={(e) => setRows(e.target.value)} inputMode="numeric" />
      </label>
    </Dialog>
  );
}

export const CHART_ICONS: Record<ChartType, React.ReactNode> = {
  column: <BarChart3 size={18} />,
  bar: <BarChartHorizontal size={18} />,
  line: <LineChart size={18} />,
  area: <AreaChart size={18} />,
  pie: <PieChart size={18} />,
  doughnut: <Donut size={18} />,
  scatter: <ScatterChart size={18} />,
};

export function ChartTypeMenu({ close, onPick }: { close: () => void; onPick?: (t: ChartType) => void }) {
  return (
    <div className="menu">
      {CHART_TYPES.map((t) => (
        <MenuItem key={t.id} icon={CHART_ICONS[t.id]} label={t.name} onClick={() => ((onPick ?? insertChart)(t.id), close())} />
      ))}
    </div>
  );
}

/** 하이퍼링크 삽입 */
export function LinkDialog({ onClose: close }: { onClose: () => void }) {
  // 취소 시 고정한 선택 영역 해제
  const onClose = () => {
    const sess = getEditorSession();
    if (sess) sess.locked = false;
    close();
  };
  const editing = !!useEditor.getState().editingTextId;
  const [url, setUrl] = useState('https://');
  const ok = () => {
    const v = url.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(v) || v === 'https://') {
      useEditor.getState().toast('http://, https:// 또는 mailto:로 시작하는 주소를 입력하세요.', 'warning');
      return;
    }
    applyFormat({ type: 'link', url: v });
    onClose();
  };
  return (
    <Dialog title="링크" onClose={onClose} onOk={ok} okLabel="삽입">
      <p className="muted" style={{ marginTop: 0 }}>
        {editing ? '선택한 텍스트에 링크를 겁니다.' : '선택한 개체 전체에 링크를 겁니다 (슬라이드 쇼에서 클릭하면 열림).'}
      </p>
      <label className="field">
        <span>주소</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
      </label>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          applyFormat({ type: 'link', url: null });
          onClose();
        }}
      >
        링크 제거
      </button>
    </Dialog>
  );
}

const IconPickerLazy = lazy(() => import('./IconPicker'));

export function IconPickerDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="아이콘 삽입" onClose={onClose}>
      <Suspense fallback={<p className="muted">아이콘 불러오는 중…</p>}>
        <IconPickerLazy onDone={onClose} />
      </Suspense>
    </Dialog>
  );
}
