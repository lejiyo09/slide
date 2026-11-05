/**
 * 차트 SVG 렌더러 (자체 구현): 세로/가로 막대, 꺾은선, 영역, 원형, 도넛, 분산형.
 * 편집 캔버스, 축소판, 슬라이드 쇼에서 동일하게 사용한다.
 */
import { memo } from 'react';
import type { ChartObject, Theme } from '../../types/model';
import { chartPalette, formatNumber, isRadial, niceScale } from '../../editors/chart/chart';
import { ptToPx } from '../../utils/units';

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", Arial, sans-serif';

export const ChartView = memo(function ChartView({ chart, theme }: { chart: ChartObject; theme: Theme }) {
  const W = chart.width, H = chart.height;
  const fs = ptToPx(chart.fontSize);
  const textColor = '#404040';
  const radial = isRadial(chart.chartType);
  const legendItems = radial ? chart.categories : chart.series.map((s) => s.name);
  const colors = chartPalette(theme, Math.max(legendItems.length, chart.series.length), chart.colors);
  const seriesColors = chart.series.map((s, i) => s.color ?? colors[i]);
  const itemColors = radial ? chart.categories.map((_, i) => colors[i]) : seriesColors;

  // 레이아웃
  let top = 8, left = 8, right = W - 8, bottom = H - 8;
  if (chart.showTitle && chart.title) top += fs * 1.6 + 6;
  const legendH = fs * 1.6;
  const legendW = Math.min(W * 0.3, Math.max(...legendItems.map((t) => t.length * fs * 0.62 + fs * 2), 40));
  if (chart.showLegend) {
    if (chart.legendPos === 'b') bottom -= legendH + 4;
    else if (chart.legendPos === 't') top += legendH + 4;
    else if (chart.legendPos === 'r') right -= legendW + 8;
    else left += legendW + 8;
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, fontFamily: FONT, overflow: 'hidden' }}>
      {chart.showTitle && chart.title && (
        <text x={W / 2} y={8 + fs * 1.3} textAnchor="middle" fontSize={fs * 1.33} fill={textColor}>
          {chart.title}
        </text>
      )}
      {radial ? (
        <Pie chart={chart} colors={itemColors} box={{ left, top, right, bottom }} fs={fs} />
      ) : (
        <Cartesian chart={chart} colors={seriesColors} box={{ left, top, right, bottom }} fs={fs} textColor={textColor} />
      )}
      {chart.showLegend && <Legend items={legendItems} colors={itemColors} pos={chart.legendPos} W={W} H={H} fs={fs} box={{ left, top, right, bottom }} legendW={legendW} line={chart.chartType === 'line' || chart.chartType === 'scatter'} />}
    </svg>
  );
});

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function Legend({ items, colors, pos, W, fs, box, legendW, line }: { items: string[]; colors: string[]; pos: string; W: number; H: number; fs: number; box: Box; legendW: number; line: boolean }) {
  const sw = fs * 0.8;
  if (pos === 'b' || pos === 't') {
    const widths = items.map((t) => sw + 6 + t.length * fs * 0.62 + 14);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = Math.max(4, (W - total) / 2);
    const y = pos === 'b' ? box.bottom + 4 + fs * 0.9 : box.top - fs * 0.7;
    return (
      <g fontSize={fs} fill="#404040">
        {items.map((t, i) => {
          const g = (
            <g key={i}>
              {line ? <line x1={x} x2={x + sw} y1={y - fs * 0.3} y2={y - fs * 0.3} stroke={colors[i]} strokeWidth={2.5} /> : <rect x={x} y={y - sw * 0.85} width={sw} height={sw} fill={colors[i]} />}
              <text x={x + sw + 5} y={y}>
                {t}
              </text>
            </g>
          );
          x += widths[i];
          return g;
        })}
      </g>
    );
  }
  const x = pos === 'r' ? box.right + 10 : 8;
  const startY = (box.top + box.bottom) / 2 - (items.length * fs * 1.4) / 2 + fs;
  void legendW;
  return (
    <g fontSize={fs} fill="#404040">
      {items.map((t, i) => (
        <g key={i}>
          <rect x={x} y={startY + i * fs * 1.4 - sw * 0.85} width={sw} height={sw} fill={colors[i]} />
          <text x={x + sw + 5} y={startY + i * fs * 1.4}>
            {t}
          </text>
        </g>
      ))}
    </g>
  );
}

function Pie({ chart, colors, box, fs }: { chart: ChartObject; colors: string[]; box: Box; fs: number }) {
  const vals = (chart.series[0]?.values ?? []).map((v) => Math.max(0, v || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const r = Math.max(4, Math.min(box.right - box.left, box.bottom - box.top) / 2 - 4);
  const inner = chart.chartType === 'doughnut' ? r * 0.5 : 0;
  let a = -Math.PI / 2;
  return (
    <g>
      {vals.map((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        const a2 = a + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
        const d =
          sweep >= Math.PI * 2 - 1e-6
            ? `M${p(0, r)} A${r},${r} 0 1 1 ${p(Math.PI, r)} A${r},${r} 0 1 1 ${p(0, r)} Z` + (inner ? ` M${p(0, inner)} A${inner},${inner} 0 1 0 ${p(Math.PI, inner)} A${inner},${inner} 0 1 0 ${p(0, inner)} Z` : '')
            : inner
              ? `M${p(a, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} L${p(a2, inner)} A${inner},${inner} 0 ${large} 0 ${p(a, inner)} Z`
              : `M${cx},${cy} L${p(a, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} Z`;
        const mid = a + sweep / 2;
        const lr = inner ? (r + inner) / 2 : r * 0.65;
        const el = (
          <g key={i}>
            <path d={d} fill={colors[i]} stroke="#FFFFFF" strokeWidth={1.5} fillRule="evenodd" />
            {chart.showDataLabels && v > 0 && (
              <text x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + fs * 0.35} textAnchor="middle" fontSize={fs} fill="#FFFFFF">
                {formatNumber(v)}
              </text>
            )}
          </g>
        );
        a = a2;
        return el;
      })}
    </g>
  );
}

function Cartesian({ chart, colors, box, fs, textColor }: { chart: ChartObject; colors: string[]; box: Box; fs: number; textColor: string }) {
  const horizontal = chart.chartType === 'bar';
  const scatter = chart.chartType === 'scatter';
  const stacked = chart.stacked && (chart.chartType === 'column' || chart.chartType === 'bar' || chart.chartType === 'area');
  const n = scatter ? 0 : chart.categories.length;
  const series = chart.series;
  // 값 범위
  let vmin = 0, vmax = 0;
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      vmax = Math.max(vmax, pos);
      vmin = Math.min(vmin, neg);
    }
  } else
    for (const s of series)
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        vmax = Math.max(vmax, v);
        vmin = Math.min(vmin, v);
      }
  const scale = niceScale(vmin, vmax);
  // 분산형 X 범위
  const xs = scatter ? series.flatMap((s) => s.xValues ?? s.values.map((_, i) => i + 1)) : [];
  const xscale = scatter ? niceScale(Math.min(0, ...xs), Math.max(...xs, 1)) : null;

  const labelW = Math.max(...scale.values.map((v) => formatNumber(v).length)) * fs * 0.62 + 6;
  const catLabelW = horizontal ? Math.max(...chart.categories.map((c) => c.length)) * fs * 0.62 + 8 : 0;
  const plot = {
    left: box.left + (horizontal ? catLabelW : labelW),
    right: box.right - 6,
    top: box.top + 4,
    bottom: box.bottom - fs * 1.6,
  };
  const pw = Math.max(1, plot.right - plot.left), ph = Math.max(1, plot.bottom - plot.top);
  const vPos = (v: number) => (horizontal ? plot.left + ((v - scale.min) / (scale.max - scale.min)) * pw : plot.bottom - ((v - scale.min) / (scale.max - scale.min)) * ph);
  const zero = vPos(Math.max(scale.min, Math.min(scale.max, 0)));
  const band = (horizontal ? ph : pw) / Math.max(1, n);
  const catCenter = (i: number) => (horizontal ? plot.top + band * (i + 0.5) : plot.left + band * (i + 0.5));
  const xPos = (x: number) => (xscale ? plot.left + ((x - xscale.min) / (xscale.max - xscale.min)) * pw : 0);

  const grid = scale.values.map((v, i) =>
    horizontal ? (
      <g key={i}>
        <line x1={vPos(v)} x2={vPos(v)} y1={plot.top} y2={plot.bottom} stroke="#D9D9D9" strokeWidth={0.75} />
        <text x={vPos(v)} y={plot.bottom + fs * 1.2} textAnchor="middle" fontSize={fs} fill={textColor}>
          {formatNumber(v)}
        </text>
      </g>
    ) : (
      <g key={i}>
        <line x1={plot.left} x2={plot.right} y1={vPos(v)} y2={vPos(v)} stroke="#D9D9D9" strokeWidth={0.75} />
        <text x={plot.left - 5} y={vPos(v) + fs * 0.35} textAnchor="end" fontSize={fs} fill={textColor}>
          {formatNumber(v)}
        </text>
      </g>
    ),
  );

  const catLabels = scatter
    ? xscale!.values.map((v, i) => (
        <text key={i} x={xPos(v)} y={plot.bottom + fs * 1.2} textAnchor="middle" fontSize={fs} fill={textColor}>
          {formatNumber(v)}
        </text>
      ))
    : chart.categories.map((c, i) =>
        horizontal ? (
          <text key={i} x={plot.left - 5} y={catCenter(i) + fs * 0.35} textAnchor="end" fontSize={fs} fill={textColor}>
            {c}
          </text>
        ) : (
          <text key={i} x={catCenter(i)} y={plot.bottom + fs * 1.2} textAnchor="middle" fontSize={fs} fill={textColor}>
            {c}
          </text>
        ),
      );

  const marks: React.ReactNode[] = [];
  const label = (key: string, x: number, y: number, v: number, anchor: 'middle' | 'start' = 'middle') =>
    chart.showDataLabels ? (
      <text key={key} x={x} y={y} textAnchor={anchor} fontSize={fs * 0.9} fill={textColor}>
        {formatNumber(v)}
      </text>
    ) : null;

  if (chart.chartType === 'column' || chart.chartType === 'bar') {
    const groupW = band * 0.7;
    const barW = stacked ? groupW : groupW / Math.max(1, series.length);
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      series.forEach((s, si) => {
        const v = s.values[i] ?? 0;
        let from: number, to: number;
        if (stacked) {
          from = v >= 0 ? pos : neg;
          to = from + v;
          if (v >= 0) pos = to;
          else neg = to;
        } else (from = 0), (to = v);
        const a = vPos(from), b = vPos(to);
        const off = catCenter(i) - groupW / 2 + (stacked ? 0 : si * barW);
        if (horizontal) {
          marks.push(<rect key={`${si}-${i}`} x={Math.min(a, b)} y={off} width={Math.abs(b - a)} height={barW * 0.95} fill={colors[si]} />);
          marks.push(label(`l${si}-${i}`, Math.max(a, b) + 3, off + barW / 2 + fs * 0.3, v, 'start'));
        } else {
          marks.push(<rect key={`${si}-${i}`} x={off} y={Math.min(a, b)} width={barW * 0.95} height={Math.abs(b - a)} fill={colors[si]} />);
          marks.push(label(`l${si}-${i}`, off + barW / 2, Math.min(a, b) - 3, v));
        }
      });
    }
  } else if (chart.chartType === 'line' || chart.chartType === 'area') {
    const cum = new Array(n).fill(0);
    const layers = series.map((s) => s.values.map((v, i) => (stacked ? (cum[i] += v ?? 0) : v ?? 0)));
    series.forEach((_, si) => {
      const pts = layers[si].map((v, i) => [catCenter(i), vPos(v)] as const);
      if (chart.chartType === 'area') {
        const base = stacked && si > 0 ? layers[si - 1].map((v, i) => [catCenter(i), vPos(v)] as const).reverse() : [[catCenter(n - 1), zero] as const, [catCenter(0), zero] as const];
        marks.push(<path key={`a${si}`} d={`M${[...pts, ...base].map((p) => p.join(',')).join(' L')} Z`} fill={colors[si]} fillOpacity={stacked ? 1 : 0.75} />);
      } else {
        marks.push(<polyline key={`l${si}`} points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={colors[si]} strokeWidth={2.5} strokeLinejoin="round" />);
        pts.forEach((p, i) => marks.push(<circle key={`c${si}-${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={colors[si]} />));
      }
      pts.forEach((p, i) => marks.push(label(`t${si}-${i}`, p[0], p[1] - 6, series[si].values[i] ?? 0)));
    });
  } else if (scatter) {
    series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        const x = s.xValues?.[i] ?? i + 1;
        marks.push(<circle key={`s${si}-${i}`} cx={xPos(x)} cy={vPos(v)} r={4} fill={colors[si]} />);
        marks.push(label(`t${si}-${i}`, xPos(x), vPos(v) - 7, v));
      }),
    );
  }

  return (
    <g>
      {grid}
      {horizontal ? (
        <line x1={zero} x2={zero} y1={plot.top} y2={plot.bottom} stroke="#A6A6A6" />
      ) : (
        <line x1={plot.left} x2={plot.right} y1={zero} y2={zero} stroke="#A6A6A6" />
      )}
      {marks}
      {catLabels}
    </g>
  );
}
