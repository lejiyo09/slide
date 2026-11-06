/**
 * 생성형 모델 공통 작업: 작업별 지시문 + JSON 스키마(구조화 출력) + 결과 검증.
 * 실제 호출(completeJSON)만 제공자마다 다르다 (Claude SDK / OpenAI 호환 HTTP).
 */
import type { AIProvider, CallOptions, CompareItem, DeckSpec, DesignChoice, DocumentInput, GenerateOptions, OutlineSpec, ProviderId, ScriptItem, SlideDigest, SlideKind, Suggestion } from './types';
import { AIError } from './types';
import { TEMPLATES } from '../../themes/templates';
import { COLOR_SCHEMES, FONT_SCHEMES } from '../../themes/schemes';

export const SYSTEM_PROMPT = `You are the presentation assistant built into SlideLab, a slide editor similar to PowerPoint.
Write every piece of text in the same language as the user's content; if the content is Korean, write natural Korean.
Slide text must be concise: a slide title is a short phrase, and each bullet is one idea of at most about 12 words (about 40 Korean characters).
Never invent specific statistics, dates, names or quotations that the user did not provide; when a concrete figure would help, write a bracketed placeholder such as [수치] or [사례] instead.
Return only the JSON object required by the response schema.`;

export interface JSONRequest {
  /** 작업 지시 + 입력 */
  user: string;
  schema: Record<string, unknown>;
  document?: DocumentInput;
}

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const KINDS: SlideKind[] = ['title', 'section', 'bullets', 'twoColumn', 'titleOnly'];

export const SCHEMAS = {
  deck: obj({
    title: str,
    slides: { type: 'array', items: obj({ kind: { type: 'string', enum: KINDS }, title: str, subtitle: str, bullets: strArr, left: strArr, right: strArr, notes: str }) },
  }),
  outline: obj({ title: str, sections: { type: 'array', items: obj({ heading: str, points: strArr }) } }),
  summary: obj({ points: strArr }),
  scripts: obj({ scripts: { type: 'array', items: obj({ slide_number: { type: 'integer' }, script: str }) } }),
  scriptReview: obj({ feedback: { type: 'array', items: obj({ slide_number: { type: 'integer' }, notes: strArr }) } }),
  suggestions: obj({ suggestions: { type: 'array', items: obj({ slide_number: { type: 'integer' }, message: str }) } }),
  layout: obj({
    suggestions: {
      type: 'array',
      items: obj({ slide_number: { type: 'integer' }, message: str, action: { type: 'string', enum: ['none', 'split', 'titleContent', 'twoContent', 'titleOnly', 'sectionHeader'] } }),
    },
  }),
  design: obj({
    choices: {
      type: 'array',
      items: obj({
        template_id: { type: 'string', enum: TEMPLATES.map((t) => t.id) },
        color_scheme: { type: 'string', enum: COLOR_SCHEMES.map((c) => c.id) },
        font_scheme: { type: 'string', enum: FONT_SCHEMES.map((f) => f.id) },
        reason: str,
      }),
    },
  }),
};

/* ───────────── 결과 검증 (모델이 형식을 어겨도 편집기가 깨지지 않게) ───────────── */

const S = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const SA = (v: unknown, maxItems = 12) => (Array.isArray(v) ? v.map((x) => S(x, 300)).filter(Boolean).slice(0, maxItems) : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function normalizeDeck(raw: unknown): DeckSpec {
  const r = rec(raw);
  const slides = (Array.isArray(r.slides) ? r.slides : []).slice(0, 60).map((x) => {
    const s = rec(x);
    const kind = KINDS.includes(s.kind as SlideKind) ? (s.kind as SlideKind) : 'bullets';
    return { kind, title: S(s.title), subtitle: S(s.subtitle) || undefined, bullets: SA(s.bullets), left: SA(s.left), right: SA(s.right), notes: S(s.notes, 4000) || undefined };
  });
  const usable = slides.filter((s) => s.title || s.bullets.length || s.left.length || s.right.length);
  if (!usable.length) throw new AIError('AI 응답에 슬라이드가 없습니다.', 'format');
  return { title: S(r.title) || usable[0].title, slides: usable };
}

export function normalizeOutline(raw: unknown): OutlineSpec {
  const r = rec(raw);
  const sections = (Array.isArray(r.sections) ? r.sections : []).map((x) => ({ heading: S(rec(x).heading), points: SA(rec(x).points) })).filter((s) => s.heading);
  if (!sections.length) throw new AIError('AI 응답에 목차가 없습니다.', 'format');
  return { title: S(r.title) || sections[0].heading, sections };
}

const bySlideNumber = <T>(slides: SlideDigest[], items: unknown, pick: (x: Record<string, unknown>, d: SlideDigest | undefined) => T | null): T[] =>
  (Array.isArray(items) ? items : [])
    .map((x) => {
      const r = rec(x);
      const n = Number(r.slide_number);
      return pick(r, slides.find((d) => d.number === n));
    })
    .filter((x): x is T => x !== null);

/** AI에 보내는 슬라이드 텍스트 */
export function digestText(slides: SlideDigest[], withNotes = false): string {
  return slides
    .map((d) => {
      const extras = [d.hasImage && '그림', d.hasChart && '차트', d.hasTable && '표'].filter(Boolean).join(', ');
      return [
        `### Slide ${d.number} (layout: ${d.layout}${extras ? `; contains: ${extras}` : ''})`,
        `Title: ${d.title || '(none)'}`,
        ...d.body.map((b) => `- ${b}`),
        withNotes ? `Speaker notes: ${d.notes.trim() || '(none)'}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

export abstract class LLMProvider implements AIProvider {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  readonly generative = true;
  abstract readonly readsPdf: boolean;

  protected abstract completeJSON(req: JSONRequest, call?: CallOptions): Promise<unknown>;

  async outline(topic: string, opts: GenerateOptions, call?: CallOptions) {
    const user = `Create an outline for a presentation.
Topic: ${topic}
${opts.audience ? `Audience: ${opts.audience}\n` : ''}${opts.slideCount ? `Target length: about ${opts.slideCount} slides including the title slide.\n` : ''}Give a presentation title and 3 to 8 sections; each section has a short heading and 2 to 5 key points.`;
    return normalizeOutline(await this.completeJSON({ user, schema: SCHEMAS.outline }, call));
  }

  async generateDeck(input: { prompt?: string; outline?: OutlineSpec; document?: DocumentInput }, opts: GenerateOptions, call?: CallOptions) {
    const parts: string[] = ['Create a complete slide deck.'];
    if (input.prompt) parts.push(`Request: ${input.prompt}`);
    if (input.outline) parts.push(`Follow this outline (one or more slides per section):\n${JSON.stringify(input.outline, null, 1)}`);
    if (input.document?.text) parts.push(`Build the deck from this document "${input.document.name}". Keep its facts; do not add facts that are not in it.\n<document>\n${input.document.text}\n</document>`);
    else if (input.document?.pdfBase64) parts.push(`Build the deck from the attached PDF "${input.document.name}". Keep its facts; do not add facts that are not in it.`);
    if (opts.audience) parts.push(`Audience: ${opts.audience}`);
    parts.push(
      `${opts.slideCount ? `Use about ${opts.slideCount} slides. ` : ''}The first slide has kind "title" (subtitle optional). Use "section" slides to separate parts of long decks, "twoColumn" with left/right bullets for comparisons, and "bullets" (3 to 6 bullets) for most content. Leave fields that a kind does not use as empty strings or empty arrays.`,
      opts.withNotes ? 'For every slide, write "notes": a natural spoken script of 2 to 5 sentences that the presenter can read aloud.' : 'Leave "notes" empty.',
    );
    return normalizeDeck(await this.completeJSON({ user: parts.join('\n\n'), schema: SCHEMAS.deck, document: input.document }, call));
  }

  async summarize(text: string, length: 'short' | 'medium', call?: CallOptions) {
    const user = `Summarize the text below as ${length === 'short' ? '2 to 3' : '4 to 6'} short bullet points suitable for a slide. Keep the original meaning; do not add information.\n<text>\n${text}\n</text>`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.summary }, call));
    const pts = SA(r.points);
    if (!pts.length) throw new AIError('요약 결과가 비어 있습니다.', 'format');
    return pts.map((p) => `• ${p}`).join('\n');
  }

  async writeScript(slides: SlideDigest[], opts: { secondsPerSlide?: number; tone?: string }, call?: CallOptions): Promise<ScriptItem[]> {
    const user = `Write the presenter's spoken script for each slide below. Aim for about ${opts.secondsPerSlide ?? 60} seconds of speech per content slide (shorter for title and section slides)${opts.tone ? ` in a ${opts.tone} tone` : ''}. The script should explain the slide naturally, connect to the next slide where helpful, and cover every point on the slide. Return one entry per slide with its slide_number.\n\n${digestText(slides)}`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.scripts }, call));
    return bySlideNumber(slides, r.scripts, (x, d) => (d && S(x.script, 6000) ? { slideId: d.id, script: S(x.script, 6000) } : null));
  }

  async reviewScript(slides: SlideDigest[], base: CompareItem[], call?: CallOptions): Promise<CompareItem[]> {
    const user = `Compare each slide with its speaker notes (the presenter's script). For each slide, list concrete problems only: points on the slide that the script skips, claims in the script that contradict the slide, or script content that is unrelated. Return an empty notes array for slides that are fine.\n\n${digestText(slides, true)}`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.scriptReview }, call));
    const extra = new Map(bySlideNumber(slides, r.feedback, (x, d) => (d ? ([d.id, SA(x.notes, 6)] as const) : null)));
    return base.map((b) => ({ ...b, notes: [...b.notes, ...(extra.get(b.slideId) ?? [])] }));
  }

  async reviewDesign(slides: SlideDigest[], call?: CallOptions): Promise<Suggestion[]> {
    const user = `Review this deck as a presentation designer. Point out the most useful improvements: slides with too much text, titles that are not messages, inconsistent structure, ideas better shown as a chart, table, image or diagram, missing transitions between sections. Give at most 8 suggestions; use slide_number 0 for suggestions about the whole deck.\n\n${digestText(slides)}`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.suggestions }, call));
    return bySlideNumber<Suggestion>(slides, r.suggestions, (x, d) => (d && S(x.message) ? { slideId: d.id, message: `슬라이드 ${d.number}: ${S(x.message)}` } : null)).concat(
      (Array.isArray(r.suggestions) ? r.suggestions : []).filter((x) => Number(rec(x).slide_number) === 0 && S(rec(x).message)).map((x) => ({ message: S(rec(x).message) })),
    );
  }

  async recommendLayout(slides: SlideDigest[], call?: CallOptions): Promise<Suggestion[]> {
    const user = `For each slide below, recommend how to structure it better if it would help. Choose an action: "split" (too much content for one slide), "titleContent" (title and bulleted list), "twoContent" (two columns for comparisons), "titleOnly" (title with a visual), "sectionHeader" (section divider), or "none" (only advice). Only include slides that would benefit; at most one suggestion per slide.\n\n${digestText(slides)}`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.layout }, call));
    return bySlideNumber(slides, r.suggestions, (x, d) => {
      if (!d || !S(x.message)) return null;
      const a = S(x.action);
      const action: Suggestion['action'] = a === 'split' ? { type: 'split' } : ['titleContent', 'twoContent', 'titleOnly', 'sectionHeader'].includes(a) ? { type: 'layout', layout: a as 'titleContent' } : undefined;
      return { slideId: d.id, message: `슬라이드 ${d.number}: ${S(x.message)}`, ...(action ? { action } : {}) };
    });
  }

  async chooseDesign(slides: SlideDigest[], deckTitle: string, call?: CallOptions): Promise<DesignChoice[]> {
    const catalog = [
      `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.name})`).join(', ')}`,
      `Color schemes: ${COLOR_SCHEMES.map((c) => `${c.id} (${c.name})`).join(', ')}`,
      `Font schemes: ${FONT_SCHEMES.map((f) => `${f.id} (${f.name})`).join(', ')}`,
    ].join('\n');
    const user = `Choose three different visual designs that suit this presentation's topic, audience and tone, from the catalog below. Give a one-sentence reason for each.\n\n${catalog}\n\nPresentation title: ${deckTitle}\n\n${digestText(slides)}`;
    const r = rec(await this.completeJSON({ user, schema: SCHEMAS.design }, call));
    const out = (Array.isArray(r.choices) ? r.choices : [])
      .map((x): DesignChoice | null => {
        const c = rec(x);
        const templateId = S(c.template_id);
        if (!TEMPLATES.some((t) => t.id === templateId)) return null;
        const colorScheme = COLOR_SCHEMES.some((s) => s.id === c.color_scheme) ? S(c.color_scheme) : undefined;
        const fontScheme = FONT_SCHEMES.some((s) => s.id === c.font_scheme) ? S(c.font_scheme) : undefined;
        return { templateId, colorScheme, fontScheme, reason: S(c.reason) };
      })
      .filter((x): x is DesignChoice => !!x);
    if (!out.length) throw new AIError('AI가 고른 디자인이 목록에 없습니다.', 'format');
    return out.slice(0, 3);
  }
}

/** 응답 텍스트 → JSON (코드 블록 감싸기 허용) */
export function parseJSONText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* 아래에서 오류 */
      }
    }
    throw new AIError('AI 응답을 JSON으로 읽을 수 없습니다.', 'format');
  }
}
