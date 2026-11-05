import { deepClone } from '../../utils/clone';
import type {
  ArrowHead,
  GroupObject,
  ImageObject,
  LineObject,
  Paragraph,
  Presentation,
  ShapeKind,
  ShapeObject,
  Slide,
  SlideObject,
  SlideSize,
  TextBody,
  TextObject,
  TextRunStyle,
  Theme,
  MasterSlide,
} from '../../types/model';
import { newId } from '../../utils/id';
import { DEFAULT_THEME } from '../../themes/themes';
import { BUILTIN_LAYOUTS, createBuiltinLayout, createBuiltinLayouts, createMaster, slideFromLayout, type BuiltinLayout } from './masters';

export const SLIDE_SIZES: Record<'16:9' | '4:3', SlideSize> = {
  '16:9': { width: 1280, height: 720, preset: '16:9' },
  '4:3': { width: 960, height: 720, preset: '4:3' },
};

export type SlideLayout = BuiltinLayout;
export const LAYOUTS = BUILTIN_LAYOUTS;

export function paragraph(text: string, style: TextRunStyle = {}, extra: Partial<Paragraph> = {}): Paragraph {
  return { runs: [{ text, ...style }], align: 'left', lineSpacing: 1, bullet: 'none', level: 0, ...extra };
}

export function textBody(paragraphs: Paragraph[], extra: Partial<TextBody> = {}): TextBody {
  return {
    paragraphs: paragraphs.length ? paragraphs : [paragraph('')],
    vAlign: 'top',
    direction: 'horizontal',
    padding: { top: 5, right: 10, bottom: 5, left: 10 },
    autoFit: 'none',
    wrap: true,
    ...extra,
  };
}

export function createTextBox(opts: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  style?: TextRunStyle;
  para?: Partial<Paragraph>;
  name?: string;
  vAlign?: TextBody['vAlign'];
  placeholder?: string;
}): TextObject {
  const lines = (opts.text ?? '').split('\n');
  return {
    id: newId(),
    type: 'text',
    name: opts.name ?? '텍스트 상자',
    x: opts.x,
    y: opts.y,
    width: opts.width ?? 400,
    height: opts.height ?? 60,
    rotation: 0,
    fill: { type: 'none' },
    stroke: null,
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
    text: textBody(
      lines.map((l) => paragraph(l, { fontSize: 18, color: '#000000', ...opts.style }, opts.para)),
      { vAlign: opts.vAlign ?? 'top' },
    ),
  };
}

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: '사각형',
  roundRect: '모서리가 둥근 사각형',
  ellipse: '타원',
  triangle: '이등변 삼각형',
  rightTriangle: '직각 삼각형',
  diamond: '다이아몬드',
  pentagon: '오각형',
  hexagon: '육각형',
  octagon: '팔각형',
  star5: '별: 꼭짓점 5개',
  rightArrow: '오른쪽 화살표',
  leftArrow: '왼쪽 화살표',
  upArrow: '위쪽 화살표',
  downArrow: '아래쪽 화살표',
  chevron: '갈매기형 수장',
  parallelogram: '평행 사변형',
  trapezoid: '사다리꼴',
  heart: '하트',
  cloud: '구름',
  plus: '더하기 기호',
  custom: '자유형',
};

export function createShape(kind: ShapeKind, x: number, y: number, width = 200, height = 140, _theme: Theme = DEFAULT_THEME): ShapeObject {
  void _theme;
  return {
    id: newId(),
    type: 'shape',
    name: SHAPE_NAMES[kind],
    shape: kind,
    x,
    y,
    width,
    height,
    rotation: 0,
    // 테마 토큰: 테마/색 조합을 바꾸면 함께 바뀜
    fill: { type: 'solid', color: '@accent1' },
    stroke: { color: '@accent1~0.75', width: 1, dash: 'solid' },
    text: textBody([paragraph('', { fontSize: 18, color: '@light1', fontFamily: '@body' }, { align: 'center' })], { vAlign: 'middle' }),
  };
}


export function createLine(x: number, y: number, width: number, height: number, headEnd: ArrowHead = 'none', _theme: Theme = DEFAULT_THEME): LineObject {
  void _theme;
  return {
    id: newId(),
    type: 'line',
    name: headEnd === 'none' ? '직선' : '화살표',
    x,
    y,
    width,
    height,
    rotation: 0,
    stroke: { color: '@accent1', width: 2, dash: 'solid' },
    headStart: 'none',
    headEnd,
  };
}

export function createImage(assetId: string, naturalWidth: number, naturalHeight: number, slideSize: SlideSize): ImageObject {
  // 슬라이드의 70% 안에 들어가도록 비율 유지 축소
  const maxW = slideSize.width * 0.7;
  const maxH = slideSize.height * 0.7;
  const scale = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
  const width = Math.max(1, naturalWidth * scale);
  const height = Math.max(1, naturalHeight * scale);
  return {
    id: newId(),
    type: 'image',
    name: '그림',
    assetId,
    x: (slideSize.width - width) / 2,
    y: (slideSize.height - height) / 2,
    width,
    height,
    rotation: 0,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    stroke: null,
    naturalWidth,
    naturalHeight,
  };
}

export function createGroup(children: SlideObject[]): GroupObject {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of children) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.width);
    maxY = Math.max(maxY, c.y + c.height);
  }
  return {
    id: newId(),
    type: 'group',
    name: '그룹',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
    children: children.map((c) => ({ ...c, x: c.x - minX, y: c.y - minY })),
  };
}

/** 기본 제공 레이아웃으로 슬라이드 생성 (문서에 레이아웃이 있으면 그것을 사용) */
export function createSlide(layout: SlideLayout | string, size: SlideSize, _theme: Theme = DEFAULT_THEME, layoutDef?: MasterSlide): Slide {
  void _theme;
  if (layoutDef) return slideFromLayout(layoutDef);
  const builtin = BUILTIN_LAYOUTS.find((l) => l.id === layout)?.id ?? 'blank';
  return slideFromLayout(createBuiltinLayout(builtin, size));
}

export function createPresentation(title = '제목 없는 프레젠테이션', theme: Theme = DEFAULT_THEME): Presentation {
  const size = { ...SLIDE_SIZES['16:9'] };
  const now = Date.now();
  const { layouts, order } = createBuiltinLayouts(size);
  return {
    id: newId(),
    title,
    size,
    master: createMaster(size),
    layouts,
    layoutOrder: order,
    slides: [slideFromLayout(layouts.title)],
    sections: [],
    assets: {},
    theme,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** 객체 깊은 복제 + 새 ID 부여 */
export function cloneObject<T extends SlideObject>(obj: T, offset = 0): T {
  const copy = deepClone(obj) as T;
  const reId = (o: SlideObject) => {
    o.id = newId();
    if (o.type === 'group') o.children.forEach(reId);
  };
  reId(copy);
  copy.x += offset;
  copy.y += offset;
  return copy;
}

export function cloneSlide(slide: Slide): Slide {
  const copy = deepClone(slide);
  copy.id = newId();
  copy.objects = copy.objects.map((o) => cloneObject(o));
  return copy;
}

/** 슬라이드 텍스트를 평문으로 (축소판 제목 등에 사용) */
export function plainText(body: TextBody): string {
  return body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}
