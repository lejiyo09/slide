/** 차트 모델 도우미 */
import type { ChartObject, ChartType, Color, Theme } from '../../types/model';
import { newId } from '../../utils/id';

export const CHART_TYPES: { id: ChartType; name: string }[] = [
  { id: 'column', name: '세로 막대형' },
  { id: 'bar', name: '가로 막대형' },
  { id: 'line', name: '꺾은선형' },
  { id: 'area', name: '영역형' },
  { id: 'pie', name: '원형' },
  { id: 'doughnut', name: '도넛형' },
  { id: 'scatter', name: '분산형' },
];

export const isRadial = (t: ChartType) => t === 'pie' || t === 'doughnut';

export function createChart(type: ChartType, x: number, y: number, width = 640, height = 400): ChartObject {
  const scatter = type === 'scatter';
  return {
    id: newId(),
    type: 'chart',
    name: '차트',
    x,
    y,
    width,
    height,
    rotation: 0,
    chartType: type,
    categories: scatter ? ['1', '2', '3', '4'] : ['항목 1', '항목 2', '항목 3', '항목 4'],
    series: isRadial(type)
      ? [{ name: '판매', values: [8.2, 3.2, 1.4, 1.2] }]
      : scatter
        ? [{ name: 'Y 값', values: [2.7, 3.2, 0.8, 4.1], xValues: [0.7, 1.8, 2.6, 3.4] }]
        : [
            { name: '계열 1', values: [4.3, 2.5, 3.5, 4.5] },
            { name: '계열 2', values: [2.4, 4.4, 1.8, 2.8] },
            { name: '계열 3', values: [2, 2, 3, 5] },
          ],
    title: '차트 제목',
    showTitle: true,
    showLegend: true,
    legendPos: 'b',
    showDataLabels: false,
    stacked: false,
    fontSize: 12,
  };
}

/** 테마 강조색 6개 + 명암 변형 */
export function chartPalette(theme: Theme, count: number, custom?: Color[]): Color[] {
  const base = [theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4, theme.colors.accent5, theme.colors.accent6];
  const out: Color[] = [];
  for (let i = 0; i < count; i++) {
    if (custom?.[i]) {
      out.push(custom[i]);
      continue;
    }
    const c = base[i % 6];
    const round = Math.floor(i / 6);
    out.push(round === 0 ? c : shade(c, round % 2 ? 0.6 : 1.4));
  }
  return out;
}

function shade(hex: Color, f: number): Color {
  const h = hex.replace('#', '');
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    const n = f < 1 ? v * f : v + (255 - v) * (f - 1);
    return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
}

/** 보기 좋은 축 눈금 */
export function niceScale(min: number, max: number, ticks = 5) {
  if (min === max) {
    max = min + 1;
    min = Math.min(0, min);
  }
  const range = max - min;
  const rough = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 1e9) / 1e9);
  return { min: lo, max: hi, step, values };
}

export const formatNumber = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('ko-KR') : String(Math.round(v * 100) / 100));
