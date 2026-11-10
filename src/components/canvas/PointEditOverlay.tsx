/**
 * 점 편집 화면: 자유형 도형의 꼭짓점(사각형)과 베지어 조절점(원, 꼭짓점과 선으로 이음).
 * 점을 누르면 캔버스가 끌기를 처리한다 (onPointDown).
 */
import type { ShapeObject } from '../../types/model';
import { addPointAt, localToSlide, type PointRef } from '../../core/commands/editPoints';
import { useEditor } from '../../core/store/editorStore';
import { customPath } from '../../engines/rendering/shapeGeometry';

export function PointEditOverlay({ obj, zoom, onPointDown }: { obj: ShapeObject; zoom: number; onPointDown: (e: React.PointerEvent, ref: PointRef) => void }) {
  const g = obj.geometry;
  const sel = useEditor((s) => s.editPointSel);
  if (!g) return null;
  const isSel = (pi: number, ci: number, part: string) => !!sel && sel.path === pi && sel.cmd === ci && sel.part === part;
  const P = (u: number, v: number) => {
    const p = localToSlide(obj, u, v);
    return { x: p.x * zoom, y: p.y * zoom };
  };
  const handles: React.ReactNode[] = [];
  const lines: React.ReactNode[] = [];
  g.paths.forEach((p, pi) => {
    let prev: { x: number; y: number } | null = null;
    let start: { x: number; y: number } | null = null;
    p.cmds.forEach((c, ci) => {
      if (c.c === 'Z') {
        prev = start;
        return;
      }
      const at = P(c.x, c.y);
      if (c.c === 'M') start = at;
      if (c.c === 'C') {
        const a = P(c.x1, c.y1), b = P(c.x2, c.y2);
        if (prev) lines.push(<line key={`l1-${pi}-${ci}`} x1={prev.x} y1={prev.y} x2={a.x} y2={a.y} className="pe-line" />);
        lines.push(<line key={`l2-${pi}-${ci}`} x1={at.x} y1={at.y} x2={b.x} y2={b.y} className="pe-line" />);
        handles.push(<circle key={`c1-${pi}-${ci}`} cx={a.x} cy={a.y} r={4} className={`pe-ctrl ${isSel(pi, ci, 'c1') ? 'is-sel' : ''}`} data-pe={`${pi}:${ci}:c1`} onPointerDown={(e) => onPointDown(e, { path: pi, cmd: ci, part: 'c1' })} />);
        handles.push(<circle key={`c2-${pi}-${ci}`} cx={b.x} cy={b.y} r={4} className={`pe-ctrl ${isSel(pi, ci, 'c2') ? 'is-sel' : ''}`} data-pe={`${pi}:${ci}:c2`} onPointerDown={(e) => onPointDown(e, { path: pi, cmd: ci, part: 'c2' })} />);
      }
      // 닫힌 경로의 마지막 점이 시작점과 같으면 꼭짓점은 하나만 그림
      const dupStart = c.c !== 'M' && start && Math.abs(at.x - start.x) < 0.01 && Math.abs(at.y - start.y) < 0.01 && p.cmds[ci + 1]?.c === 'Z';
      if (!dupStart) handles.push(<rect key={`p-${pi}-${ci}`} x={at.x - 4.5} y={at.y - 4.5} width={9} height={9} className={`pe-point ${isSel(pi, ci, 'pt') ? 'is-sel' : ''}`} data-pe={`${pi}:${ci}:pt`} onPointerDown={(e) => onPointDown(e, { path: pi, cmd: ci, part: 'pt' })} />);
      prev = at;
    });
  });
  // 경로 선을 두 번 클릭하면 그 자리에 점 추가 (보이지 않는 굵은 선으로 잡기 쉽게)
  const flip = `${obj.flipH ? -1 : 1},${obj.flipV ? -1 : 1}`;
  const hitPath = (
    <g transform={`scale(${zoom}) translate(${obj.x + obj.width / 2},${obj.y + obj.height / 2}) rotate(${obj.rotation ?? 0}) scale(${flip}) translate(${-obj.width / 2},${-obj.height / 2})`}>
      <path
        d={customPath(g, obj.width, obj.height, 'fill')}
        fill="none"
        stroke="transparent"
        strokeWidth={12 / zoom}
        style={{ pointerEvents: 'stroke', cursor: 'copy' }}
        data-pe-path=""
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const stage = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement | null)?.getBoundingClientRect();
          if (!stage) return;
          addPointAt((e.clientX - stage.left) / zoom, (e.clientY - stage.top) / zoom, 12 / zoom);
        }}
      />
    </g>
  );
  return (
    <svg className="pe-overlay" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1} data-point-edit={obj.id}>
      <g>{lines}</g>
      {hitPath}
      <g style={{ pointerEvents: 'all' }}>{handles}</g>
    </svg>
  );
}
