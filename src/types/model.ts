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
  | { type: 'image'; assetId: ID; opacity?: number }
  /** 무늬 채우기 (PPTX a:pattFill의 프리셋 이름) */
  | { type: 'pattern'; preset: PatternPreset; fg: Color; bg: Color };

export type PatternPreset = 'pct20' | 'pct50' | 'ltHorz' | 'ltVert' | 'ltUpDiag' | 'ltDnDiag' | 'smGrid' | 'smCheck' | 'diagCross' | 'dotGrid' | 'wave' | 'horzBrick';

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
  /** 문단 안 수식 (PowerPoint: 텍스트 상자 안 수식, PPTX a14:m). text는 MATH_RUN_TEXT 한 글자 */
  math?: InlineMath;
}

/** 문단 안 수식: LaTeX가 원본, MathML은 화면 표시용, OMML은 가져온 원본(바꾸지 않았으면 그대로 저장) */
export interface InlineMath {
  latex: string;
  mathml: string;
  sourceOmml?: { xml: string; latex: string };
}

/** 문단 안 수식 런의 글자 (개체 대체 문자: 글자 위치 계산·검색·맞춤법 검사에서 한 글자로 건너뜀) */
export const MATH_RUN_TEXT = '\uFFFC';

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
  /**
   * 모핑 전환에서 다른 슬라이드의 개체와 같은 개체로 이어 주는 식별자 (id와 다름: id는 슬라이드마다 고유).
   * 없으면 id를 쓴다. 슬라이드 복제·다른 슬라이드로 복사하면 이어받고, 같은 슬라이드에서 복제하면 새로 받는다.
   */
  morphKey?: string;
  /** 모핑에서 짝짓지 않음 (사용자가 '연결 안 함'을 고름) */
  morphExclude?: boolean;
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

export type PlaceholderType = 'title' | 'ctrTitle' | 'subTitle' | 'body' | 'dt' | 'ftr' | 'sldNum';

export interface TextObject extends BaseObject {
  type: 'text';
  text: TextBody;
  /** 마스터/레이아웃 개체 틀과의 연결 (서식·위치 상속) */
  ph?: { type: PlaceholderType; idx?: number };
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
  /** 쇼 중에 숨기기 (PPTX cMediaNode showWhenStopped="0") */
  hideInShow?: boolean;
  /** 녹화한 내레이션 (녹화 탭에서 만들고 지울 수 있음, 쇼 설정의 '내레이션 없이 쇼 진행'에 따라 재생) */
  narration?: boolean;
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

/* ───────────── 메모 ───────────── */

export interface CommentReply {
  id: ID;
  author: string;
  initials: string;
  text: string;
  /** ISO 8601 */
  created: string;
}

/** 슬라이드 메모 (PPTX: 기존 메모 p:cm / 최신 메모 p188:cm) */
export interface SlideComment extends CommentReply {
  /** 메모 표시 위치 (슬라이드 px) */
  x: number;
  y: number;
  /** 개체에 단 메모 */
  objectId?: ID;
  /** 해결됨 (최신 메모 status="resolved") */
  resolved?: boolean;
  replies: CommentReply[];
}

/* ───────────── 수식 ───────────── */

/** 수식 (PowerPoint: 삽입 › 수식). LaTeX가 원본, MathML은 화면 표시용, OMML은 PPTX에서 가져온 원본(바꾸지 않았으면 그대로 저장) */
export interface EquationObject extends BaseObject {
  type: 'equation';
  latex: string;
  /** Temml이 만든 MathML (표시용, 저장 전 정화) */
  mathml: string;
  /** 글자 크기 pt */
  fontSize: number;
  color: Color;
  align: 'left' | 'center' | 'right';
  /** 가져온 PPTX의 원본 OMML (m:oMath / m:oMathPara)과 그때의 LaTeX — LaTeX가 같으면 원본을 그대로 저장 */
  sourceOmml?: { xml: string; latex: string };
}

/* ───────────── 확장 개체 ───────────── */

/**
 * 확장 개체 (extensions/registry.ts에 등록한 종류가 그리고 편집). 첫 확장: 3D 모델(kind 'model3d').
 * 썸네일·인쇄·PDF·비디오·PPTX 대체 그림은 posterId 그림을 쓴다.
 */
export interface ExtensionObject extends BaseObject {
  type: 'extension';
  kind: string;
  /** 종류별 설정 (3D: 회전·확대) */
  data: Record<string, unknown>;
  /** 원본 바이너리 (3D: GLB) — Asset.blobKey로 IndexedDB에 저장 */
  assetId?: ID;
  /** 대체 그림 (PNG data URL 자산) */
  posterId?: ID;
}

export type SlideObject = TextObject | ShapeObject | LineObject | ImageObject | GroupObject | TableObject | ChartObject | MediaObject | EquationObject | ExtensionObject | UnsupportedObject;
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
  /** 슬라이드 전환 효과 */
  transition?: SlideTransition;
  /** 애니메이션 (배열 순서 = 재생 순서) */
  animations?: Animation[];
  /** 메모 (검토 › 메모) */
  comments?: SlideComment[];
  /** PPTX에서 가져온 슬라이드의 원본 XML 조각 (전환·애니메이션 보존) */
  source?: {
    part: string;
    transitionXml?: string;
    timingXml?: string;
    /** 가져온 직후 전환/애니메이션 모델의 지문 (그대로면 저장 시 원본 XML 사용) */
    transitionFingerprint?: string;
    animationFingerprint?: string;
    /** 가져온 직후 미디어 재생 설정 지문 (자동 재생 등은 p:timing에 기록되므로 바뀌면 타이밍을 새로 생성) */
    mediaFingerprint?: string;
  };
}

/* ───────────── 전환 ───────────── */

export type TransitionType =
  | 'none' | 'fade' | 'fadeBlack' | 'push' | 'wipe' | 'split' | 'cover' | 'uncover' | 'circle' | 'zoom' | 'rotate' | 'flip' | 'morph';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface SlideTransition {
  type: TransitionType;
  /** 재생 시간 ms */
  duration: number;
  /** push/wipe/cover/uncover: 이동 방향, split: 'horizontal'|'vertical' + in/out */
  direction?: Direction | 'horizontalIn' | 'horizontalOut' | 'verticalIn' | 'verticalOut';
  /** 마우스를 클릭할 때 넘김 (기본 true) */
  advanceOnClick?: boolean;
  /** 이 시간(ms) 후 자동으로 넘김 */
  advanceAfter?: number;
  /** 모핑: 개체 / 단어 / 문자 단위 (PPTX p159:morph option, 기본 개체) */
  morphOption?: 'byObject' | 'byWord' | 'byChar';
  /** 모핑 가감속 (기본 easeInOut, PPTX에는 저장되지 않음) */
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'cubicBezier';
  /** easing === 'cubicBezier'일 때 제어점 [x1, y1, x2, y2] (CSS cubic-bezier와 같음) */
  bezier?: [number, number, number, number];
}

/* ───────────── 애니메이션 ───────────── */

export type AnimationCategory = 'entrance' | 'emphasis' | 'exit' | 'path';
export type AnimationStart = 'onClick' | 'withPrevious' | 'afterPrevious';

export interface Animation {
  id: ID;
  /** 대상 개체 ID (슬라이드 최상위 개체) */
  targetId: ID;
  category: AnimationCategory;
  /** 효과 ID (engines/animation/effects.ts) */
  effect: string;
  start: AnimationStart;
  duration: number; // ms
  delay: number; // ms
  /** 반복 횟수 (1 = 한 번), 0 = 다음 클릭까지 반복 */
  repeat: number;
  direction?: Direction;
  /** 이동 경로: 개체 시작 위치 기준 오프셋 점들 (슬라이드 px) */
  path?: { x: number; y: number }[];
  /** 트리거: 이 개체를 클릭하면 재생 (없으면 기본 순서) */
  triggerId?: ID;
}

/**
 * 슬라이드 마스터 / 레이아웃. 슬라이드와 같은 구조라 같은 편집 캔버스·명령으로 편집한다.
 * - objects: 디자인 개체(모든 슬라이드 뒤에 표시) + 개체 틀(ph가 있는 TextObject, 새 슬라이드의 원형)
 * - 마스터/레이아웃을 고치면 연결된 슬라이드 중 '바꾸지 않은 속성'에 전파된다 (core/document/masters.ts)
 */
export interface MasterSlide extends Slide {
  kind: 'master' | 'layout';
  name: string;
}

export type LayoutDef = MasterSlide;

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
  master?: MasterSlide;
  layouts?: Record<string, LayoutDef>;
  /** 레이아웃 표시 순서 */
  layoutOrder?: string[];
  /** PPTX에서 가져온 경우 원본 패키지 정보 (패키지 바이트는 IndexedDB packages 저장소에 보관) */
  source?: {
    packageId: string;
    fileName: string;
    importedAt: number;
  };
  /** 슬라이드 쇼 설정 (PPTX presProps.xml p:showPr) */
  showSettings?: ShowSettings;
  /** 재구성한 쇼 (PPTX presentation.xml p:custShowLst) */
  customShows?: CustomShow[];
  /** PPTX로 저장할 때 내 글꼴을 파일에 포함 (presentation.xml embedTrueTypeFonts, 기본 켬) */
  embedFonts?: boolean;
  /** PPTX 메모 형식: 자동(해결한 메모가 있으면 최신) / 기존(PowerPoint 2019 이하·LibreOffice) / 최신(PowerPoint 365, 해결 상태 저장) */
  commentFormat?: 'auto' | 'legacy' | 'modern';
  createdAt: number;
  updatedAt: number;
  version: 1;
}

/* ───────────── 슬라이드 쇼 설정 ───────────── */

export interface ShowSettings {
  /** 발표자가 진행(전체 화면) / 웹 형식으로 진행(창) / 대화형 자동 진행(키오스크, 전체 화면) */
  showType: 'speaker' | 'browsed' | 'kiosk';
  /** <Esc> 키를 누를 때까지 계속 실행 (키오스크는 항상) */
  loop: boolean;
  /** 내레이션 없이 쇼 진행 */
  noNarration: boolean;
  /** 애니메이션 없이 쇼 진행 */
  noAnimation: boolean;
  /** 표시할 슬라이드 */
  range: { kind: 'all' } | { kind: 'range'; from: number; to: number } | { kind: 'custom'; showId: ID };
  /** 화면 전환: false = 수동, true = 설정된 시간 사용 */
  useTimings: boolean;
  penColor: Color;
  laserColor: Color;
  /** 발표자 보기 사용 */
  presenterView: boolean;
}

export interface CustomShow {
  id: ID;
  name: string;
  slideIds: ID[];
}
