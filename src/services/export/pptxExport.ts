/**
 * PPTX 내보내기 (pptxgenjs, MIT 라이선스)
 *
 * SlideLab 모델 → pptxgenjs API로 변환한다.
 * pptxgenjs가 지원하지 않는 요소는 근사 변환하고 경고 목록으로 사용자에게 알린다.
 * (향후 7단계에서 원본 XML 보존이 가능한 자체 OOXML 작성기로 확장 예정)
 */
import PptxGenJS from 'pptxgenjs';
import type { Asset, ChartObject, Fill, GroupObject, Paragraph, Presentation, ShapeKind, ShapeObject, SlideObject, Stroke, TableObject, TextBody } from '../../types/model';
import { isPristine, mediaPlaybackSignature } from '../../core/document/fingerprint';
import { buildShowPrXml, customShowPlan } from './showXml';
import { showSettingsOf } from '../../engines/show/showModel';
import { koreanCapable } from '../fonts/catalog';
import { designLayers } from '../../engines/rendering/SlideView';
import { resolveTokensDeep } from '../../utils/themeColor';
import { chartPalette } from '../../editors/chart/chart';
import { KEEP_PREFIX, postProcessPptx, type SlidePlan } from './preserve';
import { planEmbeddedFonts, type EmbedPlanFont } from '../fonts/embed';
import { buildTransitionXml } from './animXml';
import { OoxmlPackage } from '../import/ooxml';
import { getBlob, getPackage } from '../storage/db';
import { readAsDataUrl } from '../storage/files';
import { pxToInch, pxToPt } from '../../utils/units';
import { toPptxHex } from '../../utils/color';
import { rotatePoint } from '../../utils/geometry';

export interface ExportResult {
  warnings: string[];
}

const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  rightTriangle: 'rtTriangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  star5: 'star5',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  upArrow: 'upArrow',
  downArrow: 'downArrow',
  chevron: 'chevron',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  heart: 'heart',
  cloud: 'cloud',
  plus: 'plus',
  custom: 'custGeom',
};

const DASH_MAP: Record<Stroke['dash'], 'solid' | 'dash' | 'sysDot' | 'dashDot'> = {
  solid: 'solid',
  dash: 'dash',
  dot: 'sysDot',
  dashDot: 'dashDot',
};

/** 선택적: 그라데이션을 이미지로 래스터화 (브라우저 전용) */
export type GradientRasterizer = (fill: Extract<Fill, { type: 'gradient' }>, w: number, h: number) => string | null;

export function browserGradientRasterizer(fill: Extract<Fill, { type: 'gradient' }>, w: number, h: number): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(w, h));
  canvas.width = Math.max(2, Math.round(w * scale));
  canvas.height = Math.max(2, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const a = (fill.angle * Math.PI) / 180;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const len = Math.abs(canvas.width * Math.cos(a)) / 2 + Math.abs(canvas.height * Math.sin(a)) / 2;
  const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  fill.stops.forEach((s) => g.addColorStop(s.offset, s.color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** 이미지 자르기를 픽셀로 반영 (브라우저 전용). 실패 시 원본 반환 */
export type ImageCropper = (dataUrl: string, crop: { left: number; top: number; right: number; bottom: number }) => Promise<string>;

export const browserImageCropper: ImageCropper = (dataUrl, crop) =>
  new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      const sx = img.naturalWidth * crop.left;
      const sy = img.naturalHeight * crop.top;
      const sw = img.naturalWidth * (1 - crop.left - crop.right);
      const sh = img.naturalHeight * (1 - crop.top - crop.bottom);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw));
      c.height = Math.max(1, Math.round(sh));
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

interface BuildOptions {
  rasterizeGradient?: GradientRasterizer;
  cropImage?: ImageCropper;
  /** 원본 패키지가 있어 보존 XML을 복원할 수 있는가 */
  sourceAvailable?: boolean;
  /** 미디어 바이너리 → data URL (브라우저: IndexedDB) */
  loadMedia?: (asset: Asset) => Promise<string | null>;
}

type TextRunProps = PptxGenJS.TextProps;

function paragraphsToRuns(body: TextBody): TextRunProps[] {
  const out: TextRunProps[] = [];
  body.paragraphs.forEach((p: Paragraph, pi) => {
    const isLast = pi === body.paragraphs.length - 1;
    const paraOpts: PptxGenJS.TextPropsOptions = {
      align: p.align ?? 'left',
      lineSpacingMultiple: p.lineSpacing && p.lineSpacing !== 1 ? p.lineSpacing : undefined,
      indentLevel: p.level ? p.level : undefined,
      bullet:
        p.bullet === 'bullet'
          ? p.bulletChar
            ? { characterCode: p.bulletChar.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0') }
            : true
          : p.bullet === 'number'
            ? { type: 'number' }
            : undefined,
      paraSpaceBefore: p.spaceBefore || undefined,
      paraSpaceAfter: p.spaceAfter || undefined,
    };
    const runs = p.runs.length ? p.runs : [{ text: '' }];
    runs.forEach((r, ri) => {
      const lastRun = ri === runs.length - 1;
      out.push({
        text: r.text,
        options: {
          ...paraOpts,
          fontFace: r.fontFamily,
          fontSize: r.fontSize,
          bold: r.bold || undefined,
          italic: r.italic || undefined,
          underline: r.underline ? { style: 'sng' } : undefined,
          strike: r.strike ? 'sngStrike' : undefined,
          color: r.color ? toPptxHex(r.color) : undefined,
          highlight: r.highlight ? toPptxHex(r.highlight) : undefined,
          hyperlink: r.link ? { url: r.link } : undefined,
          breakLine: lastRun && !isLast ? true : undefined,
        },
      });
    });
  });
  return out;
}

function textBodyOpts(body: TextBody): Partial<PptxGenJS.TextPropsOptions> {
  const pad = body.padding;
  return {
    valign: body.vAlign,
    margin: [pxToPt(pad.left), pxToPt(pad.right), pxToPt(pad.bottom), pxToPt(pad.top)],
    vert: body.direction === 'vertical' ? 'eaVert' : body.direction === 'vertical270' ? 'vert270' : undefined,
    fit: body.autoFit === 'shrink' ? 'shrink' : body.autoFit === 'resize' ? 'resize' : undefined,
    wrap: body.wrap,
  };
}

function fillOpts(fill: Fill, objOpacity: number, warn: (m: string) => void): PptxGenJS.ShapeFillProps | undefined {
  switch (fill.type) {
    case 'none':
      return undefined;
    case 'solid': {
      const alpha = (fill.opacity ?? 1) * objOpacity;
      return { color: toPptxHex(fill.color), transparency: alpha < 1 ? Math.round((1 - alpha) * 100) : undefined };
    }
    case 'gradient':
      // 후처리(preserve.ts)에서 a:gradFill로 교체된다
      return { color: toPptxHex(fill.stops[0]?.color ?? '#FFFFFF') };
    case 'pattern':
      // 후처리에서 a:pattFill로 교체된다
      return { color: toPptxHex(fill.fg) };
    case 'image':
      warn('도형의 그림 채우기는 아직 PPTX로 내보내지 않습니다.');
      return undefined;
  }
}

function lineOpts(stroke: Stroke | null, objOpacity: number): PptxGenJS.ShapeLineProps | undefined {
  if (!stroke) return undefined;
  const alpha = (stroke.opacity ?? 1) * objOpacity;
  return {
    color: toPptxHex(stroke.color),
    width: stroke.width,
    dashType: DASH_MAP[stroke.dash],
    transparency: alpha < 1 ? Math.round((1 - alpha) * 100) : undefined,
  };
}

export interface GroupTag {
  key: string;
  name: string;
  sourceId?: number;
}

/**
 * 그룹을 절대 좌표 개체 목록으로 평탄화 (pptxgenjs는 그룹을 쓰지 못함).
 * 각 개체에 소속 그룹 경로를 남겨, 후처리에서 p:grpSp로 다시 묶는다.
 */
function flatten(objs: SlideObject[]): { obj: SlideObject; groups: GroupTag[] }[] {
  const out: { obj: SlideObject; groups: GroupTag[] }[] = [];
  const walk = (o: SlideObject, parent: GroupObject | null, groups: GroupTag[]) => {
    let abs = o;
    if (parent) {
      const gc = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
      const cc = { x: parent.x + o.x + o.width / 2, y: parent.y + o.y + o.height / 2 };
      const rc = rotatePoint(cc, gc, parent.rotation);
      abs = { ...o, x: rc.x - o.width / 2, y: rc.y - o.height / 2, rotation: (o.rotation + parent.rotation) % 360, opacity: (o.opacity ?? 1) * (parent.opacity ?? 1) } as SlideObject;
    }
    if (abs.type === 'group') {
      const tag: GroupTag = { key: o.id, name: o.name, sourceId: o.sourceId };
      abs.children.forEach((c) => walk(c, abs as GroupObject, [...groups, tag]));
    } else out.push({ obj: abs, groups });
  };
  objs.forEach((o) => walk(o, null, []));
  return out;
}

export async function buildPptx(source: Presentation, opts: BuildOptions = {}): Promise<{ pptx: PptxGenJS; warnings: string[]; plans: SlidePlan[] }> {
  // 테마 토큰(@accent1, @heading 등)을 실제 값으로 (PowerPoint 쪽 테마는 내보낸 개체에 고정 값으로 기록)
  const doc = resolveTokensDeep(source, source.theme);
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);
  const pptx = new PptxGenJS();
  pptx.title = doc.title;
  pptx.author = 'SlideLab';
  pptx.company = '';
  pptx.defineLayout({ name: 'SLIDELAB', width: pxToInch(doc.size.width), height: pxToInch(doc.size.height) });
  pptx.layout = 'SLIDELAB';
  pptx.theme = { headFontFace: doc.theme.fonts.heading, bodyFontFace: doc.theme.fonts.body };

  const sectionOf = new Map(doc.sections.map((s) => [s.startSlideId, s.name]));
  let currentSection: string | undefined;

  const plans: SlidePlan[] = [];
  for (const [slideIndex, s] of doc.slides.entries()) {
    const secName = sectionOf.get(s.id);
    if (secName) {
      pptx.addSection({ title: secName });
      currentSection = secName;
    }
    const slide = pptx.addSlide(currentSection ? { sectionTitle: currentSection } : undefined);
    if (s.hidden) slide.hidden = true;

    // 배경 (슬라이드 → 레이아웃 → 마스터 → 테마)
    const { bg, layers: designObjs } = designLayers(s, doc);
    if (bg.type === 'solid') slide.background = { color: toPptxHex(bg.color), transparency: bg.opacity !== undefined && bg.opacity < 1 ? Math.round((1 - bg.opacity) * 100) : undefined };
    else if (bg.type === 'image') {
      const a = doc.assets[bg.assetId];
      if (a) slide.background = { data: a.dataUrl };
    } else if (bg.type === 'gradient' || bg.type === 'pattern') {
      // 자리 표시 단색 → 후처리에서 a:gradFill / a:pattFill로 교체 (PowerPoint에서 편집 가능한 진짜 배경)
      slide.background = { color: toPptxHex(bg.type === 'gradient' ? bg.stops[0]?.color ?? '#FFFFFF' : bg.bg) };
    }

    // 전환/애니메이션: 가져온 뒤 바꾸지 않았으면 원본 XML, 아니면 모델에서 생성
    const keepTransition = !!s.source?.transitionXml && opts.sourceAvailable !== false && JSON.stringify(s.transition) === s.source.transitionFingerprint;
    const media = s.objects.flatMap((o) => (o.type === 'media' && (o.autoPlay || o.hideInShow || o.loop) && !o.hidden ? [{ id: o.id, kind: o.kind, autoPlay: !!o.autoPlay, hideInShow: !!o.hideInShow, loop: !!o.loop }] : []));
    const keepTiming =
      !!s.source?.timingXml &&
      JSON.stringify(s.animations ?? []) === s.source.animationFingerprint &&
      (s.source.mediaFingerprint === undefined || mediaPlaybackSignature(s.objects) === s.source.mediaFingerprint);
    const plan: SlidePlan = {
      index: slideIndex, emitted: [], objIds: [], fills: [], groupPaths: [], markers: new Map(),
      transitionXml: keepTransition ? s.source!.transitionXml : buildTransitionXml(s.transition),
      timingXml: keepTiming ? s.source!.timingXml : undefined,
      ...(!keepTiming && (s.animations?.length || media.length) ? { animations: s.animations ?? [], media, slideSize: doc.size } : {}),
      ...(bg.type === 'gradient' || bg.type === 'pattern' ? { background: bg } : {}),
    };
    if (!keepTiming && s.source?.timingXml && s.animations?.length) warn('애니메이션을 바꾼 슬라이드는 SlideLab 효과로 새로 저장되었습니다.');
    plans.push(plan);
    const layoutObjs = designObjs.map((o) => ({ ...o, sourceId: undefined }) as SlideObject);
    if (layoutObjs.length) warn('마스터/레이아웃 디자인 요소는 각 슬라이드에 포함되어 저장됩니다 (PowerPoint에서 보이는 모양은 같고, 마스터 구조는 SlideLab 안에서만 유지).');

    for (const { obj: o, groups } of flatten([...layoutObjs, ...s.objects])) {
      if (o.hidden) continue;
      const pos = {
        x: pxToInch(o.x),
        y: pxToInch(o.y),
        w: pxToInch(Math.max(o.width, 0)),
        h: pxToInch(Math.max(o.height, 0)),
        rotate: o.rotation || undefined,
        flipH: o.flipH || undefined,
        flipV: o.flipV || undefined,
        objectName: o.name,
      };
      const opacity = o.opacity ?? 1;
      const objLink = o.link ? { hyperlink: { url: o.link } } : {};
      const emit = () => {
        plan.emitted.push(o.sourceId);
        plan.objIds.push(o.id);
        plan.groupPaths.push(groups);
        plan.fills.push((o.type === 'shape' || o.type === 'text') && (o.fill.type === 'gradient' || o.fill.type === 'pattern') ? o.fill : undefined);
      };
      // 가져온 표·차트·미디어: 내용이 그대로면 원본 XML 복원 (위치/크기만 반영)
      if (o.type !== 'unsupported' && o.preserved && opts.sourceAvailable && isPristine(o)) {
        const marker = `${KEEP_PREFIX}${o.id}`;
        plan.markers.set(marker, { xml: o.preserved.xml, part: o.preserved.part, label: o.name });
        slide.addShape('rect' as PptxGenJS.ShapeType, { ...pos, flipH: undefined, flipV: undefined, objectName: marker });
        emit();
        continue;
      }
      if (o.type !== 'unsupported' && o.preserved && !isPristine(o)) warn('가져온 표/차트/미디어 중 내용을 바꾼 개체는 SlideLab 서식으로 새로 저장되었습니다.');
      switch (o.type) {
        case 'table':
          slide.addTable(tableRows(o), { ...pos, w: pxToInch(o.columns.reduce((a, b) => a + b, 0)), colW: o.columns.map(pxToInch), rowH: o.rows.map((r) => pxToInch(r.height)) });
          emit();
          break;
        case 'chart':
          addChart(pptx, slide, o, pos, doc);
          emit();
          break;
        case 'media': {
          const a = doc.assets[o.assetId];
          const data = a && opts.loadMedia ? await opts.loadMedia(a) : null;
          if (!data) {
            warn('미디어 파일을 읽을 수 없어 저장하지 못했습니다.');
            break;
          }
          const poster = o.posterId ? doc.assets[o.posterId]?.dataUrl : undefined;
          const extn = (a.name?.split('.').pop() ?? a.mime.split('/')[1] ?? 'mp4').toLowerCase();
          slide.addMedia({ ...pos, type: o.kind, data, extn, ...(poster ? { cover: poster } : {}) });
          emit();
          break;
        }
        case 'text':
        case 'shape': {
          if (o.type === 'text' && o.placeholder && o.fill.type === 'none' && !o.stroke && o.text.paragraphs.every((p) => p.runs.every((r) => !r.text))) break;
          const fill = fillOpts(o.fill, opacity, warn);
          let shapeName = o.type === 'shape' ? SHAPE_MAP[o.shape] : 'rect';
          // 가져온 도형의 원래 프리셋(근사 표시된 경우)을 그대로 기록
          if (o.type === 'shape' && o.sourcePreset) shapeName = o.sourcePreset;
          const points = o.type === 'shape' && o.shape === 'custom' ? geometryToPoints(o, warn) : undefined;
          slide.addText(paragraphsToRuns(o.text), {
            ...pos,
            ...textBodyOpts(o.text),
            shape: shapeName as PptxGenJS.ShapeType,
            fill,
            line: lineOpts(o.stroke, opacity),
            rectRadius: o.type === 'shape' && o.shape === 'roundRect' && !o.sourcePreset ? Math.min(pos.w, pos.h) * 0.1667 : undefined,
            ...(points ? { points } : {}),
            ...objLink,
          } as PptxGenJS.TextPropsOptions);
          emit();
          break;
        }
        case 'line':
          slide.addShape('line' as PptxGenJS.ShapeType, {
            ...pos,
            line: {
              ...lineOpts(o.stroke, opacity),
              beginArrowType: o.headStart === 'none' ? undefined : o.headStart,
              endArrowType: o.headEnd === 'none' ? undefined : o.headEnd,
            },
          });
          emit();
          break;
        case 'image': {
          const a = doc.assets[o.assetId];
          if (!a) {
            warn('찾을 수 없는 이미지가 있어 건너뛰었습니다.');
            break;
          }
          const c = o.crop;
          const cropped = c.left || c.top || c.right || c.bottom;
          let data = a.dataUrl;
          if (cropped) {
            if (opts.cropImage) data = await opts.cropImage(a.dataUrl, c);
            else warn('이미지 자르기가 내보내기에 반영되지 않았습니다.');
          }
          if (a.mime === 'image/svg+xml') warn('SVG 이미지는 PowerPoint 버전에 따라 표시되지 않을 수 있습니다.');
          slide.addImage({
            ...pos,
            data,
            transparency: opacity < 1 ? Math.round((1 - opacity) * 100) : undefined,
            altText: o.name,
            ...objLink,
          });
          emit();
          break;
        }
        case 'unsupported': {
          // 자리 표시 도형: 후처리에서 원본 XML로 교체된다 (위치/크기/회전은 이 도형에서 읽음)
          const marker = `${KEEP_PREFIX}${o.id}`;
          plan.markers.set(marker, { xml: o.sourceXml, part: o.sourcePart, label: o.label });
          slide.addShape('rect' as PptxGenJS.ShapeType, { ...pos, flipH: undefined, flipV: undefined, objectName: marker });
          emit();
          break;
        }
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return { pptx, warnings: [...warnings], plans };
}

const borderOpt = (s: Stroke | null): PptxGenJS.BorderProps =>
  s ? { type: s.dash === 'solid' ? 'solid' : 'dash', pt: s.width, color: toPptxHex(s.color) } : { type: 'none' };

function tableRows(t: TableObject): PptxGenJS.TableRow[] {
  return t.rows.map((row) =>
    row.cells
      .filter((c) => !c.merged)
      .map((cell) => {
        const p = cell.text.padding;
        return {
          text: paragraphsToRuns(cell.text) as PptxGenJS.TableCell[],
          options: {
            colspan: cell.colSpan,
            rowspan: cell.rowSpan,
            fill: cell.fill.type === 'solid' ? { color: toPptxHex(cell.fill.color) } : cell.fill.type === 'gradient' ? { color: toPptxHex(cell.fill.stops[0].color) } : undefined,
            border: [borderOpt(cell.borders.top), borderOpt(cell.borders.right), borderOpt(cell.borders.bottom), borderOpt(cell.borders.left)],
            valign: cell.text.vAlign,
            // 표 셀 여백: [위, 오른쪽, 아래, 왼쪽] pt (1 미만은 인치로 해석되므로 최소 1pt)
            margin: [p.top, p.right, p.bottom, p.left].map((v) => Math.max(1, pxToPt(v))) as [number, number, number, number],
          },
        };
      }),
  );
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, c: ChartObject, pos: { x: number; y: number; w: number; h: number; objectName?: string }, doc: Presentation) {
  const radial = c.chartType === 'pie' || c.chartType === 'doughnut';
  const palette = chartPalette(doc.theme, Math.max(c.series.length, c.categories.length), c.colors);
  const colors = radial ? c.categories.map((_, i) => palette[i]) : c.series.map((s, i) => s.color ?? palette[i]);
  let data: PptxGenJS.OptsChartData[];
  if (c.chartType === 'scatter') {
    const xs = c.series[0]?.xValues ?? c.series[0]?.values.map((_, i) => i + 1) ?? [];
    data = [{ name: 'X', values: xs }, ...c.series.map((s) => ({ name: s.name, values: s.values }))];
  } else data = (radial ? c.series.slice(0, 1) : c.series).map((s) => ({ name: s.name, labels: c.categories, values: s.values }));
  const type = { column: pptx.ChartType.bar, bar: pptx.ChartType.bar, line: pptx.ChartType.line, area: pptx.ChartType.area, pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut, scatter: pptx.ChartType.scatter }[c.chartType];
  const fs = c.fontSize;
  slide.addChart(type as unknown as PptxGenJS.CHART_NAME, data, {
    ...pos,
    chartColors: colors.map(toPptxHex),
    showLegend: c.showLegend,
    legendPos: c.legendPos,
    legendFontSize: fs,
    showTitle: !!(c.showTitle && c.title),
    title: c.title || undefined,
    titleFontSize: Math.round(fs * 1.33),
    showValue: c.showDataLabels,
    dataLabelFontSize: fs,
    catAxisLabelFontSize: fs,
    valAxisLabelFontSize: fs,
    barDir: c.chartType === 'bar' ? 'bar' : 'col',
    barGrouping: c.stacked ? 'stacked' : 'clustered',
    ...(c.chartType === 'area' && c.stacked ? { barGrouping: 'stacked' } : {}),
    ...(c.chartType === 'doughnut' ? { holeSize: 50 } : {}),
    ...(c.chartType === 'scatter' ? { lineSize: 0, lineDataSymbolSize: 8 } : {}),
    ...(radial && c.showDataLabels ? { showPercent: false, showValue: true } : {}),
  });
}

function geometryToPoints(o: ShapeObject, warn: (m: string) => void) {
  const w = pxToInch(o.width), h = pxToInch(o.height);
  const pts: NonNullable<PptxGenJS.ShapeProps['points']> = [];
  const paths = o.geometry?.paths ?? [];
  if (paths.length > 1) warn('여러 경로로 된 자유형 도형은 하나의 경로로 저장됩니다.');
  for (const p of paths)
    for (const c of p.cmds) {
      if (c.c === 'M') pts.push({ x: c.x * w, y: c.y * h, moveTo: true });
      else if (c.c === 'L') pts.push({ x: c.x * w, y: c.y * h });
      else if (c.c === 'C') pts.push({ x: c.x * w, y: c.y * h, curve: { type: 'cubic', x1: c.x1 * w, y1: c.y1 * h, x2: c.x2 * w, y2: c.y2 * h } });
      else pts.push({ close: true });
    }
  return pts.length ? pts : undefined;
}

/**
 * PPTX 바이트 생성 + 원본 보존 후처리.
 * sourcePackage: 가져온 원본 PPTX (보존된 표·차트 등을 복원하는 데 필요)
 */
export async function exportPptxBytes(
  doc: Presentation,
  opts: BuildOptions & { sourcePackage?: ArrayBuffer | Uint8Array | Blob | null; embeddedFonts?: EmbedPlanFont[] } = {},
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const { pptx, warnings, plans } = await buildPptx(doc, { ...opts, sourceAvailable: !!opts.sourcePackage });
  const raw = (await pptx.write({ outputType: 'uint8array', compression: true })) as Uint8Array;
  const extra: string[] = [];
  const source = opts.sourcePackage ? await OoxmlPackage.load(opts.sourcePackage) : null;
  const pres = {
    showPrXml: buildShowPrXml(showSettingsOf(doc), doc.customShows),
    customShows: customShowPlan(doc),
    themeEastAsian: { major: koreanCapable(doc.theme.fonts.heading) ? doc.theme.fonts.heading : null, minor: koreanCapable(doc.theme.fonts.body) ? doc.theme.fonts.body : null },
    embeddedFonts: opts.embeddedFonts,
  };
  const bytes = await postProcessPptx(raw, plans, source, (m) => extra.push(m), pres);
  return { bytes, warnings: [...new Set([...warnings, ...extra])] };
}

/** 브라우저: PPTX Blob 생성 (원본 패키지는 IndexedDB에서 읽음) */
export async function exportPptxBlob(doc: Presentation): Promise<{ blob: Blob; warnings: string[] }> {
  let sourcePackage: Blob | null = null;
  if (doc.source) {
    sourcePackage = (await getPackage(doc.source.packageId)) ?? null;
  }
  const loadMedia = async (a: Asset) => {
    if (!a.blobKey) return a.dataUrl || null;
    const b = await getBlob(a.blobKey);
    return b ? readAsDataUrl(b) : null;
  };
  // 포함 글꼴: 문서에 쓰인 내 글꼴 (문서 설정 '파일의 글꼴 포함'이 꺼져 있으면 넣지 않음)
  const fontWarnings: string[] = [];
  let embeddedFonts: EmbedPlanFont[] | undefined;
  if (doc.embedFonts !== false) {
    const { fontsUsed } = await import('../fonts/docFonts');
    const { userFontRecords } = await import('../fonts/library');
    const used = [...fontsUsed(doc).keys()];
    const recs = await userFontRecords(used);
    if (recs.length) {
      const plan = await planEmbeddedFonts(used, recs);
      embeddedFonts = plan.fonts;
      fontWarnings.push(...plan.skipped);
      if (plan.fonts.length) fontWarnings.push(`글꼴 ${plan.fonts.length}개(${plan.fonts.map((f) => f.typeface).join(', ')})를 파일에 포함했습니다 (${(plan.bytes / 1024 / 1024).toFixed(1)}MB).`);
    }
  }
  const { bytes, warnings } = await exportPptxBytes(doc, { rasterizeGradient: browserGradientRasterizer, cropImage: browserImageCropper, sourcePackage, loadMedia, embeddedFonts });
  warnings.push(...fontWarnings);
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  return { blob, warnings };
}
