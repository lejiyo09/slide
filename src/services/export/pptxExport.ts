/**
 * PPTX 내보내기 (pptxgenjs, MIT 라이선스)
 *
 * SlideLab 모델 → pptxgenjs API로 변환한다.
 * pptxgenjs가 지원하지 않는 요소는 근사 변환하고 경고 목록으로 사용자에게 알린다.
 * (향후 7단계에서 원본 XML 보존이 가능한 자체 OOXML 작성기로 확장 예정)
 */
import PptxGenJS from 'pptxgenjs';
import type { Fill, GroupObject, Paragraph, Presentation, ShapeKind, SlideObject, Stroke, TextBody } from '../../types/model';
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
      bullet: p.bullet === 'bullet' ? true : p.bullet === 'number' ? { type: 'number' } : undefined,
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
      warn('도형의 그라데이션 채우기는 단색(첫 번째 색)으로 변환되었습니다.');
      return { color: toPptxHex(fill.stops[0]?.color ?? '#FFFFFF') };
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

/** 그룹을 절대 좌표 객체 목록으로 평탄화 (pptxgenjs는 그룹을 지원하지 않음) */
function flatten(objs: SlideObject[], warn: (m: string) => void): SlideObject[] {
  const out: SlideObject[] = [];
  const walk = (o: SlideObject, parent: GroupObject | null) => {
    let abs = o;
    if (parent) {
      const gc = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
      const cc = { x: parent.x + o.x + o.width / 2, y: parent.y + o.y + o.height / 2 };
      const rc = rotatePoint(cc, gc, parent.rotation);
      abs = { ...o, x: rc.x - o.width / 2, y: rc.y - o.height / 2, rotation: (o.rotation + parent.rotation) % 360, opacity: (o.opacity ?? 1) * (parent.opacity ?? 1) } as SlideObject;
    }
    if (abs.type === 'group') {
      warn('그룹은 개별 개체로 풀어서 내보냈습니다(위치/모양은 유지).');
      abs.children.forEach((c) => walk(c, abs as GroupObject));
    } else out.push(abs);
  };
  objs.forEach((o) => walk(o, null));
  return out;
}

export async function buildPptx(doc: Presentation, opts: BuildOptions = {}): Promise<{ pptx: PptxGenJS; warnings: string[] }> {
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

  for (const s of doc.slides) {
    const secName = sectionOf.get(s.id);
    if (secName) {
      pptx.addSection({ title: secName });
      currentSection = secName;
    }
    const slide = pptx.addSlide(currentSection ? { sectionTitle: currentSection } : undefined);
    if (s.hidden) slide.hidden = true;

    // 배경
    const bg = s.background?.fill ?? doc.theme.background;
    if (bg.type === 'solid') slide.background = { color: toPptxHex(bg.color), transparency: bg.opacity !== undefined && bg.opacity < 1 ? Math.round((1 - bg.opacity) * 100) : undefined };
    else if (bg.type === 'image') {
      const a = doc.assets[bg.assetId];
      if (a) slide.background = { data: a.dataUrl };
    } else if (bg.type === 'gradient') {
      const img = opts.rasterizeGradient?.(bg, doc.size.width, doc.size.height);
      if (img) {
        slide.background = { data: img };
        warn('그라데이션 배경은 이미지로 변환되어 저장되었습니다.');
      } else {
        slide.background = { color: toPptxHex(bg.stops[0]?.color ?? '#FFFFFF') };
        warn('그라데이션 배경은 단색으로 변환되었습니다.');
      }
    }

    for (const o of flatten(s.objects, warn)) {
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
      switch (o.type) {
        case 'text':
        case 'shape': {
          if (o.type === 'text' && o.placeholder && o.fill.type === 'none' && !o.stroke && o.text.paragraphs.every((p) => p.runs.every((r) => !r.text))) break;
          const fill = fillOpts(o.fill, opacity, warn);
          const shapeName = o.type === 'shape' ? SHAPE_MAP[o.shape] : 'rect';
          slide.addText(paragraphsToRuns(o.text), {
            ...pos,
            ...textBodyOpts(o.text),
            shape: shapeName as PptxGenJS.ShapeType,
            fill,
            line: lineOpts(o.stroke, opacity),
            rectRadius: o.type === 'shape' && o.shape === 'roundRect' ? Math.min(pos.w, pos.h) * 0.1667 : undefined,
          });
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
          });
          break;
        }
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return { pptx, warnings: [...warnings] };
}

/** 브라우저: PPTX Blob 생성 */
export async function exportPptxBlob(doc: Presentation): Promise<{ blob: Blob; warnings: string[] }> {
  const { pptx, warnings } = await buildPptx(doc, { rasterizeGradient: browserGradientRasterizer, cropImage: browserImageCropper });
  const blob = (await pptx.write({ outputType: 'blob', compression: true })) as Blob;
  return { blob, warnings };
}
