/**
 * 도형 서식 › 도형 병합 (PowerPoint: 통합·결합·조각·교차·빼기). 항목마다 그림 아이콘과 설명,
 * 마우스를 올리면 실제 계산한 결과 윤곽을 캔버스에 점선으로 미리 보여 준다. 빼기는 기준(처음 선택한) 도형을 알려 준다.
 */
import { Combine } from 'lucide-react';
import { DropdownButton } from '../common/Buttons';
import { useEditor } from '../../core/store/editorStore';
import { IMAGE_OPS, MERGE_OPS, mergeAvailability, mergeShapes, previewMerge, selectedInOrder } from '../../core/commands/mergeShapes';
import type { SlideObject } from '../../types/model';
import type { MergeOp } from '../../engines/geometry/shapeBoolean';

/** 두 원으로 결과를 그린 작은 아이콘 (채운 부분 = 결과) */
function OpIcon({ op }: { op: MergeOp }) {
  const A = <circle cx="13" cy="14" r="8" />, B = <circle cx="21" cy="14" r="8" />;
  const on = 'var(--accent, #2b579a)', off = 'none', line = 'var(--shape-icon-stroke, #666)';
  return (
    <svg width="34" height="28" viewBox="0 0 34 28" aria-hidden>
      <defs>
        <clipPath id={`mA-${op}`}>{A}</clipPath>
        <clipPath id={`mB-${op}`}>{B}</clipPath>
        <mask id={`mnB-${op}`}>
          <rect width="34" height="28" fill="#fff" />
          <circle cx="21" cy="14" r="8" fill="#000" />
        </mask>
        <mask id={`mnA-${op}`}>
          <rect width="34" height="28" fill="#fff" />
          <circle cx="13" cy="14" r="8" fill="#000" />
        </mask>
      </defs>
      {op === 'union' && <g fill={on}>{A}{B}</g>}
      {op === 'intersect' && <g clipPath={`url(#mA-${op})`} fill={on}>{B}</g>}
      {op === 'subtract' && <g mask={`url(#mnB-${op})`} fill={on}>{A}</g>}
      {op === 'combine' && (
        <>
          <g mask={`url(#mnB-${op})`} fill={on}>{A}</g>
          <g mask={`url(#mnA-${op})`} fill={on}>{B}</g>
        </>
      )}
      {op === 'fragment' && (
        <>
          <g mask={`url(#mnB-${op})`} fill={on} opacity="0.55">{A}</g>
          <g clipPath={`url(#mA-${op})`} fill={on}>{B}</g>
          <g mask={`url(#mnA-${op})`} fill={on} opacity="0.3">{B}</g>
        </>
      )}
      <g fill={off} stroke={line} strokeWidth="1">{A}{B}</g>
    </svg>
  );
}

/** 결과 윤곽(사용자 지정 도형) → SVG 경로 (슬라이드 좌표) */
const outline = (m: { x: number; y: number; width: number; height: number; geometry: { paths: { cmds: { c: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[] }[] } }) =>
  m.geometry.paths
    .map((p) =>
      p.cmds
        .map((c) => {
          const X = (v = 0) => (m.x + v * m.width).toFixed(2), Y = (v = 0) => (m.y + v * m.height).toFixed(2);
          return c.c === 'Z' ? 'Z' : c.c === 'C' ? `C${X(c.x1)},${Y(c.y1)} ${X(c.x2)},${Y(c.y2)} ${X(c.x)},${Y(c.y)}` : `${c.c}${X(c.x)},${Y(c.y)}`;
        })
        .join(' '),
    )
    .join(' ');

export function MergeShapesMenu({ objs }: { objs: SlideObject[] }) {
  const ordered = (() => {
    const ids = useEditor.getState().selectedIds;
    return ids.map((id) => objs.find((o) => o.id === id)).filter((o): o is SlideObject => !!o);
  })();
  const av = mergeAvailability(ordered);
  const hover = async (op: MergeOp | null) => {
    if (!op) return useEditor.getState().set({ mergePreview: null });
    const shapes = await previewMerge(op);
    useEditor.getState().set({ mergePreview: shapes.map((m) => ({ x: m.x, y: m.y, width: m.width, height: m.height, d: outline(m) })) });
  };
  return (
    <DropdownButton size="large" icon={<Combine size={26} />} label="도형 병합" title={av.ok ? '선택한 도형을 통합·결합·조각·교차·빼기' : (av.reason ?? '')} disabled={!av.ok}>
      {(close) => (
        <div className="menu merge-menu" data-merge-items="" onMouseLeave={() => void hover(null)}>
          {MERGE_OPS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="menu-item merge-item"
              data-merge-op={m.id}
              disabled={av.image && !IMAGE_OPS.includes(m.id)}
              title={av.image && !IMAGE_OPS.includes(m.id) ? '그림은 교차(도형 모양으로 자르기)·빼기(오려 내기)만' : undefined}
              onMouseEnter={() => void hover(m.id)}
              onFocus={() => void hover(m.id)}
              onClick={() => {
                close();
                useEditor.getState().set({ mergePreview: null });
                void mergeShapes(m.id);
              }}
            >
              <OpIcon op={m.id} />
              <span className="merge-text">
                <strong>
                  {m.name} <span className="muted">({m.en})</span>
                </strong>
                <span className="muted">{av.image && m.id === 'intersect' ? '그림을 도형 모양으로 자릅니다' : av.image && m.id === 'subtract' ? '그림에서 도형 모양을 오려 냅니다' : m.desc}</span>
              </span>
            </button>
          ))}
          <div className="merge-base muted" data-merge-base="">
            빼기 기준(처음 선택한 도형): <strong>{av.base}</strong> · 선택 순서: {selectedInOrder().map((o) => o.name).join(' → ')}
          </div>
        </div>
      )}
    </DropdownButton>
  );
}
