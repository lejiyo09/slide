import type { ShapeKind } from '../../types/model';
import { shapePath } from '../../engines/rendering/shapeGeometry';
import { SHAPE_NAMES } from '../../core/document/factory';

export const SHAPE_GROUPS: { name: string; items: ShapeKind[] }[] = [
  { name: '사각형', items: ['rect', 'roundRect'] },
  { name: '기본 도형', items: ['ellipse', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'parallelogram', 'trapezoid', 'plus', 'heart', 'cloud'] },
  { name: '블록 화살표', items: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'chevron'] },
  { name: '별 및 현수막', items: ['star5'] },
];

export function ShapeIcon({ kind, size = 20 }: { kind: ShapeKind; size?: number }) {
  const w = size, h = size * 0.8;
  return (
    <svg width={size} height={size} viewBox={`-1 ${-(size - h) / 2 - 1} ${w + 2} ${size + 2}`} aria-hidden>
      <path d={shapePath(kind, w, h)} fill="var(--shape-icon-fill)" stroke="var(--shape-icon-stroke)" strokeWidth={1.2} />
    </svg>
  );
}

export function LineIcon({ arrow }: { arrow: boolean }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
      <line x1="3" y1="17" x2={arrow ? 15 : 17} y2={arrow ? 5 : 3} stroke="var(--shape-icon-stroke)" strokeWidth="1.5" />
      {arrow && <path d="M17,3 L11,5 L15,9 Z" fill="var(--shape-icon-stroke)" />}
    </svg>
  );
}

export function ShapeGalleryPanel({ onPick, onLine }: { onPick: (k: ShapeKind) => void; onLine: (arrow: boolean) => void }) {
  return (
    <div className="shape-gallery">
      <div className="sg-title">선</div>
      <div className="sg-row">
        <button type="button" className="sg-item" title="직선" onClick={() => onLine(false)}>
          <LineIcon arrow={false} />
        </button>
        <button type="button" className="sg-item" title="화살표" onClick={() => onLine(true)}>
          <LineIcon arrow />
        </button>
      </div>
      {SHAPE_GROUPS.map((g) => (
        <div key={g.name}>
          <div className="sg-title">{g.name}</div>
          <div className="sg-row">
            {g.items.map((k) => (
              <button type="button" key={k} className="sg-item" title={SHAPE_NAMES[k]} onClick={() => onPick(k)}>
                <ShapeIcon kind={k} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="sg-hint">도형을 고른 뒤 슬라이드에서 드래그하여 그리세요. 클릭하면 기본 크기로 삽입됩니다.</div>
    </div>
  );
}
