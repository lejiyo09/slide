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
  /** 하이퍼링크 URL */
  link?: string;
}

export type HAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BulletType = 'none' | 'bullet' | 'number';

export interface Paragraph {
  runs: TextRun[];
  align?: HAlign;
  lineSpacing?: number; // 배수 (1.0 = 한 줄)
  bullet?: BulletType;
  /** 글머리 기호 문자 (기본 '•') */
  bulletChar?: string;
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
  | 'plus'
  /** PPTX 사용자 지정 도형(custGeom) 또는 미지원 프리셋의 경로 */
  | 'custom';

/** 사용자 지정 도형 경로: 좌표는 0..1로 정규화 (도형 크기에 맞춰 늘어남) */
export type PathCommand =
  | { c: 'M' | 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Z' };

export interface CustomGeometry {
  paths: { cmds: PathCommand[]; fill: boolean; stroke: boolean }[];
}

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
  /** PPTX에서 가져온 개체의 원본 cNvPr id (애니메이션 대상 참조 유지용) */
  sourceId?: number;
  /**
   * 가져온 표·차트·미디어의 원본 XML. 내용 지문(fingerprint)이 그대로면 저장 시 원본을 복원하고,
   * 사용자가 내용을 바꿨으면 모델에서 새로 생성한다.
   */
  preserved?: { xml: string; part: string; fingerprint: string };
  /** 개체 클릭 시 이동할 링크 (슬라이드 쇼) */
  link?: string;
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
  /** shape === 'custom' 일 때의 경로 */
  geometry?: CustomGeometry;
  /** 원본 프리셋 이름 (PPTX prstGeom, 근사 렌더링된 경우) */
  sourcePreset?: string;
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

/* ───────────── 표 ───────────── */

export interface CellBorders {
  top: Stroke | null;
  right: Stroke | null;
  bottom: Stroke | null;
  left: Stroke | null;
}

export interface TableCell {
  text: TextBody;
  fill: Fill;
  borders: CellBorders;
  colSpan?: number;
  rowSpan?: number;
  /** 다른 셀의 병합 영역에 덮인 셀 */
  merged?: boolean;
}

export interface TableRow {
  height: number; // px (최소 높이)
  cells: TableCell[];
}

export type TableStylePreset = 'medium2' | 'light1' | 'grid' | 'plain' | 'dark1';

export interface TableObject extends BaseObject {
  type: 'table';
  columns: number[]; // 열 너비 px
  rows: TableRow[];
  style?: { preset: TableStylePreset; accent: number; firstRow: boolean; bandRows: boolean; firstCol: boolean; lastRow: boolean };
}

/* ───────────── 차트 ───────────── */

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter';

export interface ChartSeries {
  name: string;
  values: number[];
  color?: Color;
  /** 분산형: X 값 */
  xValues?: number[];
}

export interface ChartObject extends BaseObject {
  type: 'chart';
  chartType: ChartType;
  categories: string[];
  series: ChartSeries[];
  title?: string;
  showTitle: boolean;
  showLegend: boolean;
  legendPos: 'r' | 'b' | 't' | 'l';
  showDataLabels: boolean;
  stacked: boolean;
  /** 테마 강조색 대신 사용할 색 목록 */
  colors?: Color[];
  fontSize: number; // pt
}

/* ───────────── 미디어 ───────────── */

export interface MediaObject extends BaseObject {
  type: 'media';
  kind: 'video' | 'audio';
  /** 미디어 원본 (Asset.blobKey로 IndexedDB에 저장) */
  assetId: ID;
  /** 표지 이미지 자산 */
  posterId?: ID;
  autoPlay?: boolean;
  loop?: boolean;
}

export type UnsupportedKind = 'table' | 'chart' | 'smartart' | 'media' | 'ole' | 'image' | 'other';

/** 표 미리보기 (읽기 전용 렌더링용) */
export interface TablePreview {
  cols: number[]; // 열 너비 px
  rows: { height: number; cells: string[] }[];
}

/**
 * SlideLab이 아직 편집하지 못하는 PPTX 요소 (표, 차트, SmartArt, 미디어 등).
 * 원본 XML을 그대로 보관해 PPTX로 다시 저장할 때 관련 파트(차트, 내장 파일 등)와 함께 복원한다.
 * 이동/크기 조절/삭제는 가능하며, 변경된 위치·크기는 저장 시 XML에 반영된다.
 */
export interface UnsupportedObject extends BaseObject {
  type: 'unsupported';
  kind: UnsupportedKind;
  label: string;
  /** 원본 요소 XML (네임스페이스 선언 포함) */
  sourceXml: string;
  /** 원본 패키지에서 이 요소가 속한 파트 경로 (관계 r:id 해석용) */
  sourcePart: string;
  preview?: TablePreview;
}

export type SlideObject = TextObject | ShapeObject | LineObject | ImageObject | GroupObject | TableObject | ChartObject | MediaObject | UnsupportedObject;
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
  layout: string; // 레이아웃 ID (doc.layouts의 키 또는 기본 레이아웃 이름)
  /** 마스터/레이아웃의 디자인 개체 표시 여부 (PPTX showMasterSp) */
  showMasterShapes?: boolean;
  /** PPTX에서 가져온 슬라이드의 원본 XML 조각 (전환·애니메이션 보존) */
  source?: {
    part: string;
    transitionXml?: string;
    timingXml?: string;
  };
}

/** 가져온 PPTX의 레이아웃(마스터 + 레이아웃 디자인 요소). 9단계 슬라이드 마스터의 기반 */
export interface LayoutDef {
  id: string;
  name: string;
  /** 슬라이드 뒤에 그려지는 디자인 개체 (개체 틀 제외) */
  objects: SlideObject[];
  background?: Fill;
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
  /** data: URL (이미지 등 작은 자산; 문서와 함께 저장) */
  dataUrl: string;
  name?: string;
  /** 큰 바이너리(동영상/오디오)는 IndexedDB blobs 저장소에 따로 보관 */
  blobKey?: string;
  size?: number;
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
  layouts?: Record<string, LayoutDef>;
  /** PPTX에서 가져온 경우 원본 패키지 정보 (패키지 바이트는 IndexedDB packages 저장소에 보관) */
  source?: {
    packageId: string;
    fileName: string;
    importedAt: number;
  };
  createdAt: number;
  updatedAt: number;
  version: 1;
}
