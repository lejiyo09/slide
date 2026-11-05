import type { SlideLayout } from '../../core/document/factory';

/** 레이아웃 미리보기 아이콘 */
export function LayoutThumb({ layout }: { layout: SlideLayout }) {
  const box = (x: number, y: number, w: number, h: number, dark = false) => (
    <rect x={x} y={y} width={w} height={h} rx={1} fill={dark ? 'var(--layout-strong)' : 'none'} stroke="var(--layout-line)" strokeDasharray={dark ? undefined : '2 1.5'} strokeWidth={0.8} />
  );
  return (
    <svg width={80} height={45} viewBox="0 0 80 45" className="layout-thumb" aria-hidden>
      <rect x={0.5} y={0.5} width={79} height={44} fill="var(--layout-bg)" stroke="var(--border)" />
      {layout === 'title' && (<>{box(10, 12, 60, 10, true)}{box(18, 26, 44, 6)}</>)}
      {layout === 'titleContent' && (<>{box(6, 4, 68, 7, true)}{box(6, 14, 68, 27)}</>)}
      {layout === 'sectionHeader' && (<>{box(8, 16, 64, 9, true)}{box(8, 28, 64, 5)}</>)}
      {layout === 'twoContent' && (<>{box(6, 4, 68, 7, true)}{box(6, 14, 33, 27)}{box(41, 14, 33, 27)}</>)}
      {layout === 'titleOnly' && box(6, 4, 68, 7, true)}
    </svg>
  );
}
