import { createContext, memo, Suspense, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { Asset, EquationObject, ExtensionObject, Fill, ImageObject, LineObject, MediaObject, Paragraph, ShapeObject, SlideObject, Stroke, TableObject, TextBody, TextObject, TextRun, Theme, UnsupportedObject } from '../../types/model';
import { ChartView } from './ChartView';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { DEFAULT_THEME } from '../../themes/themes';
import { customPath, shapePath, shapeTextInset } from './shapeGeometry';
import { hexToRgba } from '../../utils/color';
import { ptToPx } from '../../utils/units';
import { computeNumbers, cssObjectToReact, inlineMathml, paragraphCss, runCss } from '../../editors/text/richText';
import { resolveTokensDeep } from '../../utils/themeColor';
import { patternDataUrl } from './patterns';
import { frameToCss } from '../animation/timeline';
import type { Frame } from '../animation/effects';
import { sanitizeMathml } from '../../services/math/omml';
import { ensureMathFont, MATH_FONT_STACK } from './mathFont';
import { getExtension } from '../../extensions/registry';

export type Assets = Record<string, Asset>;

/** 슬라이드 쇼 미디어 재생 옵션: 발표자 보기처럼 같은 슬라이드를 두 번 그릴 때 한쪽은 소리를 끔 */
export const ShowMediaContext = createContext<{ muted: boolean }>({ muted: false });

/* ───────────── 채우기 → CSS / SVG ───────────── */

/** 토큰(@accent1 등)을 테마 색으로 바꾼 개체 (테마별 캐시) */
const resolvedCache = new WeakMap<object, WeakMap<Theme, unknown>>();
export function resolveForRender<T extends object>(o: T, theme: Theme | undefined): T {
  if (!theme) return o;
  let byTheme = resolvedCache.get(o);
  if (!byTheme) resolvedCache.set(o, (byTheme = new WeakMap()));
  let r = byTheme.get(theme) as T | undefined;
  if (!r) byTheme.set(theme, (r = resolveTokensDeep(o, theme)));
  return r;
}

export function fillToCss(fill: Fill | undefined | null, assets: Assets, theme?: Theme): CSSProperties {
  if (!fill || fill.type === 'none') return {};
  if (theme) fill = resolveForRender(fill, theme);
  switch (fill.type) {
    case 'pattern': {
      const { url, size } = patternDataUrl(fill.preset, fill.fg, fill.bg);
      return { backgroundImage: `url("${url}")`, backgroundSize: `${size}px ${size}px` };
    }
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
  if (fill.type === 'pattern') {
    const { url, size } = patternDataUrl(fill.preset, fill.fg, fill.bg);
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
        <image href={url} width={size} height={size} />
      </pattern>
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

/** 문단 안 수식: 런의 글자 크기·색으로 MathML을 글줄 안에 그림 */
function InlineMathView({ run }: { run: TextRun }) {
  const html = useMemo(() => inlineMathml(run.math!.mathml), [run.math]);
  useEffect(() => ensureMathFont(), []);
  return <span className="sl-math-inline" data-latex={run.math!.latex} style={cssObjectToReact(runCss(run))} dangerouslySetInnerHTML={{ __html: html }} />;
}

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
    <div className="sl-p" data-bullet={p.bullet ?? 'none'} data-level={p.level ?? 0} data-num={num ?? undefined} data-char={p.bullet === 'bullet' ? p.bulletChar : undefined} style={cssObjectToReact(paragraphCss(p))}>
      {runs.length ? (
        runs.map((r, i) =>
          r.math ? (
            <InlineMathView key={i} run={r} />
          ) : r.link ? (
            <span key={i} data-link={r.link} className="sl-run-link" style={cssObjectToReact(runCss(r))}>
              {r.text}
            </span>
          ) : (
            <span key={i} style={cssObjectToReact(runCss(r))}>
              {r.text}
            </span>
          ),
        )
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

export type EditableObject = TextObject | ShapeObject | TableObject;
export type RenderMode = 'edit' | 'thumb' | 'show';

interface ObjectViewProps {
  obj: SlideObject;
  assets: Assets;
  theme?: Theme;
  /** 텍스트 편집기를 렌더링할 객체 ID (캔버스 전용) */
  editingTextId?: string | null;
  /** 표에서 편집 중인 셀 */
  editingCell?: [number, number] | null;
  renderEditor?: (obj: EditableObject, cell?: [number, number]) => ReactNode;
  /** 썸네일 등에서 상호작용 속성 생략 */
  interactive?: boolean;
  mode?: RenderMode;
  /** 표 셀 선택 영역 강조 (편집 캔버스) */
  cellSelection?: { r1: number; c1: number; r2: number; c2: number } | null;
  /** 애니메이션 프레임 (슬라이드 쇼/미리 보기) */
  frame?: Frame;
  /** 슬라이드 쇼에서 트리거 클릭 판별용 ID 표시 */
  tagId?: boolean;
}

export const ObjectView = memo(function ObjectView({ obj: raw, assets, theme, editingTextId, editingCell, renderEditor: renderEditorProp, interactive, mode, cellSelection, frame, tagId }: ObjectViewProps) {
  if (raw.hidden) return null;
  // 편집기는 토큰이 살아 있는 원본을, 화면 표시는 테마 색으로 해석한 개체를 사용
  const obj = resolveForRender(raw, theme);
  const renderEditor = renderEditorProp ? (o: EditableObject, cell?: [number, number]) => renderEditorProp((o.id === raw.id ? raw : o) as EditableObject, cell) : undefined;
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
  // 자유형(병합 결과 등)은 상자가 아니라 실제 채움 영역(구멍 제외)·선으로만 클릭되게: 상자는 통과, SVG 경로가 받음
  if (obj.type === 'shape' && obj.shape === 'custom' && editingTextId !== obj.id) style.pointerEvents = 'none';
  if (frame) {
    const fc = frameToCss(frame, obj.rotation);
    if (fc) {
      style.transform = fc.transform;
      style.opacity = (obj.opacity ?? 1) * (frame.opacity ?? 1);
      if (fc.visibility) style.visibility = fc.visibility;
      if (fc.clipPath) style.clipPath = fc.clipPath;
    }
  }
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
      content = obj.children.map((c) => <ObjectView key={c.id} obj={c} assets={assets} theme={theme} mode={mode} />);
      break;
    case 'table':
      content = <TableContent obj={obj} editingCell={editing ? editingCell ?? null : null} renderEditor={renderEditor} selection={cellSelection ?? null} interactive={!!interactive} />;
      break;
    case 'chart':
      content = <ChartView chart={obj} theme={theme ?? DEFAULT_THEME} />;
      break;
    case 'media':
      content = <MediaContent obj={obj} assets={assets} mode={mode ?? (interactive ? 'edit' : 'thumb')} />;
      break;
    case 'equation':
      content = <EquationContent obj={obj} />;
      break;
    case 'extension':
      content = <ExtensionContent obj={obj} assets={assets} mode={mode ?? (interactive ? 'edit' : 'thumb')} />;
      break;
    case 'unsupported':
      content = <UnsupportedContent obj={obj} />;
      break;
  }
  return (
    <div className={`sl-obj sl-obj-${obj.type}`} style={style} data-obj-id={interactive || tagId ? obj.id : undefined} data-link={obj.link || undefined}>
      {content}
    </div>
  );
});

/** 확장 개체: 편집·쇼에서는 확장의 View, 썸네일·인쇄·그림 내보내기에서는 대체 그림 */
function ExtensionContent({ obj, assets, mode }: { obj: ExtensionObject; assets: Assets; mode: RenderMode }) {
  const ext = getExtension(obj.kind);
  const poster = obj.posterId ? assets[obj.posterId]?.dataUrl : '';
  const posterEl = poster ? <img src={poster} alt={ext?.describe?.(obj) ?? obj.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <div className="sl-ext-missing">{ext?.name ?? obj.kind}</div>;
  // usePoster: 가져온 원본(PowerPoint)이 그린 그림을 바꾸기 전까지 그대로 표시
  if (mode === 'thumb' || !ext || (obj.data.usePoster && poster)) return posterEl;
  const View = ext.View;
  return (
    <Suspense fallback={posterEl}>
      <View obj={obj} assets={assets} mode={mode === 'show' ? 'show' : 'edit'} fallback={posterEl} />
    </Suspense>
  );
}

/** 수식: 저장된 MathML을 정화해 표시 (글꼴은 STIX Two Math) */
const EquationContent = memo(function EquationContent({ obj }: { obj: EquationObject }) {
  ensureMathFont();
  const html = useMemo(() => sanitizeMathml(obj.mathml), [obj.mathml]);
  return (
    <div
      className="sl-eq"
      style={{ justifyContent: obj.align === 'left' ? 'flex-start' : obj.align === 'right' ? 'flex-end' : 'center', fontSize: `${ptToPx(obj.fontSize)}px`, color: obj.color, fontFamily: MATH_FONT_STACK }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

function flipTransform(o: SlideObject) {
  if (!o.flipH && !o.flipV) return undefined;
  return `scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1})`;
}

function ShapeContent({ obj, assets, editor }: { obj: ShapeObject; assets: Assets; editor: ReactNode }) {
  const gid = `g-${obj.id}`;
  const custom = obj.shape === 'custom';
  const d = shapePath(obj.shape, obj.width, obj.height, obj.geometry);
  const strokeD = custom ? customPath(obj.geometry, obj.width, obj.height, 'stroke') : d;
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
        {custom && <path d={d} {...svgFillAttrs(obj.fill, gid)} fillRule={obj.geometry?.fillRule} stroke="none" style={{ pointerEvents: 'fill' }} />}
        <path
          d={custom ? strokeD : d}
          style={custom ? { pointerEvents: 'stroke' } : undefined}
          {...(custom ? { fill: 'none' } : svgFillAttrs(obj.fill, gid))}
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
          // 자유형의 글자 영역은 클릭을 경로로 넘김 (편집 중에는 받음)
          ...(custom && !editor ? { pointerEvents: 'none' as const } : {}),
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

const UNSUPPORTED_ICONS: Record<UnsupportedObject['kind'], string> = {
  table: '표',
  chart: '차트',
  smartart: 'SmartArt',
  media: '미디어',
  ole: 'OLE 개체',
  image: '그림',
  other: '개체',
};

/** 아직 편집할 수 없는 PPTX 요소: 원본은 보존되며 위치/크기만 편집 가능 */
function UnsupportedContent({ obj }: { obj: UnsupportedObject }) {
  if (obj.preview && obj.kind === 'table') {
    const totalW = obj.preview.cols.reduce((a, b) => a + b, 0) || 1;
    const totalH = obj.preview.rows.reduce((a, b) => a + b.height, 0) || 1;
    return (
      <div className="sl-unsupported sl-table-preview" title={`${obj.label} — 원본 보존됨 (표 편집은 8단계)`}>
        <table style={{ width: '100%', height: '100%' }}>
          <colgroup>
            {obj.preview.cols.map((c, i) => (
              <col key={i} style={{ width: `${(c / totalW) * 100}%` }} />
            ))}
          </colgroup>
          <tbody>
            {obj.preview.rows.map((r, ri) => (
              <tr key={ri} style={{ height: `${(r.height / totalH) * 100}%` }}>
                {r.cells.map((c, ci) => (
                  <td key={ci}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="sl-unsupported" title="원본 XML이 보존되어 PPTX로 저장할 때 그대로 복원됩니다">
      <span className="sl-unsupported-kind">{UNSUPPORTED_ICONS[obj.kind]}</span>
      <span className="sl-unsupported-label">{obj.label}</span>
      <span className="sl-unsupported-note">원본 보존 · 편집은 다음 단계에서 지원</span>
    </div>
  );
}

/* ───────────── 표 ───────────── */

const borderCss = (s: Stroke | null) => (s ? `${Math.max(0.5, ptToPx(s.width))}px ${s.dash === 'solid' ? 'solid' : s.dash === 'dot' ? 'dotted' : 'dashed'} ${s.color}` : 'none');

function TableContent({
  obj,
  editingCell,
  renderEditor,
  selection,
  interactive,
}: {
  interactive: boolean;
  obj: TableObject;
  editingCell: [number, number] | null;
  renderEditor?: (obj: EditableObject, cell?: [number, number]) => ReactNode;
  selection: { r1: number; c1: number; r2: number; c2: number } | null;
}) {
  const sel = selection;
  return (
    <table className="sl-table" style={{ width: obj.width, borderCollapse: 'collapse', tableLayout: 'fixed', position: 'absolute', left: 0, top: 0 }}>
      <colgroup>
        {obj.columns.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {obj.rows.map((row, r) => (
          <tr key={r} style={{ height: row.height }}>
            {row.cells.map((cell, c) => {
              if (cell.merged) return null;
              const editing = editingCell && editingCell[0] === r && editingCell[1] === c;
              const inSel = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
              return (
                <td
                  key={c}
                  data-cell={interactive ? `${r},${c}` : undefined}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  className={inSel ? 'sl-cell-selected' : undefined}
                  style={{
                    padding: 0,
                    position: 'relative',
                    verticalAlign: cell.text.vAlign === 'middle' ? 'middle' : cell.text.vAlign === 'bottom' ? 'bottom' : 'top',
                    borderTop: borderCss(cell.borders.top),
                    borderRight: borderCss(cell.borders.right),
                    borderBottom: borderCss(cell.borders.bottom),
                    borderLeft: borderCss(cell.borders.left),
                    ...fillToCss(cell.fill, {}),
                  }}
                >
                  <div className="sl-cell" style={{ position: 'relative', padding: `${cell.text.padding.top}px ${cell.text.padding.right}px ${cell.text.padding.bottom}px ${cell.text.padding.left}px` }}>
                    {editing && renderEditor ? renderEditor(obj, [r, c]) : <CellText body={cell.text} />}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 셀 텍스트: 셀 크기에 따라 흐르도록 정적 배치 (TextBodyView는 절대 배치) */
export function CellText({ body }: { body: TextBody }) {
  const nums = computeNumbers(body.paragraphs);
  return (
    <div className={`sl-text-inner ${textDirClass(body)}`} style={textInnerStyle(body)}>
      {body.paragraphs.map((p, i) => (
        <ParagraphView key={i} p={p} num={nums[i]} />
      ))}
    </div>
  );
}

/* ───────────── 미디어 ───────────── */

function MediaContent({ obj, assets, mode }: { obj: MediaObject; assets: Assets; mode: RenderMode }) {
  const asset = assets[obj.assetId];
  const poster = obj.posterId ? assets[obj.posterId]?.dataUrl : undefined;
  const url = useAssetUrl(mode === 'thumb' ? undefined : asset);
  const { muted } = useContext(ShowMediaContext);
  if (obj.kind === 'audio') {
    // 쇼 중 숨기기(내레이션 등): 아이콘은 숨기고 소리만 재생
    if (mode === 'show' && obj.hideInShow) {
      return <div style={{ visibility: 'hidden' }}>{url && <audio src={url} autoPlay={obj.autoPlay} loop={obj.loop} muted={muted} />}</div>;
    }
    return (
      <div className="sl-media sl-audio">
        <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#3a3a3a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5z" fill="#3a3a3a" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        </svg>
        {mode === 'show' && url && <audio src={url} controls autoPlay={obj.autoPlay} loop={obj.loop} muted={muted} className="sl-media-controls" />}
      </div>
    );
  }
  if (mode === 'thumb' || !url) {
    return (
      <div className="sl-media sl-video-placeholder" style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
        <span className="sl-play">▶</span>
        {!asset && <span className="sl-media-missing">미디어 파일 없음</span>}
      </div>
    );
  }
  return (
    <video
      className="sl-media"
      src={url}
      poster={poster}
      controls={mode === 'show'}
      autoPlay={mode === 'show' && obj.autoPlay}
      loop={obj.loop}
      preload="metadata"
      muted={mode !== 'show' || muted}
      style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', pointerEvents: mode === 'show' ? 'auto' : 'none' }}
    />
  );
}
