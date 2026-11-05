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
} from '../../types/model';
import { newId } from '../../utils/id';
import { DEFAULT_THEME } from '../../themes/themes';

export const SLIDE_SIZES: Record<'16:9' | '4:3', SlideSize> = {
  '16:9': { width: 1280, height: 720, preset: '16:9' },
  '4:3': { width: 960, height: 720, preset: '4:3' },
};

export type SlideLayout = 'title' | 'titleContent' | 'sectionHeader' | 'twoContent' | 'titleOnly' | 'blank';

export const LAYOUTS: { id: SlideLayout; name: string }[] = [
  { id: 'title', name: '제목 슬라이드' },
  { id: 'titleContent', name: '제목 및 내용' },
  { id: 'sectionHeader', name: '구역 머리글' },
  { id: 'twoContent', name: '콘텐츠 2개' },
  { id: 'titleOnly', name: '제목만' },
  { id: 'blank', name: '빈 화면' },
];

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
};

export function createShape(kind: ShapeKind, x: number, y: number, width = 200, height = 140, theme: Theme = DEFAULT_THEME): ShapeObject {
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
    fill: { type: 'solid', color: theme.colors.accent1 },
    stroke: { color: shade(theme.colors.accent1), width: 1, dash: 'solid' },
    text: textBody([paragraph('', { fontSize: 18, color: '#FFFFFF' }, { align: 'center' })], { vAlign: 'middle' }),
  };
}

/** 약간 어둡게 (윤곽선 기본 색) */
function shade(hex: string) {
  const h = hex.replace('#', '');
  const ch = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.75).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
}

export function createLine(x: number, y: number, width: number, height: number, headEnd: ArrowHead = 'none', theme: Theme = DEFAULT_THEME): LineObject {
  return {
    id: newId(),
    type: 'line',
    name: headEnd === 'none' ? '직선' : '화살표',
    x,
    y,
    width,
    height,
    rotation: 0,
    stroke: { color: theme.colors.accent1, width: 2, dash: 'solid' },
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

function placeholderText(_text: string, size: number, theme: Theme, bold = false) {
  return { fontSize: size, color: theme.colors.dark1, fontFamily: theme.fonts.heading, bold };
}

export function createSlide(layout: SlideLayout, size: SlideSize, theme: Theme = DEFAULT_THEME): Slide {
  const W = size.width;
  const H = size.height;
  const m = W * 0.07;
  const objects: SlideObject[] = [];
  const body = { fontSize: 24, color: theme.colors.dark1, fontFamily: theme.fonts.body };

  switch (layout) {
    case 'title':
      objects.push(
        createTextBox({
          x: m, y: H * 0.28, width: W - 2 * m, height: H * 0.24, text: '',
          style: placeholderText('', 54, theme, true), para: { align: 'center' }, name: '제목', vAlign: 'bottom', placeholder: '제목을 입력하십시오',
        }),
        createTextBox({
          x: m, y: H * 0.55, width: W - 2 * m, height: H * 0.14, text: '',
          style: { ...body, color: theme.colors.dark2 }, para: { align: 'center' }, name: '부제목', placeholder: '부제목을 입력하십시오',
        }),
      );
      break;
    case 'titleContent':
      objects.push(
        createTextBox({ x: m, y: H * 0.06, width: W - 2 * m, height: H * 0.16, style: placeholderText('', 40, theme, true), name: '제목', vAlign: 'middle', placeholder: '제목을 입력하십시오' }),
        createTextBox({ x: m, y: H * 0.26, width: W - 2 * m, height: H * 0.64, style: body, para: { bullet: 'bullet' }, name: '내용', placeholder: '텍스트를 입력하십시오' }),
      );
      break;
    case 'sectionHeader':
      objects.push(
        createTextBox({ x: m, y: H * 0.3, width: W - 2 * m, height: H * 0.24, style: placeholderText('', 48, theme, true), name: '구역 제목', vAlign: 'bottom', placeholder: '구역 제목을 입력하십시오' }),
        createTextBox({ x: m, y: H * 0.56, width: W - 2 * m, height: H * 0.12, style: { ...body, color: theme.colors.dark2 }, name: '설명', placeholder: '텍스트를 입력하십시오' }),
      );
      break;
    case 'twoContent':
      objects.push(
        createTextBox({ x: m, y: H * 0.06, width: W - 2 * m, height: H * 0.16, style: placeholderText('', 40, theme, true), name: '제목', vAlign: 'middle', placeholder: '제목을 입력하십시오' }),
        createTextBox({ x: m, y: H * 0.26, width: (W - 2 * m) / 2 - 12, height: H * 0.64, style: body, para: { bullet: 'bullet' }, name: '내용 1', placeholder: '텍스트를 입력하십시오' }),
        createTextBox({ x: W / 2 + 12, y: H * 0.26, width: (W - 2 * m) / 2 - 12, height: H * 0.64, style: body, para: { bullet: 'bullet' }, name: '내용 2', placeholder: '텍스트를 입력하십시오' }),
      );
      break;
    case 'titleOnly':
      objects.push(createTextBox({ x: m, y: H * 0.06, width: W - 2 * m, height: H * 0.16, style: placeholderText('', 40, theme, true), name: '제목', vAlign: 'middle', placeholder: '제목을 입력하십시오' }));
      break;
    case 'blank':
      break;
  }
  return { id: newId(), objects, background: null, notes: '', layout };
}

export function createPresentation(title = '제목 없는 프레젠테이션', theme: Theme = DEFAULT_THEME): Presentation {
  const size = { ...SLIDE_SIZES['16:9'] };
  const now = Date.now();
  return {
    id: newId(),
    title,
    size,
    slides: [createSlide('title', size, theme)],
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
