import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createChart, niceScale, chartPalette } from './chart';
import { ChartView } from '../../engines/rendering/ChartView';
import { DEFAULT_THEME } from '../../themes/themes';
import type { ChartType } from '../../types/model';

describe('차트', () => {
  it('보기 좋은 축 눈금', () => {
    expect(niceScale(0, 25)).toMatchObject({ min: 0, max: 25, step: 5 });
    expect(niceScale(-3, 18).min).toBeLessThanOrEqual(-3);
    expect(niceScale(5, 5).max).toBeGreaterThan(5);
  });
  it('팔레트: 테마 강조색 순서, 사용자 지정 우선', () => {
    const p = chartPalette(DEFAULT_THEME, 7, ['#123456']);
    expect(p[0]).toBe('#123456');
    expect(p[1]).toBe(DEFAULT_THEME.colors.accent2);
    expect(p).toHaveLength(7);
  });
  it.each(['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'] as ChartType[])('%s 차트 SVG 렌더링', (type) => {
    const c = createChart(type, 0, 0, 600, 400);
    c.showDataLabels = true;
    const { container } = render(<ChartView chart={c} theme={DEFAULT_THEME} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    const marks = svg.querySelectorAll(type === 'pie' || type === 'doughnut' ? 'path' : type === 'line' ? 'polyline' : type === 'area' ? 'path' : type === 'scatter' ? 'circle' : 'rect');
    expect(marks.length).toBeGreaterThan(0);
    expect(svg.textContent).toContain('차트 제목');
  });
});
