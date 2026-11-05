/** 상황별 탭: 표 디자인 / 레이아웃, 차트 디자인, 재생 */
import {
  ArrowDownToLine, ArrowUpToLine, ArrowLeftToLine, ArrowRightToLine, Trash2, Merge, Split, PaintBucket, Grid3x3, Square, SquareDashed,
  AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Columns3, Rows3,
  Table2, Database, Type, Play, Repeat, Clapperboard,
} from 'lucide-react';
import { RibbonButton, DropdownButton, RibbonGroup, SplitButton, MenuItem, MenuSeparator } from '../common/Buttons';
import { ColorPanel, ColorBarIcon } from '../common/ColorPicker';
import { useEditor, useSelectedObjects } from '../../core/store/editorStore';
import * as TA from '../../editors/table/tableActions';
import { TABLE_PRESETS, type BorderMode } from '../../editors/table/table';
import { editChart } from '../../editors/chart/chartActions';
import { CHART_TYPES, isRadial } from '../../editors/chart/chart';
import { ChartTypeMenu, CHART_ICONS } from './InsertExtras';
import type { MediaObject, Stroke, TableObject } from '../../types/model';
import { useState } from 'react';
import { getActiveSlide } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';

const BORDER_MODES: { id: BorderMode; label: string }[] = [
  { id: 'all', label: '모든 테두리' },
  { id: 'outer', label: '바깥쪽 테두리' },
  { id: 'inner', label: '안쪽 테두리' },
  { id: 'top', label: '위쪽 테두리' },
  { id: 'bottom', label: '아래쪽 테두리' },
  { id: 'left', label: '왼쪽 테두리' },
  { id: 'right', label: '오른쪽 테두리' },
  { id: 'insideH', label: '안쪽 가로 테두리' },
  { id: 'insideV', label: '안쪽 세로 테두리' },
  { id: 'none', label: '테두리 없음' },
];

export function TableDesignTab({ table }: { table: TableObject }) {
  const theme = useEditor((s) => s.doc.theme);
  const st = table.style ?? { preset: 'medium2', accent: 1, firstRow: true, bandRows: true, firstCol: false, lastRow: false };
  const [pen, setPen] = useState<Stroke>({ color: '#000000', width: 1, dash: 'solid' });
  const [shade, setShade] = useState('#FFC000');
  const accents = [theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4, theme.colors.accent5, theme.colors.accent6];
  return (
    <>
      <RibbonGroup label="표 스타일 옵션">
        <div className="rb-col check-col">
          {(
            [
              ['firstRow', '머리글 행'],
              ['lastRow', '요약 행'],
              ['bandRows', '줄무늬 행'],
              ['firstCol', '첫째 열'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="rb-check">
              <input type="checkbox" checked={!!st[k]} onChange={(e) => TA.tableStyle({ [k]: e.target.checked })} /> {label}
            </label>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="표 스타일">
        <div className="table-style-row">
          {TABLE_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`ts-item ${st.preset === p.id ? 'is-active' : ''}`} title={p.name} onClick={() => TA.tableStyle({ preset: p.id })}>
              <TableStyleThumb preset={p.id} color={accents[st.accent - 1] ?? accents[0]} />
            </button>
          ))}
        </div>
        <div className="accent-row">
          {accents.map((c, i) => (
            <button key={i} type="button" className={`swatch ${st.accent === i + 1 ? 'is-active' : ''}`} style={{ background: c }} title={`강조 ${i + 1}`} onClick={() => TA.tableStyle({ accent: i + 1 })} />
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="음영 · 테두리">
        <div className="rb-col">
          <SplitButton icon={<ColorBarIcon icon={<PaintBucket size={15} />} color={shade} />} label="음영" title="셀 음영 (선택한 셀 또는 표 전체)" onClick={() => TA.tableFill(shade)}>
            {(close) => <ColorPanel allowNone noneLabel="채우기 없음" onPick={(c) => (c && setShade(c), TA.tableFill(c), close())} />}
          </SplitButton>
          <DropdownButton icon={<Grid3x3 size={15} />} label="테두리" title="테두리 (현재 펜 모양으로)">
            {(close) => (
              <div className="menu">
                {BORDER_MODES.map((b) => (
                  <MenuItem key={b.id} icon={b.id === 'none' ? <SquareDashed size={15} /> : <Square size={15} />} label={b.label} onClick={() => (TA.tableBorders(b.id, b.id === 'none' ? null : pen), close())} />
                ))}
              </div>
            )}
          </DropdownButton>
        </div>
        <div className="rb-col">
          <DropdownButton icon={<ColorBarIcon icon={<Type size={15} />} color={pen.color} />} label="펜 색" title="테두리 펜 색">
            {(close) => <ColorPanel onPick={(c) => (c && setPen({ ...pen, color: c }), close())} />}
          </DropdownButton>
          <DropdownButton label={`펜 두께 ${pen.width}pt`} title="테두리 펜 두께">
            {(close) => (
              <div className="menu">
                {[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => (
                  <MenuItem key={w} label={`${w}pt`} checked={pen.width === w} onClick={() => (setPen({ ...pen, width: w }), close())} />
                ))}
              </div>
            )}
          </DropdownButton>
        </div>
      </RibbonGroup>
    </>
  );
}

function TableStyleThumb({ preset, color }: { preset: string; color: string }) {
  const rows = [0, 1, 2, 3];
  const fillFor = (r: number) => {
    switch (preset) {
      case 'medium2':
        return r === 0 ? color : r % 2 ? `${color}66` : `${color}33`;
      case 'light1':
        return r % 2 && r > 0 ? `${color}33` : 'transparent';
      case 'dark1':
        return r === 0 ? '#000' : r % 2 ? color : `${color}cc`;
      default:
        return 'transparent';
    }
  };
  return (
    <svg width={52} height={36} viewBox="0 0 52 36" aria-hidden>
      {rows.map((r) => (
        <rect key={r} x={1} y={1 + r * 8.5} width={50} height={8.5} fill={fillFor(r)} stroke={preset === 'grid' ? '#555' : preset === 'light1' && (r === 0 || r === 1) ? color : '#ffffff'} strokeWidth={0.6} />
      ))}
      {preset === 'grid' && [13, 26, 39].map((x) => <line key={x} x1={x} x2={x} y1={1} y2={35} stroke="#555" strokeWidth={0.6} />)}
    </svg>
  );
}

export function TableLayoutTab({ table }: { table: TableObject }) {
  const sel = useEditor((s) => s.cellSelection);
  const ranged = !!sel && sel.id === table.id && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2);
  return (
    <>
      <RibbonGroup label="행 및 열">
        <DropdownButton size="large" icon={<Trash2 size={26} />} label="삭제" title="셀/행/열/표 삭제">
          {(close) => (
            <div className="menu">
              <MenuItem label="열 삭제" onClick={() => (TA.tableDeleteColumns(), close())} />
              <MenuItem label="행 삭제" onClick={() => (TA.tableDeleteRows(), close())} />
              <MenuSeparator />
              <MenuItem label="표 삭제" onClick={() => (TA.deleteWholeTable(), close())} />
            </div>
          )}
        </DropdownButton>
        <RibbonButton size="large" icon={<ArrowUpToLine size={26} />} label="위에 삽입" title="위에 행 삽입" onClick={() => TA.tableInsertRow('above')} />
        <RibbonButton size="large" icon={<ArrowDownToLine size={26} />} label="아래에 삽입" title="아래에 행 삽입" onClick={() => TA.tableInsertRow('below')} />
        <div className="rb-col">
          <RibbonButton icon={<ArrowLeftToLine size={15} />} label="왼쪽에 삽입" title="왼쪽에 열 삽입" onClick={() => TA.tableInsertColumn('left')} />
          <RibbonButton icon={<ArrowRightToLine size={15} />} label="오른쪽에 삽입" title="오른쪽에 열 삽입" onClick={() => TA.tableInsertColumn('right')} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="병합">
        <RibbonButton size="large" icon={<Merge size={26} />} label="셀 병합" title="선택한 셀 병합 (셀 클릭 후 Shift+클릭 또는 드래그로 범위 선택)" disabled={!ranged} onClick={TA.tableMerge} />
        <RibbonButton size="large" icon={<Split size={26} />} label="셀 분할" title="병합된 셀 분할" onClick={TA.tableSplit} />
      </RibbonGroup>
      <RibbonGroup label="셀 크기">
        <div className="rb-col">
          <RibbonButton icon={<Rows3 size={15} />} label="행 높이를 같게" title="행 높이를 같게" onClick={() => TA.tableDistribute('rows')} />
          <RibbonButton icon={<Columns3 size={15} />} label="열 너비를 같게" title="열 너비를 같게" onClick={() => TA.tableDistribute('cols')} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="맞춤">
        <div className="rb-col rb-col-tight">
          <div className="rb-row">
            <RibbonButton icon={<AlignLeft size={16} />} title="왼쪽 맞춤" onClick={() => TA.tableAlign('left')} />
            <RibbonButton icon={<AlignCenter size={16} />} title="가운데 맞춤" onClick={() => TA.tableAlign('center')} />
            <RibbonButton icon={<AlignRight size={16} />} title="오른쪽 맞춤" onClick={() => TA.tableAlign('right')} />
          </div>
          <div className="rb-row">
            <RibbonButton icon={<AlignVerticalJustifyStart size={16} />} title="위쪽 맞춤" onClick={() => TA.tableAlign(undefined, 'top')} />
            <RibbonButton icon={<AlignVerticalJustifyCenter size={16} />} title="세로 가운데 맞춤" onClick={() => TA.tableAlign(undefined, 'middle')} />
            <RibbonButton icon={<AlignVerticalJustifyEnd size={16} />} title="아래쪽 맞춤" onClick={() => TA.tableAlign(undefined, 'bottom')} />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label="표 크기">
        <div className="rb-col muted table-info">
          <span>
            <Table2 size={13} /> {table.rows.length}행 × {table.columns.length}열
          </span>
          {table.preserved && <span>원본 서식 보존 중 (내용을 바꾸면 새로 저장)</span>}
        </div>
      </RibbonGroup>
    </>
  );
}

export function ChartDesignTab() {
  const chart = useSelectedObjects()[0];
  if (!chart || chart.type !== 'chart') return null;
  return (
    <>
      <RibbonGroup label="종류">
        <DropdownButton size="large" icon={CHART_ICONS[chart.chartType]} label="차트 종류 변경" title="차트 종류 변경">
          {(close) => <ChartTypeMenu close={close} onPick={(t) => editChart('차트 종류', (c) => void (c.chartType = t))} />}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="데이터">
        <RibbonButton size="large" icon={<Database size={26} />} label="데이터 편집" title="차트 데이터 편집 (더블클릭)" onClick={() => useEditor.getState().set({ chartEditorId: chart.id })} />
      </RibbonGroup>
      <RibbonGroup label="차트 요소">
        <div className="rb-col check-col">
          <label className="rb-check">
            <input type="checkbox" checked={chart.showTitle} onChange={(e) => editChart('차트 제목', (c) => void (c.showTitle = e.target.checked))} /> 차트 제목
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={chart.showLegend} onChange={(e) => editChart('범례', (c) => void (c.showLegend = e.target.checked))} /> 범례
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={chart.showDataLabels} onChange={(e) => editChart('데이터 레이블', (c) => void (c.showDataLabels = e.target.checked))} /> 데이터 레이블
          </label>
        </div>
        <div className="rb-col check-col">
          <label className="rb-check">
            <input
              type="checkbox"
              disabled={isRadial(chart.chartType) || chart.chartType === 'line' || chart.chartType === 'scatter'}
              checked={chart.stacked}
              onChange={(e) => editChart('누적', (c) => void (c.stacked = e.target.checked))}
            />{' '}
            누적
          </label>
          <select className="rb-select" value={chart.legendPos} title="범례 위치" onChange={(e) => editChart('범례 위치', (c) => void (c.legendPos = e.target.value as 'r'))}>
            <option value="b">범례: 아래쪽</option>
            <option value="r">범례: 오른쪽</option>
            <option value="t">범례: 위쪽</option>
            <option value="l">범례: 왼쪽</option>
          </select>
        </div>
      </RibbonGroup>
      <RibbonGroup label="정보">
        <div className="rb-col muted table-info">
          <span>{CHART_TYPES.find((t) => t.id === chart.chartType)?.name}</span>
          <span>
            계열 {chart.series.length}개 · 항목 {chart.categories.length}개
          </span>
          {chart.preserved && <span>원본 서식 보존 중</span>}
        </div>
      </RibbonGroup>
    </>
  );
}

export function MediaTab() {
  const sel = useSelectedObjects()[0];
  if (!sel || sel.type !== 'media') return null;
  const m: MediaObject = sel;
  const edit = (label: string, fn: (o: MediaObject) => void) =>
    useEditor.getState().commit(label, (d) => C.updateObjects(d, getActiveSlide().id, [m.id], (o) => void (o.type === 'media' && fn(o))));
  return (
    <>
      <RibbonGroup label="미리 보기">
        <RibbonButton size="large" icon={<Play size={26} />} label="재생" title="슬라이드 쇼에서 재생 (현재 슬라이드부터)" onClick={() => useEditor.getState().set({ slideshow: { startIndex: Math.max(0, useEditor.getState().doc.slides.findIndex((s) => s.id === useEditor.getState().activeSlideId)) } })} />
      </RibbonGroup>
      <RibbonGroup label={m.kind === 'video' ? '비디오 옵션' : '오디오 옵션'}>
        <div className="rb-col check-col">
          <label className="rb-check">
            <input type="checkbox" checked={!!m.autoPlay} onChange={(e) => edit('자동 재생', (o) => void (o.autoPlay = e.target.checked))} /> 자동 실행
          </label>
          <label className="rb-check">
            <Repeat size={13} />
            <input type="checkbox" checked={!!m.loop} onChange={(e) => edit('반복', (o) => void (o.loop = e.target.checked))} /> 중지할 때까지 반복
          </label>
        </div>
      </RibbonGroup>
      <RibbonGroup label="정보">
        <div className="rb-col muted table-info">
          <span>
            <Clapperboard size={13} /> {useEditor.getState().doc.assets[m.assetId]?.name ?? m.name}
          </span>
        </div>
      </RibbonGroup>
    </>
  );
}
