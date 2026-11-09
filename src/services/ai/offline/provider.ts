/**
 * 오프라인 제공자: API 키 없이 동작하는 규칙 기반 엔진.
 * - 주제 → 목차: 발표 유형(제안/보고/교육/일반)별 구성 틀
 * - 문서 → 슬라이드: 제목 구조 + 목록 + 추출 요약
 * - 요약/대본/구성 추천/디자인 선택: 통계·규칙
 * 사실 내용을 새로 지어내지 않으므로, 주제만으로 만든 슬라이드는 "작성 안내" 수준의 초안이다.
 */
import type { AIProvider, DeckSpec, DesignChoice, GenerateOptions, OutlineSpec, ScriptItem, SlideDigest, SlideSpec, Suggestion, CompareItem, DocumentInput, ProofreadEdit } from '../types';
import { AIError } from '../types';
import { extractiveSummary, keywords, splitSentences, toBullet } from './text';
import { parseDocument } from './document';

const MAX_BULLETS = 6;

type Kind = 'proposal' | 'report' | 'lecture' | 'general';

function intentOf(topic: string): Kind {
  if (/제안|기획|사업|투자|도입|전략|proposal|plan|pitch/i.test(topic)) return 'proposal';
  if (/보고|결과|실적|분기|현황|성과|회고|report|review|results/i.test(topic)) return 'report';
  if (/교육|강의|수업|학습|입문|소개|이란|란\??$|원리|개념|introduction|guide|tutorial|101/i.test(topic)) return 'lecture';
  return 'general';
}

const FRAMES: Record<Kind, { heading: string; points: (t: string) => string[] }[]> = {
  proposal: [
    { heading: '배경 및 문제', points: (t) => [`${t}이(가) 필요한 이유`, '현재 상황과 문제점', '해결하지 않을 때의 영향'] },
    { heading: '제안 내용', points: (t) => [`${t}의 핵심 아이디어`, '주요 구성 요소', '기존 방식과의 차이'] },
    { heading: '기대 효과', points: () => ['정량적 효과 (비용·시간·매출)', '정성적 효과', '이해관계자별 이점'] },
    { heading: '실행 계획', points: () => ['단계별 추진 일정', '필요 자원과 역할', '위험 요소와 대응 방안'] },
    { heading: '예산', points: () => ['항목별 소요 비용', '투자 대비 효과', '대안별 비교'] },
    { heading: '결론 및 요청 사항', points: (t) => [`${t} 추진 승인 요청`, '다음 단계', '질의응답'] },
  ],
  report: [
    { heading: '개요', points: (t) => [`${t}의 범위와 기간`, '보고 목적', '주요 지표'] },
    { heading: '주요 성과', points: () => ['핵심 성과 요약', '목표 대비 달성률', '눈에 띄는 변화'] },
    { heading: '세부 결과', points: () => ['영역별 결과', '데이터와 근거', '비교 분석'] },
    { heading: '이슈 및 원인', points: () => ['발생한 문제', '원인 분석', '영향 범위'] },
    { heading: '향후 계획', points: () => ['개선 과제', '다음 기간 목표', '필요한 지원'] },
  ],
  lecture: [
    { heading: '학습 목표', points: (t) => [`${t}의 기본 개념 이해`, '핵심 원리 파악', '실제 적용 방법'] },
    { heading: '개념', points: (t) => [`${t}의 정의`, '관련 용어', '왜 중요한가'] },
    { heading: '배경', points: (t) => [`${t}의 등장 배경`, '발전 과정', '현재 동향'] },
    { heading: '핵심 원리', points: () => ['원리 1', '원리 2', '원리 3'] },
    { heading: '사례', points: (t) => [`${t} 적용 사례`, '성공 요인', '주의할 점'] },
    { heading: '정리', points: () => ['핵심 내용 요약', '더 알아보기', '질의응답'] },
  ],
  general: [
    { heading: '소개', points: (t) => [`${t} 개요`, '발표 목적', '다룰 내용'] },
    { heading: '배경', points: (t) => [`${t}의 배경`, '현재 상황', '주요 쟁점'] },
    { heading: '핵심 내용', points: (t) => [`${t}의 핵심 1`, `${t}의 핵심 2`, `${t}의 핵심 3`] },
    { heading: '사례 및 근거', points: () => ['대표 사례', '데이터·근거', '시사점'] },
    { heading: '결론', points: () => ['핵심 메시지 요약', '제언', '질의응답'] },
  ],
};

export function outlineFromTopic(topic: string, slideCount?: number): OutlineSpec {
  const t = topic.trim().replace(/[.?!]+$/, '') || '발표 주제';
  const frame = FRAMES[intentOf(t)];
  // 표지 1장 + 목차 구역들: 원하는 장수에 맞춰 구역 수 조절
  // 목차 슬라이드가 들어갈 만큼 길면(구역 4개 이상) 그 한 장도 셈
  const avail = slideCount ? slideCount - 1 - (slideCount - 1 >= 5 ? 1 : 0) : frame.length;
  const want = Math.max(2, Math.min(frame.length, avail));
  return { title: t, sections: frame.slice(0, want).map((f) => ({ heading: f.heading, points: f.points(t) })) };
}

/** 글머리 기호가 많으면 (계속) 슬라이드로 나눔 */
function chunkSlide(title: string, bullets: string[]): SlideSpec[] {
  if (bullets.length <= MAX_BULLETS) return [{ kind: 'bullets', title, bullets }];
  const out: SlideSpec[] = [];
  for (let i = 0; i < bullets.length; i += MAX_BULLETS) out.push({ kind: 'bullets', title: i ? `${title} (계속)` : title, bullets: bullets.slice(i, i + MAX_BULLETS) });
  return out;
}

export function deckFromOutline(o: OutlineSpec, opts: GenerateOptions = {}): DeckSpec {
  const slides: SlideSpec[] = [{ kind: 'title', title: o.title, subtitle: opts.audience ? `${opts.audience} 대상` : new Date().toLocaleDateString('ko-KR') }];
  if (o.sections.length >= 4 && (!opts.slideCount || o.sections.length + 2 <= opts.slideCount)) slides.push({ kind: 'bullets', title: '목차', bullets: o.sections.map((s) => s.heading) });
  for (const s of o.sections) slides.push(...chunkSlide(s.heading, s.points));
  const deck = { title: o.title, slides };
  if (opts.withNotes) for (const s of deck.slides) s.notes = scriptFor(s, deck.slides.indexOf(s), deck.slides.length, o.title);
  return deck;
}

export function deckFromDocument(text: string, name: string, opts: GenerateOptions = {}): DeckSpec {
  const doc = parseDocument(text, name.replace(/\.[^.]+$/, ''));
  if (!doc.sections.length) throw new AIError('문서에서 내용을 찾지 못했습니다.', 'format');
  const slides: SlideSpec[] = [{ kind: 'title', title: doc.title, subtitle: name }];
  const contentSections = doc.sections.filter((s) => s.paragraphs.length || s.bullets.length);
  if (contentSections.length >= 4) slides.push({ kind: 'bullets', title: '목차', bullets: doc.sections.filter((s) => s.level <= 2 && s.heading).slice(0, 8).map((s) => s.heading) });
  // 원하는 장수가 있으면 문단 요약 문장 수를 조절
  const perSection = opts.slideCount ? Math.max(2, Math.min(MAX_BULLETS, Math.round((opts.slideCount * 4) / Math.max(1, contentSections.length)))) : 4;
  doc.sections.forEach((s, i) => {
    const hasContent = s.paragraphs.length || s.bullets.length;
    const next = doc.sections[i + 1];
    if (!hasContent && next && next.level > s.level) {
      slides.push({ kind: 'section', title: s.heading });
      return;
    }
    if (!hasContent) return;
    const fromBullets = s.bullets.map((b) => toBullet(b));
    const fromParas = s.paragraphs.length ? extractiveSummary(s.paragraphs.join(' '), Math.max(1, perSection - Math.min(fromBullets.length, 2))).map((x) => toBullet(x)) : [];
    const bullets = [...fromParas, ...fromBullets];
    slides.push(...chunkSlide(s.heading || doc.title, bullets));
  });
  if (contentSections.length >= 3) {
    const all = contentSections.map((s) => [...s.paragraphs, ...s.bullets].join(' ')).join(' ');
    slides.push({ kind: 'bullets', title: '핵심 정리', bullets: extractiveSummary(all, 4).map((x) => toBullet(x, 60)) });
  }
  const deck = { title: doc.title, slides };
  if (opts.withNotes) deck.slides.forEach((s, i) => (s.notes = scriptFor(s, i, deck.slides.length, deck.title)));
  return deck;
}

/** 슬라이드 하나의 발표 대본 (연결어 템플릿) */
export function scriptFor(s: Pick<SlideSpec, 'kind' | 'title' | 'subtitle' | 'bullets' | 'left' | 'right'>, index: number, total: number, deckTitle: string): string {
  const items = [...(s.bullets ?? []), ...(s.left ?? []), ...(s.right ?? [])].map((b) => b.replace(/[.…]+$/, '').trim()).filter(Boolean);
  if (index === 0 || s.kind === 'title') return `안녕하세요. 오늘은 '${s.title || deckTitle}'에 대해 발표하겠습니다.${s.subtitle ? ` ${s.subtitle.replace(/[.\s]+$/, '')}.` : ''} 발표는 약 ${Math.max(1, Math.round(total * 0.8))}분 동안 진행합니다.`;
  if (s.kind === 'section') return `다음은 '${s.title}'입니다.`;
  const conn = ['먼저', '다음으로', '또한', '이어서', '그리고', '끝으로'];
  const body = items.map((b, i) => `${i === items.length - 1 && items.length > 1 ? '마지막으로' : conn[Math.min(i, conn.length - 2)]}, ${b}.`).join(' ');
  const last = index === total - 1;
  return `${s.title}에 대해 말씀드리겠습니다. ${body}${last ? ' 이상으로 발표를 마치겠습니다. 들어 주셔서 감사합니다.' : ''}`.trim();
}

export class OfflineProvider implements AIProvider {
  readonly id = 'offline' as const;
  readonly name = '기본 엔진 (오프라인 규칙 기반)';
  readonly generative = false;
  readonly readsPdf = false;

  async outline(topic: string, opts: GenerateOptions) {
    return outlineFromTopic(topic, opts.slideCount);
  }

  async generateDeck(input: { prompt?: string; outline?: OutlineSpec; document?: DocumentInput }, opts: GenerateOptions) {
    if (input.document) {
      if (!input.document.text) throw new AIError('기본 엔진은 PDF를 읽을 수 없습니다. 텍스트(.txt, .md) 또는 Word(.docx) 문서를 사용하거나, AI 설정에서 Claude를 연결하세요.', 'config');
      return deckFromDocument(input.document.text, input.document.name, opts);
    }
    if (input.outline) return deckFromOutline(input.outline, opts);
    const prompt = (input.prompt ?? '').trim();
    if (!prompt) throw new AIError('주제나 내용을 입력하세요.', 'config');
    // 긴 글은 문서로 취급
    if (prompt.length > 300 || prompt.split('\n').length > 4) return deckFromDocument(prompt, '입력한 내용', opts);
    return deckFromOutline(outlineFromTopic(prompt, opts.slideCount), opts);
  }

  async summarize(text: string, length: 'short' | 'medium') {
    const n = length === 'short' ? 3 : 6;
    const sents = extractiveSummary(text, n);
    if (!sents.length) throw new AIError('요약할 문장이 없습니다.', 'format');
    return sents.map((s) => `• ${toBullet(s, 120)}`).join('\n');
  }

  async writeScript(slides: SlideDigest[]): Promise<ScriptItem[]> {
    return slides.map((d, i) => ({
      slideId: d.id,
      script: scriptFor({ kind: i === 0 && d.layout === 'title' ? 'title' : d.layout === 'sectionHeader' ? 'section' : 'bullets', title: d.title, bullets: d.body.slice(0, 8), subtitle: d.layout === 'title' ? d.body[0] : undefined }, i, slides.length, slides[0]?.title ?? ''),
    }));
  }

  async reviewScript(_slides: SlideDigest[], base: CompareItem[]) {
    return base;
  }

  async reviewDesign(): Promise<Suggestion[]> {
    return [];
  }

  async recommendLayout(slides: SlideDigest[]): Promise<Suggestion[]> {
    return recommendLayoutRules(slides);
  }

  async chooseDesign(slides: SlideDigest[], deckTitle: string): Promise<DesignChoice[]> {
    return chooseDesignRules(slides, deckTitle);
  }

  /** 오프라인: 문맥 문법은 생성형 모델이 필요 (맞춤법 검사의 규칙·사전 검사는 따로 동작) */
  async proofread(): Promise<ProofreadEdit[]> {
    return [];
  }
}

/** 구성 추천 규칙 */
export function recommendLayoutRules(slides: SlideDigest[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const d of slides) {
    const chars = d.body.join('').length;
    if (d.body.length > MAX_BULLETS || chars > 400) out.push({ slideId: d.id, message: `슬라이드 ${d.number}: 내용이 많습니다(${d.body.length}개 문단, ${chars}자). 두 슬라이드로 나누면 읽기 쉽습니다.`, action: { type: 'split' } });
    const vs = d.body.some((b) => /\bvs\.?\b|대비|비교|장점|단점|전\s*\/\s*후|before|after/i.test(b)) || /비교|vs|장단점/i.test(d.title);
    if (vs && d.layout !== 'twoContent' && d.body.length >= 2) out.push({ slideId: d.id, message: `슬라이드 ${d.number}: 비교하는 내용입니다. '콘텐츠 2개' 레이아웃으로 나란히 놓아 보세요.`, action: { type: 'layout', layout: 'twoContent' } });
    const nums = d.body.filter((b) => /\d[\d,.]*\s*(%|억|만|천|원|명|건|배|달러|\$)/.test(b)).length;
    if (nums >= 3 && !d.hasChart && !d.hasTable) out.push({ slideId: d.id, message: `슬라이드 ${d.number}: 수치가 ${nums}개 있습니다. 차트나 표로 보여 주면 비교가 쉽습니다 (삽입 › 차트).` });
    if (!d.title && d.body.length) out.push({ slideId: d.id, message: `슬라이드 ${d.number}: 제목이 없습니다. 핵심 메시지를 제목으로 적어 보세요.` });
    if (d.number > 1 && d.body.length === 0 && d.title && !d.hasImage && !d.hasChart && !d.hasTable && d.layout === 'titleContent')
      out.push({ slideId: d.id, message: `슬라이드 ${d.number}: 제목만 있습니다. 구역을 나누는 슬라이드라면 '구역 머리글' 레이아웃이 어울립니다.`, action: { type: 'layout', layout: 'sectionHeader' } });
  }
  return out;
}

/** 주제 단어로 디자인 고르기 (템플릿·색·글꼴 ID는 themes/의 목록) */
export function chooseDesignRules(slides: SlideDigest[], deckTitle: string): DesignChoice[] {
  const text = `${deckTitle} ${slides.map((s) => `${s.title} ${s.body.join(' ')}`).join(' ')}`;
  const pick = (re: RegExp) => re.test(text);
  const choices: DesignChoice[] = [];
  if (pick(/환경|친환경|ESG|자연|농업|건강|green|eco/i)) choices.push({ templateId: 'side-band', colorScheme: 'green', fontScheme: 'noto', reason: '환경·건강 주제에 어울리는 녹색 계열' });
  if (pick(/보고|실적|재무|분기|매출|전략|사업|투자|report|finance/i)) choices.push({ templateId: 'accent-bar', colorScheme: 'blue', fontScheme: 'malgun', reason: '보고·비즈니스 발표에 어울리는 차분한 파랑' });
  if (pick(/교육|강의|학습|수업|아이|학생|class|lesson/i)) choices.push({ templateId: 'geometric', colorScheme: 'yellow-orange', fontScheme: 'nanum', reason: '교육 자료에 어울리는 밝고 따뜻한 색' });
  if (pick(/기술|AI|인공지능|개발|소프트웨어|데이터|tech|software|data/i)) choices.push({ templateId: 'dark-stage', colorScheme: 'blue-green', fontScheme: 'segoe', reason: '기술 발표에 어울리는 어두운 배경과 청록 강조색' });
  if (pick(/디자인|브랜드|마케팅|홍보|행사|축제|marketing|brand|event/i)) choices.push({ templateId: 'soft-gradient', colorScheme: 'red-violet', fontScheme: 'noto', reason: '마케팅·행사에 어울리는 선명한 색' });
  // 기본 후보
  for (const c of [
    { templateId: 'accent-bar', colorScheme: 'blue', fontScheme: 'malgun', reason: '어떤 주제에도 무난한 기본 디자인' },
    { templateId: 'soft-gradient', colorScheme: 'violet', fontScheme: 'noto', reason: '부드러운 배경의 깔끔한 디자인' },
    { templateId: 'geometric', colorScheme: 'warm', fontScheme: 'nanum', reason: '도형 장식이 있는 따뜻한 디자인' },
  ])
    if (choices.length < 3 && !choices.some((x) => x.templateId === c.templateId)) choices.push(c);
  return choices.slice(0, 3);
}

/** 문장 수 대비 핵심어 (외부에서 쓰는 보조) */
export const _internal = { splitSentences, keywords };
