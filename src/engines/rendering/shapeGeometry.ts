import type { CustomGeometry, ShapeKind } from '../../types/model';

/** 도형 종류별 SVG path (w x h 좌표계). PowerPoint 프리셋 도형의 기본 조정값 기준으로 근사 */
/** 사용자 지정 도형 경로 → SVG path (정규화 좌표 × 크기) */
export function customPath(g: CustomGeometry | undefined, w: number, h: number, which: 'fill' | 'stroke' = 'fill'): string {
  if (!g) return `M0,0 H${w} V${h} H0 Z`;
  return g.paths
    .filter((p) => (which === 'fill' ? p.fill : p.stroke))
    .map((p) =>
      p.cmds
        .map((c) => {
          switch (c.c) {
            case 'M':
            case 'L':
              return `${c.c}${r(c.x * w)},${r(c.y * h)}`;
            case 'C':
              return `C${r(c.x1 * w)},${r(c.y1 * h)} ${r(c.x2 * w)},${r(c.y2 * h)} ${r(c.x * w)},${r(c.y * h)}`;
            case 'Z':
              return 'Z';
          }
        })
        .join(' '),
    )
    .join(' ');
}

export function shapePath(kind: ShapeKind, w: number, h: number, geometry?: CustomGeometry): string {
  const p = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${r(x)},${r(y)}`).join(' L') + ' Z';
  const m = Math.min(w, h);
  switch (kind) {
    case 'rect':
      return p([[0, 0], [w, 0], [w, h], [0, h]]);
    case 'roundRect': {
      const rr = m * 0.1667;
      return `M${rr},0 H${w - rr} A${rr},${rr} 0 0 1 ${w},${rr} V${h - rr} A${rr},${rr} 0 0 1 ${w - rr},${h} H${rr} A${rr},${rr} 0 0 1 0,${h - rr} V${rr} A${rr},${rr} 0 0 1 ${rr},0 Z`;
    }
    case 'ellipse':
      return `M0,${h / 2} A${w / 2},${h / 2} 0 1 1 ${w},${h / 2} A${w / 2},${h / 2} 0 1 1 0,${h / 2} Z`;
    case 'triangle':
      return p([[w / 2, 0], [w, h], [0, h]]);
    case 'rightTriangle':
      return p([[0, 0], [w, h], [0, h]]);
    case 'diamond':
      return p([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'pentagon':
      return regular(5, w, h, -90, p);
    case 'hexagon': {
      const a = m * 0.25;
      return p([[a, 0], [w - a, 0], [w, h / 2], [w - a, h], [a, h], [0, h / 2]]);
    }
    case 'octagon': {
      const a = m * 0.29289;
      return p([[a, 0], [w - a, 0], [w, a], [w, h - a], [w - a, h], [a, h], [0, h - a], [0, a]]);
    }
    case 'star5': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const ang = ((-90 + i * 36) * Math.PI) / 180;
        const rad = i % 2 === 0 ? 1 : 0.382;
        pts.push([w / 2 + (w / 2) * rad * Math.cos(ang), h / 2 + (h / 2) * rad * Math.sin(ang) + h * 0.05]);
      }
      return p(pts);
    }
    case 'rightArrow': {
      const head = Math.min(w, h * 1.0) * 0.5;
      return p([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]);
    }
    case 'leftArrow': {
      const head = Math.min(w, h) * 0.5;
      return p([[w, h * 0.25], [head, h * 0.25], [head, 0], [0, h / 2], [head, h], [head, h * 0.75], [w, h * 0.75]]);
    }
    case 'upArrow': {
      const head = Math.min(h, w) * 0.5;
      return p([[w * 0.25, h], [w * 0.25, head], [0, head], [w / 2, 0], [w, head], [w * 0.75, head], [w * 0.75, h]]);
    }
    case 'downArrow': {
      const head = Math.min(h, w) * 0.5;
      return p([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - head], [w, h - head], [w / 2, h], [0, h - head], [w * 0.25, h - head]]);
    }
    case 'chevron': {
      const a = Math.min(w, h) * 0.5;
      return p([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h], [a, h / 2]]);
    }
    case 'parallelogram': {
      const a = m * 0.25;
      return p([[a, 0], [w, 0], [w - a, h], [0, h]]);
    }
    case 'trapezoid': {
      const a = m * 0.25;
      return p([[a, 0], [w - a, 0], [w, h], [0, h]]);
    }
    case 'plus': {
      const ax = w * 0.25, ay = h * 0.25;
      return p([[ax, 0], [w - ax, 0], [w - ax, ay], [w, ay], [w, h - ay], [w - ax, h - ay], [w - ax, h], [ax, h], [ax, h - ay], [0, h - ay], [0, ay], [ax, ay]]);
    }
    case 'heart':
      return `M${w / 2},${h * 0.25} C${w / 2},${h * 0.1} ${w * 0.4},0 ${w * 0.25},0 C${w * 0.05},0 0,${h * 0.18} 0,${h * 0.32} C0,${h * 0.55} ${w * 0.25},${h * 0.75} ${w / 2},${h} C${w * 0.75},${h * 0.75} ${w},${h * 0.55} ${w},${h * 0.32} C${w},${h * 0.18} ${w * 0.95},0 ${w * 0.75},0 C${w * 0.6},0 ${w / 2},${h * 0.1} ${w / 2},${h * 0.25} Z`;
    case 'custom':
      return customPath(geometry, w, h);
    case 'cloud': {
      const s = (x: number, y: number) => `${r(x * w)},${r(y * h)}`;
      return `M${s(0.25, 0.85)} C${s(0.05, 0.85)} ${s(0, 0.6)} ${s(0.12, 0.5)} C${s(0.05, 0.3)} ${s(0.25, 0.15)} ${s(0.38, 0.25)} C${s(0.45, 0.05)} ${s(0.7, 0.05)} ${s(0.72, 0.25)} C${s(0.9, 0.18)} ${s(1.02, 0.4)} ${s(0.92, 0.55)} C${s(1.02, 0.75)} ${s(0.85, 0.92)} ${s(0.72, 0.85)} C${s(0.6, 1)} ${s(0.38, 1)} ${s(0.25, 0.85)} Z`;
    }
  }
}

function regular(n: number, w: number, h: number, start: number, p: (pts: [number, number][]) => string) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a) + h * 0.05]);
  }
  // 정규화: 상하 꽉 차도록
  const ys = pts.map((q) => q[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return p(pts.map(([x, y]) => [x, ((y - minY) / (maxY - minY)) * h]));
}

const r = (v: number) => Math.round(v * 100) / 100;

/** 도형 내부 텍스트 영역 (도형 대비 비율 inset) */
export function shapeTextInset(kind: ShapeKind): { l: number; t: number; r: number; b: number } {
  switch (kind) {
    case 'ellipse':
      return { l: 0.146, t: 0.146, r: 0.146, b: 0.146 };
    case 'triangle':
      return { l: 0.25, t: 0.5, r: 0.25, b: 0 };
    case 'diamond':
      return { l: 0.25, t: 0.25, r: 0.25, b: 0.25 };
    case 'star5':
      return { l: 0.3, t: 0.38, r: 0.3, b: 0.2 };
    default:
      return { l: 0, t: 0, r: 0, b: 0 };
  }
}
