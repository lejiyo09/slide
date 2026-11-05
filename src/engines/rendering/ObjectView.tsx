import { memo, type CSSProperties, type ReactNode } from 'react';
import type { Asset, Fill, ImageObject, LineObject, Paragraph, ShapeObject, SlideObject, Stroke, TextBody, TextObject } from '../../types/model';
import { shapePath, shapeTextInset } from './shapeGeometry';
import { hexToRgba } from '../../utils/color';
import { ptToPx } from '../../utils/units';
import { computeNumbers, cssObjectToReact, paragraphCss, runCss } from '../../editors/text/richText';

export type Assets = Record<string, Asset>;

/* ───────────── 채우기 → CSS / SVG ───────────── */

export function fillToCss(fill: Fill | undefined | null, assets: Assets): CSSProperties {
  if (!fill || fill.type === 'none') return {};
  switch (fill.type) {
    case 'solid':
      return { backgroundColor: hexToRgba(fill.color, fill.opacity ?? 1) };
    case 'gradient':
      return {
        backgroundImage: `linear-gradient(${fill.angle + 90}deg, ${fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`,
      };
    case 'image': {
      const a = assets[fill.assetId];
      return a ? { backgroundImage: `url("${a.dataUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: fill.opacity ?? 1 } : {};
    }
  }
}

function SvgFill({ id, fill, assets }: { id: string; fill: Fill; assets: Assets }) {
  if (fill.type === 'gradient') {
    return (
      <linearGradient id={id} gradientTransform={`rotate(${fill.angle}, 0.5, 0.5)`}>
        {fill.stops.map((s, i) => (
          <stop key={i} offset={s.offset} stopColor={s.color} />
        ))}
      </linearGradient>
    );
  }
  if (fill.type === 'image') {
    const a = assets[fill.assetId];
    if (!a) return null;
    return (
      <pattern id={id} patternContentUnits="objectBoundingBox" width="1" height="1">
        <image href={a.dataUrl} width="1" height="1" preserveAspectRatio="xMidYMid slice" opacity={fill.opacity ?? 1} />
      </pattern>
    );
  }
  return null;
}

function svgFillAttrs(fill: Fill, id: string): { fill: string; fillOpacity?: number } {
  switch (fill.type) {
    case 'none':
      return { fill: 'none' };
    case 'solid':
      return { fill: fill.color, fillOpacity: fill.opacity ?? 1 };
    default:
      return { fill: `url(#${id})` };
  }
}

export function dashArray(stroke: Stroke): string | undefined {
  const w = ptToPx(stroke.width);
  switch (stroke.dash) {
    case 'dash':
      return `${w * 4} ${w * 3}`;
    case 'dot':
      return `${w} ${w}`;
    case 'dashDot':
      return `${w * 4} ${w * 2} ${w} ${w * 2}`;
    default:
      return undefined;
  }
}

/* ───────────── 텍스트 ───────────── */

export function TextBodyView({ body, style }: { body: TextBody; style?: CSSProperties }) {
  const nums = computeNumbers(body.paragraphs);
  return (
    <div className="sl-text" style={textContainerStyle(body, style)}>
      <div className={`sl-text-inner ${textDirClass(body)}`} style={textInnerStyle(body)}>
        {body.paragraphs.map((p, i) => (
          <ParagraphView key={i} p={p} num={nums[i]} />
        ))}
      </div>
    </div>
  );
}

function ParagraphView({ p, num }: { p: Paragraph; num: string | null }) {
  const runs = p.runs.filter((r) => r.text.length);
  return (
    <div className="sl-p" data-bullet={p.bullet ?? 'none'} data-level={p.level ?? 0} data-num={num ?? undefined} style={cssObjectToReact(paragraphCss(p))}>
      {runs.length ? (
        runs.map((r, i) => (
          <span key={i} style={cssObjectToReact(runCss(r))}>
            {r.text}
          </span>
        ))
      ) : (
        <span style={cssObjectToReact(runCss(p.runs[0] ?? {}))}>
          <br />
        </span>
      )}
    </div>
  );
}

export function textContainerStyle(body: TextBody, extra?: CSSProperties): CSSProperties {
  const vertical = body.direction !== 'horizontal';
  const justify = body.vAlign === 'middle' ? 'center' : body.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: vertical ? 'row' : 'column',
    justifyContent: vertical ? 'center' : justify,
    alignItems: vertical ? (body.vAlign === 'middle' ? 'center' : body.vAlign === 'bottom' ? 'flex-start' : 'flex-end') : 'stretch',
    padding: `${body.padding.top}px ${body.padding.right}px ${body.padding.bottom}px ${body.padding.left}px`,
    overflow: 'visible',
    ...extra,
  };
}

export const textDirClass = (body: TextBody) =>
  body.direction === 'vertical' ? 'sl-vert' : body.direction === 'vertical270' ? 'sl-vert270' : '';

export function textInnerStyle(body: TextBody): CSSProperties {
  return {
    whiteSpace: body.wrap ? 'pre-wrap' : 'pre',
    outline: 'none',
    minWidth: body.direction === 'horizontal' ? undefined : 1,
    minHeight: 1,
  };
}

/* ───────────── 객체 ───────────── */

interface ObjectViewProps {
  obj: SlideObject;
  assets: Assets;
  /** 텍스트 편집기를 렌더링할 객체 ID (캔버스 전용) */
  editingTextId?: string | null;
  renderEditor?: (obj: TextObject | ShapeObject) => ReactNode;
  /** 썸네일 등에서 상호작용 속성 생략 */
  interactive?: boolean;
}

export const ObjectView = memo(function ObjectView({ obj, assets, editingTextId, renderEditor, interactive }: ObjectViewProps) {
  if (obj.hidden) return null;
  const transform = obj.rotation ? `rotate(${obj.rotation}deg)` : undefined;
  const style: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    transform,
    opacity: obj.opacity ?? 1,
  };
  const editing = editingTextId === obj.id;
  let content: ReactNode = null;
  switch (obj.type) {
    case 'shape':
      content = <ShapeContent obj={obj} assets={assets} editor={editing && renderEditor ? renderEditor(obj) : null} />;
      break;
    case 'text':
      content = <TextContent obj={obj} assets={assets} editor={editing && renderEditor ? renderEditor(obj) : null} showPrompt={!!interactive} />;
      break;
    case 'line':
      content = <LineContent obj={obj} />;
      break;
    case 'image':
      content = <ImageContent obj={obj} assets={assets} />;
      break;
    case 'group':
      content = obj.children.map((c) => <ObjectView key={c.id} obj={c} assets={assets} />);
      break;
  }
  return (
    <div className={`sl-obj sl-obj-${obj.type}`} style={style} data-obj-id={interactive ? obj.id : undefined}>
      {content}
    </div>
  );
});

function flipTransform(o: SlideObject) {
  if (!o.flipH && !o.flipV) return undefined;
  return `scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1})`;
}

function ShapeContent({ obj, assets, editor }: { obj: ShapeObject; assets: Assets; editor: ReactNode }) {
  const gid = `g-${obj.id}`;
  const d = shapePath(obj.shape, obj.width, obj.height);
  const sw = obj.stroke ? ptToPx(obj.stroke.width) : 0;
  const inset = shapeTextInset(obj.shape);
  return (
    <>
      <svg
        className="sl-shape-svg"
        width={obj.width}
        height={obj.height}
        viewBox={`0 0 ${obj.width} ${obj.height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', transform: flipTransform(obj), transformOrigin: 'center' }}
      >
        <defs>
          <SvgFill id={gid} fill={obj.fill} assets={assets} />
        </defs>
        <path
          d={d}
          {...svgFillAttrs(obj.fill, gid)}
          stroke={obj.stroke ? obj.stroke.color : 'none'}
          strokeOpacity={obj.stroke?.opacity ?? 1}
          strokeWidth={sw}
          strokeDasharray={obj.stroke ? dashArray(obj.stroke) : undefined}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: obj.width * inset.l,
          top: obj.height * inset.t,
          right: obj.width * inset.r,
          bottom: obj.height * inset.b,
        }}
      >
        {editor ?? <TextBodyView body={obj.text} />}
      </div>
    </>
  );
}

export const isTextEmpty = (body: TextBody) => body.paragraphs.every((p) => p.runs.every((r) => !r.text));

/** 비어 있는 개체 틀: 편집 화면에서는 회색 안내 문구, 그 외(축소판·발표)에서는 표시하지 않음 */
function PromptOrBody({ obj, showPrompt }: { obj: TextObject; showPrompt: boolean }) {
  if (!isTextEmpty(obj.text)) return <TextBodyView body={obj.text} />;
  if (!showPrompt || !obj.placeholder) return null;
  const first = obj.text.paragraphs[0];
  const prompt: TextBody = {
    ...obj.text,
    paragraphs: [{ ...first, runs: [{ ...(first?.runs[0] ?? {}), text: obj.placeholder, color: '#8C8C8C' }] }],
  };
  return (
    <>
      <TextBodyView body={prompt} />
      <div className="sl-placeholder-frame" />
    </>
  );
}

function TextContent({ obj, assets, editor, showPrompt }: { obj: TextObject; assets: Assets; editor: ReactNode; showPrompt: boolean }) {
  const sw = obj.stroke ? ptToPx(obj.stroke.width) : 0;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          ...fillToCss(obj.fill, assets),
          outline: obj.stroke ? `${sw}px ${obj.stroke.dash === 'solid' ? 'solid' : obj.stroke.dash === 'dot' ? 'dotted' : 'dashed'} ${obj.stroke.color}` : undefined,
          outlineOffset: -sw / 2,
        }}
      />
      {editor ?? <PromptOrBody obj={obj} showPrompt={showPrompt} />}
    </>
  );
}

function LineContent({ obj }: { obj: LineObject }) {
  const w = obj.width, h = obj.height;
  let x1 = 0, y1 = 0, x2 = w, y2 = h;
  if (obj.flipH) [x1, x2] = [x2, x1];
  if (obj.flipV) [y1, y2] = [y2, y1];
  const sw = ptToPx(obj.stroke.width);
  const mid = (pos: 's' | 'e') => `m-${obj.id}-${pos}`;
  const marker = (id: string, head: LineObject['headEnd']) => {
    if (head === 'none') return null;
    return (
      <marker id={id} viewBox="0 0 10 10" refX={head === 'oval' ? 5 : 8} refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth">
        {head === 'triangle' && <path d="M0,0 L10,5 L0,10 Z" fill={obj.stroke.color} />}
        {head === 'arrow' && <path d="M1,1 L9,5 L1,9" fill="none" stroke={obj.stroke.color} strokeWidth="2" />}
        {head === 'oval' && <circle cx="5" cy="5" r="4" fill={obj.stroke.color} />}
      </marker>
    );
  };
  return (
    <svg width={Math.max(w, 1)} height={Math.max(h, 1)} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <defs>
        {marker(mid('s'), obj.headStart)}
        {marker(mid('e'), obj.headEnd)}
      </defs>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={obj.stroke.color}
        strokeOpacity={obj.stroke.opacity ?? 1}
        strokeWidth={sw}
        strokeDasharray={dashArray(obj.stroke)}
        strokeLinecap={obj.stroke.dash === 'dot' ? 'round' : 'butt'}
        markerStart={obj.headStart !== 'none' ? `url(#${mid('s')})` : undefined}
        markerEnd={obj.headEnd !== 'none' ? `url(#${mid('e')})` : undefined}
      />
      {/* 얇은 선도 쉽게 선택되도록 투명한 넓은 히트 영역 */}
      <line className="line-hit" x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(sw, 12)} />
    </svg>
  );
}

function ImageContent({ obj, assets }: { obj: ImageObject; assets: Assets }) {
  const a = assets[obj.assetId];
  const c = obj.crop;
  const fw = 1 - c.left - c.right;
  const fh = 1 - c.top - c.bottom;
  const iw = obj.width / Math.max(0.01, fw);
  const ih = obj.height / Math.max(0.01, fh);
  const sw = obj.stroke ? ptToPx(obj.stroke.width) : 0;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', transform: flipTransform(obj) }}>
      {a ? (
        <img
          src={a.dataUrl}
          alt={obj.name}
          draggable={false}
          style={{ position: 'absolute', left: -c.left * iw, top: -c.top * ih, width: iw, height: ih, maxWidth: 'none', userSelect: 'none' }}
        />
      ) : (
        <div className="sl-missing-image">이미지를 찾을 수 없음</div>
      )}
      {obj.stroke && <div style={{ position: 'absolute', inset: 0, border: `${sw}px solid ${obj.stroke.color}` }} />}
    </div>
  );
}
