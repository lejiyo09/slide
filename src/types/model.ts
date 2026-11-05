/**
 * SlideLab 핵심 문서 모델 (JSON 직렬화 가능)
 *
 * 좌표계: 슬라이드 픽셀 단위 (96 px = 1 inch). 16:9 기본 = 1280 x 720 px (13.333in x 7.5in)
 * PPTX의 EMU 단위와의 변환: 1 px = 9525 EMU
 * 글꼴 크기는 pt 단위 (PowerPoint와 동일)
 */

export type ID = string;

/** 16진 색상 '#RRGGBB' */
export type Color = string;

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: Color; opacity?: number } // opacity 0..1
  | { type: 'gradient'; angle: number; stops: GradientStop[] }
  | { type: 'image'; assetId: ID; opacity?: number };

export type DashStyle = 'solid' | 'dash' | 'dot' | 'dashDot';

export interface Stroke {
  color: Color;
  width: number; // pt
  dash: DashStyle;
  opacity?: number;
}

export type ArrowHead = 'none' | 'triangle' | 'arrow' | 'oval';

export interface TextRunStyle {
  fontFamily?: string;
  fontSize?: number; // pt
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: Color;
  highlight?: Color;
}

export interface TextRun extends TextRunStyle {
  text: string;
}

export type HAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BulletType = 'none' | 'bullet' | 'number';

export interface Paragraph {
  runs: TextRun[];
  align?: HAlign;
  lineSpacing?: number; // 배수 (1.0 = 한 줄)
  bullet?: BulletType;
  level?: number; // 들여쓰기 수준 0..8
  spaceBefore?: number; // pt
  spaceAfter?: number; // pt
}

export type TextDirection = 'horizontal' | 'vertical' | 'vertical270';

export interface TextBody {
  paragraphs: Paragraph[];
  vAlign: VAlign;
  direction: TextDirection;
  padding: { top: number; right: number; bottom: number; left: number }; // px
  autoFit: 'none' | 'shrink' | 'resize';
  wrap: boolean;
}

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star5'
  | 'rightArrow'
  | 'leftArrow'
  | 'upArrow'
  | 'downArrow'
  | 'chevron'
  | 'parallelogram'
  | 'trapezoid'
  | 'heart'
  | 'cloud'
  | 'plus';

interface BaseObject {
  id: ID;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // 도(degree), 시계 방향
  flipH?: boolean;
  flipV?: boolean;
  opacity?: number; // 0..1, 기본 1
  locked?: boolean;
  hidden?: boolean;
  /** PPTX에서 가져왔으나 SlideLab이 해석하지 못한 원본 XML (재저장 시 보존용, 향후 단계) */
  sourceXml?: string;
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: TextBody;
  /** 레이아웃 개체 틀의 안내 문구 (비어 있을 때 편집 화면에만 표시, 발표/내보내기에는 미포함) */
  placeholder?: string;
  fill: Fill;
  stroke: Stroke | null;
}

export interface ShapeObject extends BaseObject {
  type: 'shape';
  shape: ShapeKind;
  fill: Fill;
  stroke: Stroke | null;
  text: TextBody;
}

export interface LineObject extends BaseObject {
  type: 'line';
  /** 선은 바운딩 박스 대각선으로 표현. flipH/flipV로 방향 결정 */
  stroke: Stroke;
  headStart: ArrowHead;
  headEnd: ArrowHead;
}

export interface ImageCrop {
  left: number; // 0..1 (원본 대비 비율)
  top: number;
  right: number;
  bottom: number;
}

export interface ImageObject extends BaseObject {
  type: 'image';
  assetId: ID;
  crop: ImageCrop;
  stroke: Stroke | null;
  /** 원본 픽셀 크기 */
  naturalWidth: number;
  naturalHeight: number;
}

export interface GroupObject extends BaseObject {
  type: 'group';
  /** 자식 좌표는 그룹 좌상단 기준 상대 좌표 */
  children: SlideObject[];
}

export type SlideObject = TextObject | ShapeObject | LineObject | ImageObject | GroupObject;
export type ObjectType = SlideObject['type'];

export interface SlideBackground {
  fill: Fill;
}

export interface Slide {
  id: ID;
  objects: SlideObject[]; // 배열 순서 = 레이어 순서 (뒤 → 앞)
  background: SlideBackground | null; // null = 테마 배경 사용
  notes: string;
  hidden?: boolean;
  layout: string; // 레이아웃 이름 (향후 마스터 연동)
}

export interface Section {
  id: ID;
  name: string;
  /** 섹션이 시작되는 슬라이드 */
  startSlideId: ID;
}

export interface Asset {
  id: ID;
  mime: string;
  /** data: URL (IndexedDB에 문서와 함께 저장) */
  dataUrl: string;
  name?: string;
}

export interface ThemeColors {
  dark1: Color;
  light1: Color;
  dark2: Color;
  light2: Color;
  accent1: Color;
  accent2: Color;
  accent3: Color;
  accent4: Color;
  accent5: Color;
  accent6: Color;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { heading: string; body: string };
  background: Fill;
}

export interface SlideSize {
  width: number; // px
  height: number; // px
  preset: '16:9' | '4:3' | 'custom';
}

export interface Presentation {
  id: ID;
  title: string;
  size: SlideSize;
  slides: Slide[];
  sections: Section[];
  assets: Record<ID, Asset>;
  theme: Theme;
  createdAt: number;
  updatedAt: number;
  version: 1;
}
