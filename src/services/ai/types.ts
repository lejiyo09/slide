/**
 * AI 모듈 공통 형식. 편집기는 이 인터페이스만 알고, 실제 제공자(오프라인 규칙 엔진 / Claude / OpenAI 호환 엔드포인트)는 교체 가능하다.
 * API 키가 없어도 오프라인 제공자가 모든 텍스트 기능을 (규칙 기반으로) 처리하므로 편집기는 그대로 동작한다.
 */

export type SlideKind = 'title' | 'section' | 'bullets' | 'twoColumn' | 'titleOnly';

/** 생성할 슬라이드 하나 */
export interface SlideSpec {
  kind: SlideKind;
  title: string;
  /** 부제목 (표지) 또는 구역 설명 */
  subtitle?: string;
  bullets?: string[];
  /** 2단: 왼쪽/오른쪽 글머리 기호 */
  left?: string[];
  right?: string[];
  /** 발표자 노트(대본) */
  notes?: string;
}

/** 생성할 프레젠테이션 */
export interface DeckSpec {
  title: string;
  slides: SlideSpec[];
}

/** 목차 */
export interface OutlineSpec {
  title: string;
  sections: { heading: string; points: string[] }[];
}

/** 슬라이드 요약 (AI에 보내는 형태: 문서 전체가 아니라 필요한 텍스트만) */
export interface SlideDigest {
  id: string;
  /** 1부터 */
  number: number;
  layout: string;
  title: string;
  /** 제목 외 텍스트 (문단 단위) */
  body: string[];
  notes: string;
  hasImage: boolean;
  hasChart: boolean;
  hasTable: boolean;
}

export interface ScriptItem {
  slideId: string;
  script: string;
}

/** 대본-슬라이드 비교 결과 (슬라이드별) */
export interface CompareItem {
  slideId: string;
  /** 슬라이드 핵심어 중 대본에서 다룬 비율 0..1 */
  coverage: number;
  /** 대본에 없는 슬라이드 핵심어 */
  missing: string[];
  /** 예상 발표 시간 (초) */
  seconds: number;
  /** 지적 사항 */
  notes: string[];
}

/** 디자인/구성 제안 (AI가 만든 서술형 제안) */
export interface Suggestion {
  slideId?: string;
  message: string;
  /** 적용할 수 있는 동작 */
  action?: SuggestedAction;
}

export type SuggestedAction =
  | { type: 'split' }
  | { type: 'layout'; layout: 'title' | 'titleContent' | 'twoContent' | 'titleOnly' | 'sectionHeader' }
  | { type: 'template'; templateId: string; colorScheme?: string; fontScheme?: string };

export interface DesignChoice {
  templateId: string;
  colorScheme?: string;
  fontScheme?: string;
  reason: string;
}

/** 문서 입력 (문서에서 프레젠테이션 만들기) */
export interface DocumentInput {
  name: string;
  /** 텍스트로 읽은 내용 (txt/md/docx) */
  text?: string;
  /** PDF 원본 (base64) — 문서 블록을 지원하는 제공자만 */
  pdfBase64?: string;
}

export interface GenerateOptions {
  /** 원하는 슬라이드 수 (대략) */
  slideCount?: number;
  /** 청중/어조 */
  audience?: string;
  /** 발표자 노트도 만들지 */
  withNotes?: boolean;
}

export interface ProgressInfo {
  /** 지금까지 받은 글자 수 (스트리밍) */
  chars: number;
}

export interface CallOptions {
  signal?: AbortSignal;
  onProgress?: (p: ProgressInfo) => void;
}

/** 텍스트 AI 제공자 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  /** 규칙 기반(오프라인)이면 false: UI에서 결과 품질 한계를 안내 */
  readonly generative: boolean;
  /** PDF 문서를 직접 읽을 수 있는지 */
  readonly readsPdf: boolean;

  outline(topic: string, opts: GenerateOptions, call?: CallOptions): Promise<OutlineSpec>;
  generateDeck(input: { prompt?: string; outline?: OutlineSpec; document?: DocumentInput }, opts: GenerateOptions, call?: CallOptions): Promise<DeckSpec>;
  summarize(text: string, length: 'short' | 'medium', call?: CallOptions): Promise<string>;
  writeScript(slides: SlideDigest[], opts: { secondsPerSlide?: number; tone?: string }, call?: CallOptions): Promise<ScriptItem[]>;
  /** 규칙 기반 비교 결과에 서술형 의견을 덧붙임 (오프라인은 그대로 반환) */
  reviewScript(slides: SlideDigest[], base: CompareItem[], call?: CallOptions): Promise<CompareItem[]>;
  reviewDesign(slides: SlideDigest[], call?: CallOptions): Promise<Suggestion[]>;
  recommendLayout(slides: SlideDigest[], call?: CallOptions): Promise<Suggestion[]>;
  chooseDesign(slides: SlideDigest[], deckTitle: string, call?: CallOptions): Promise<DesignChoice[]>;
}

/** 이미지 생성 제공자 (선택) */
export interface ImageProvider {
  readonly name: string;
  generate(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', call?: CallOptions): Promise<Blob>;
}

export type ProviderId = 'offline' | 'openai' | 'anthropic' | 'openai-compatible';

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'network' | 'refusal' | 'format' | 'config' | 'aborted' | 'other' = 'other',
  ) {
    super(message);
    this.name = 'AIError';
  }
}
