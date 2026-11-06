import { describe, expect, it, vi } from 'vitest';
import { produce } from 'immer';
import JSZip from 'jszip';
import { createPresentation, createShape, createTextBox } from '../../core/document/factory';
import type { Presentation, TextObject } from '../../types/model';
import { OfflineProvider, outlineFromTopic, deckFromDocument, recommendLayoutRules, chooseDesignRules } from './offline/provider';
import { docxToText, parseDocument } from './offline/document';
import { extractiveSummary, keywords, splitSentences, stem } from './offline/text';
import { compareScripts, contrastRatio, digestSlides, fixIssue, lintDesign } from './analyze';
import { applyScripts, changeLayout, insertDeck } from './apply';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openaiCompatible';
import { normalizeDeck, parseJSONText } from './llm';
import { TEMPLATES } from '../../themes/templates';

/** SDK가 넘기는 Headers(다른 실행 환경의 객체일 수 있음)를 그대로 읽기 */
const hdrs = (init?: RequestInit) => {
  const h = init?.headers as { get?: (k: string) => string | null } | undefined;
  return { get: (k: string) => (h && typeof h.get === 'function' ? h.get(k) : new Headers(init?.headers).get(k)) };
};

const DOC = `# 재택근무 도입 제안

## 배경
코로나 이후 원격 근무가 보편화되었다. 우리 회사도 출퇴근 시간이 평균 1시간 20분으로 길다. 직원 설문에서 72%가 재택근무를 원했다.

## 기대 효과
- 출퇴근 시간 절감
- 사무실 운영비 15% 절감
- 채용 지역 확대

## 실행 계획
1단계로 한 팀에서 3개월 시범 운영한다. 2단계로 전사 확대 여부를 결정한다. 보안 점검과 협업 도구 교육을 함께 진행한다.

## 위험 요소
소통 부족과 성과 관리가 어려워질 수 있다. 정기 화상 회의와 목표 관리 제도로 보완한다.`;

describe('오프라인 텍스트 처리', () => {
  it('문장 나누기 / 어근 / 핵심어 / 추출 요약', () => {
    expect(splitSentences('첫 문장이다. 둘째 문장입니다! Third one? 넷째')).toEqual(['첫 문장이다.', '둘째 문장입니다!', 'Third one?', '넷째']);
    expect(stem('재택근무를')).toBe('재택근무');
    expect(stem('meetings')).toBe('meet');
    expect(keywords('재택근무는 좋다. 재택근무를 하면 출퇴근 시간이 준다. 출퇴근이 힘들다.', 3)).toEqual(expect.arrayContaining(['재택근무', '출퇴근']));
    const s = extractiveSummary(DOC.replace(/[#-]/g, ''), 2);
    expect(s).toHaveLength(2);
  });

  it('문서 구조: 제목/구역/목록', () => {
    const p = parseDocument(DOC, 'x');
    expect(p.title).toBe('재택근무 도입 제안');
    expect(p.sections.map((x) => x.heading)).toEqual(['배경', '기대 효과', '실행 계획', '위험 요소']);
    expect(p.sections[1].bullets).toEqual(['출퇴근 시간 절감', '사무실 운영비 15% 절감', '채용 지역 확대']);
  });

  it('docx 읽기 (제목 스타일 → #, 번호 목록 → -)', async () => {
    const zip = new JSZip();
    zip.file(
      'word/styles.xml',
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    );
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>개요</w:t></w:r></w:p>
<w:p><w:r><w:t>본문 문장입니다.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>항목 하나</w:t></w:r></w:p>
</w:body></w:document>`,
    );
    const text = await docxToText(await zip.generateAsync({ type: 'uint8array' }));
    expect(text).toBe('# 개요\n본문 문장입니다.\n- 항목 하나');
  });
});

describe('오프라인 생성', () => {
  it('주제 → 목차 (발표 유형별 틀, 장수 조절)', () => {
    const o = outlineFromTopic('신규 물류 시스템 도입 제안', 5);
    expect(o.title).toBe('신규 물류 시스템 도입 제안');
    expect(o.sections).toHaveLength(4);
    expect(o.sections[0].heading).toBe('배경 및 문제');
  });

  it('문서 → 슬라이드: 표지, 목차, 구역별 요약, 핵심 정리, 노트', () => {
    const deck = deckFromDocument(DOC, '제안서.md', { withNotes: true });
    expect(deck.slides[0]).toMatchObject({ kind: 'title', title: '재택근무 도입 제안' });
    expect(deck.slides[1].title).toBe('목차');
    const effect = deck.slides.find((s) => s.title === '기대 효과')!;
    expect(effect.bullets).toEqual(expect.arrayContaining(['사무실 운영비 15% 절감']));
    expect(deck.slides.at(-1)!.title).toBe('핵심 정리');
    expect(deck.slides.every((s) => s.notes && s.notes.length > 5)).toBe(true);
    expect(deck.slides.every((s) => (s.bullets?.length ?? 0) <= 6)).toBe(true);
  });

  it('제공자: PDF는 거절, 긴 글은 문서로 처리', async () => {
    const p = new OfflineProvider();
    await expect(p.generateDeck({ document: { name: 'a.pdf', pdfBase64: 'AA' } }, {})).rejects.toThrow(/PDF/);
    const d = await p.generateDeck({ prompt: DOC }, {});
    expect(d.title).toBe('재택근무 도입 제안');
    expect(await p.summarize(DOC.replace(/[#-]/g, ''), 'short')).toMatch(/^• /);
  });

  it('구성 추천 / 디자인 선택 규칙', () => {
    const recs = recommendLayoutRules([
      { id: 'a', number: 2, layout: 'titleContent', title: 'A안 vs B안 비교', body: ['A안 장점', 'B안 장점'], notes: '', hasImage: false, hasChart: false, hasTable: false },
      { id: 'b', number: 3, layout: 'titleContent', title: '실적', body: ['매출 120억', '이익 15%', '고객 3만명'], notes: '', hasImage: false, hasChart: false, hasTable: false },
    ]);
    expect(recs.map((r) => r.action?.type ?? 'none')).toEqual(['layout', 'none']);
    expect(recs[1].message).toContain('차트');
    const ds = chooseDesignRules([], 'AI 기술 동향');
    expect(ds[0].templateId).toBe('dark-stage');
    expect(ds).toHaveLength(3);
    expect(ds.every((d) => TEMPLATES.some((t) => t.id === d.templateId))).toBe(true);
  });
});

describe('문서에 반영', () => {
  it('생성한 프레젠테이션 → 레이아웃 개체 틀에 채움 (바꾸기/추가)', () => {
    const doc = createPresentation();
    const deck = deckFromDocument(DOC, '제안서.md');
    const out = produce(doc, (d) => void insertDeck(d as Presentation, deck, 'replace'));
    expect(out.title).toBe('재택근무 도입 제안');
    expect(out.slides).toHaveLength(deck.slides.length);
    const cover = out.slides[0];
    expect(cover.layout).toBe('title');
    expect((cover.objects.find((o) => o.type === 'text' && o.ph?.type === 'ctrTitle') as TextObject).text.paragraphs[0].runs[0].text).toBe('재택근무 도입 제안');
    const s = out.slides.find((x) => x.objects.some((o) => o.type === 'text' && o.text.paragraphs.some((p) => p.runs[0]?.text === '채용 지역 확대')))!;
    expect(s.layout).toBe('titleContent');
    const body = s.objects.find((o) => o.type === 'text' && o.ph?.type === 'body') as TextObject;
    expect(body.text.paragraphs.every((p) => p.bullet === 'bullet')).toBe(true);
    expect(body.placeholder).toBeUndefined();
    const appended = produce(doc, (d) => void insertDeck(d as Presentation, { title: 'x', slides: [{ kind: 'twoColumn', title: '비교', left: ['가'], right: ['나'] }] }, 'append'));
    expect(appended.slides).toHaveLength(2);
    expect(appended.slides[1].objects.filter((o) => o.type === 'text' && o.ph?.type === 'body')).toHaveLength(2);
  });

  it('대본 → 노트, 레이아웃 바꾸기 (그림 등 유지)', () => {
    let doc = produce(createPresentation(), (d) => void insertDeck(d as Presentation, { title: 't', slides: [{ kind: 'title', title: 'T' }, { kind: 'bullets', title: '장단점', bullets: ['a', 'b', 'c', 'd'], notes: '기존 노트' }] }, 'replace'));
    doc = produce(doc, (d) => {
      d.slides[1].objects.push(createShape('rect', 10, 10));
    });
    const n = { v: 0 };
    doc = produce(doc, (d) => void (n.v = applyScripts(d as Presentation, doc.slides.map((s) => ({ slideId: s.id, script: '새 대본' })), true)));
    expect(n.v).toBe(1);
    expect(doc.slides.map((s) => s.notes)).toEqual(['새 대본', '기존 노트']);
    const id = doc.slides[1].id;
    doc = produce(doc, (d) => void changeLayout(d as Presentation, id, 'twoColumn'));
    const s = doc.slides[1];
    expect(s.id).toBe(id);
    expect(s.layout).toBe('twoContent');
    expect(s.notes).toBe('기존 노트');
    expect(s.objects.some((o) => o.type === 'shape')).toBe(true);
    const bodies = s.objects.filter((o) => o.type === 'text' && o.ph?.type === 'body') as TextObject[];
    expect(bodies.map((b) => b.text.paragraphs.length)).toEqual([2, 2]);
  });
});

describe('로컬 분석', () => {
  it('디자인 점검: 작은 글자, 대비, 슬라이드 밖, 빈 개체 틀 → 고치기', () => {
    let doc = produce(createPresentation(), (d) => {
      const s = d.slides[0];
      const small = createTextBox({ x: 100, y: 100, text: '작은 글자', style: { fontSize: 9 } });
      small.name = '작은';
      const pale = createTextBox({ x: 100, y: 300, text: '흐린 글자', style: { fontSize: 18, color: '#EEEEEE' } });
      pale.name = '흐린';
      const out = createTextBox({ x: 1200, y: 600, width: 300, height: 200, text: '밖' });
      s.objects.push(small, pale, out);
    });
    const issues = lintDesign(doc);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['smallText', 'contrast', 'offSlide', 'emptyPlaceholder']));
    doc = produce(doc, (d) => {
      for (const i of issues) if (i.fixable) fixIssue(d as Presentation, i);
    });
    const after = lintDesign(doc).map((i) => i.kind);
    expect(after).not.toContain('smallText');
    expect(after).not.toContain('contrast');
    expect(after).not.toContain('offSlide');
    expect(after).not.toContain('emptyPlaceholder');
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('글이 많은 슬라이드 나누기', () => {
    let doc = produce(createPresentation(), (d) => void insertDeck(d as Presentation, { title: 't', slides: [{ kind: 'bullets', title: '긴 슬라이드', bullets: Array.from({ length: 10 }, (_, i) => `항목 ${i + 1} ${'내용 '.repeat(10)}`) }] }, 'replace'));
    const issue = lintDesign(doc).find((i) => i.kind === 'tooMuchText')!;
    expect(issue).toBeTruthy();
    doc = produce(doc, (d) => void fixIssue(d as Presentation, issue));
    expect(doc.slides).toHaveLength(2);
    const t = digestSlides(doc);
    expect(t[1].title).toBe('긴 슬라이드 (계속)');
    expect(t[0].body.length + t[1].body.length).toBe(10);
  });

  it('대본 비교: 핵심어 포함률, 빠진 핵심어, 시간', () => {
    const doc = produce(createPresentation(), (d) =>
      void insertDeck(d as Presentation, { title: 't', slides: [{ kind: 'bullets', title: '재택근무 효과', bullets: ['출퇴근 시간 절감', '운영비 절감', '채용 확대'], notes: '재택근무를 하면 출퇴근 시간이 줄어듭니다.' }, { kind: 'bullets', title: '위험', bullets: ['소통 부족'] }] }, 'replace'),
    );
    const r = compareScripts(digestSlides(doc));
    expect(r[0].coverage).toBeGreaterThan(0.2);
    expect(r[0].coverage).toBeLessThan(1);
    expect(r[0].missing).toEqual(expect.arrayContaining(['채용']));
    expect(r[0].seconds).toBeGreaterThan(3);
    expect(r[1].notes[0]).toContain('대본');
  });
});

/* ───────────── Claude (가짜 응답으로 요청 형식 확인) ───────────── */

function sse(text: string, stop = 'end_turn') {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  const half = Math.floor(text.length / 2);
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(0, half) } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(half) } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }),
    ev('message_stop', {}),
  ].join('');
}

describe('Claude 제공자', () => {
  const deckJson = JSON.stringify({ title: '테스트', slides: [{ kind: 'title', title: '테스트', subtitle: '부제', bullets: [], left: [], right: [], notes: '' }, { kind: 'bullets', title: '내용', subtitle: '', bullets: ['하나', '둘'], left: [], right: [], notes: '대본' }] });

  it('요청: 모델·노력 수준·JSON 스키마·스트리밍·대체 모델·브라우저 직접 호출 헤더, 응답 검증', async () => {
    const calls: { url: string; headers: { get: (k: string) => string | null }; body: Record<string, unknown> }[] = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: hdrs(init), body: JSON.parse(String(init?.body)) });
      return new Response(sse(deckJson), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const progress: number[] = [];
    const p = new AnthropicProvider('sk-ant-test', 'claude-opus-5-5', 'medium', fake as unknown as typeof fetch);
    const deck = await p.generateDeck({ prompt: '테스트 발표' }, { slideCount: 2, withNotes: true }, { onProgress: (x) => progress.push(x.chars) });
    expect(deck.slides.map((s) => s.kind)).toEqual(['title', 'bullets']);
    expect(deck.slides[1].notes).toBe('대본');
    const c = calls[0];
    expect(c.url).toContain('/v1/messages');
    expect(c.headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(c.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(c.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(c.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(c.body.thinking).toBeUndefined();
    expect(JSON.stringify(c.body.messages)).toContain('테스트 발표');
    expect(progress.at(-1)).toBe(deckJson.length);
  });

  it('PDF 문서 블록, Haiku는 대체 모델 없이', async () => {
    let body: Record<string, unknown> = {};
    let beta: string | null = null;
    const fake = async (_u: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      beta = hdrs(init).get('anthropic-beta');
      return new Response(sse(deckJson), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    await new AnthropicProvider('k', 'claude-haiku-5-5', 'low', fake as typeof fetch).generateDeck({ document: { name: 'a.pdf', pdfBase64: 'JVBERi0=' } }, {});
    const content = (body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content;
    expect(content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(body.fallbacks).toBeUndefined();
    expect(beta ?? '').not.toContain('server-side-fallback');
  });

  it('오류: 401 → 키 오류, 거절 → refusal, 잘림 → format', async () => {
    const res401 = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    await expect(new AnthropicProvider('bad', undefined, undefined, res401 as typeof fetch).summarize('글', 'short')).rejects.toMatchObject({ kind: 'auth' });
    const refused = async () => new Response(sse('', 'refusal'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    await expect(new AnthropicProvider('k', undefined, undefined, refused as typeof fetch).summarize('글', 'short')).rejects.toMatchObject({ kind: 'refusal' });
    const cut = async () => new Response(sse('{"points":["a"', 'max_tokens'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    await expect(new AnthropicProvider('k', undefined, undefined, cut as typeof fetch).summarize('글', 'short')).rejects.toMatchObject({ kind: 'format' });
    expect(() => new AnthropicProvider('')).toThrow(/API 키/);
  });

  it('대본/디자인 선택 응답을 슬라이드 ID에 연결, 목록에 없는 템플릿은 버림', async () => {
    const digests = [
      { id: 's1', number: 1, layout: 'title', title: 'A', body: [], notes: '', hasImage: false, hasChart: false, hasTable: false },
      { id: 's2', number: 2, layout: 'titleContent', title: 'B', body: ['x'], notes: '', hasImage: false, hasChart: false, hasTable: false },
    ];
    const reply = (obj: unknown) => async () => new Response(sse(JSON.stringify(obj)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const scripts = await new AnthropicProvider('k', undefined, undefined, reply({ scripts: [{ slide_number: 2, script: '둘' }, { slide_number: 9, script: '없음' }] }) as typeof fetch).writeScript(digests, {});
    expect(scripts).toEqual([{ slideId: 's2', script: '둘' }]);
    const ds = await new AnthropicProvider('k', undefined, undefined, reply({ choices: [{ template_id: 'nope', color_scheme: 'blue', font_scheme: 'noto', reason: 'x' }, { template_id: 'geometric', color_scheme: 'green', font_scheme: 'noto', reason: '이유' }] }) as typeof fetch).chooseDesign(digests, 't');
    expect(ds).toEqual([{ templateId: 'geometric', colorScheme: 'green', fontScheme: 'noto', reason: '이유' }]);
  });
});

describe('OpenAI 호환 제공자 / 응답 검증', () => {
  it('json_schema 거부(400) 시 지시문에 스키마를 넣어 재시도', async () => {
    const bodies: Record<string, unknown>[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      if (b.response_format) return new Response('{"error":{"message":"response_format not supported"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"points":["하나","둘"]}\n```' }, finish_reason: 'stop' }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await new OpenAICompatibleProvider('http://localhost:11434/v1/', 'llama', undefined).summarize('글', 'short');
      expect(r).toBe('• 하나\n• 둘');
      expect(bodies).toHaveLength(2);
      expect(String((bodies[1].messages as { content: string }[])[1].content)).toContain('JSON schema');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('형식이 어긋난 응답도 안전하게 정리', () => {
    const d = normalizeDeck({ title: 3, slides: [{ kind: 'weird', title: '가', bullets: ['a', 7, ''] }, { title: '' }] });
    expect(d).toEqual({ title: '가', slides: [{ kind: 'bullets', title: '가', subtitle: undefined, bullets: ['a'], left: [], right: [], notes: undefined }] });
    expect(() => normalizeDeck({ slides: [] })).toThrow();
    expect(parseJSONText('설명 {"a":1} 끝')).toEqual({ a: 1 });
    expect(() => parseJSONText('없음')).toThrow();
  });
});

describe('GPT 중계 서버 제공자', () => {
  it('중계 서버 주소로, 접근 코드 헤더만 보내고 OpenAI 키는 보내지 않음', async () => {
    const { getProvider, getImageProvider, DEFAULT_AI_SETTINGS } = await import('./settings');
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      const h: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (h[k] = v));
      calls.push({ url: String(u), headers: h, body: JSON.parse(String(init?.body)) });
      if (String(u).endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"points":["가"]}' }, finish_reason: 'stop' }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const s = { ...DEFAULT_AI_SETTINGS, provider: 'gpt-proxy' as const, proxy: { url: 'https://proxy.example.workers.dev/', model: 'gpt-5-mini' }, image: { enabled: true, source: 'proxy' as const, baseUrl: '', model: 'gpt-image-1' } };
      const p = await getProvider(s, { access: 'code123' });
      expect(p.id).toBe('gpt-proxy');
      expect(await p.summarize('글', 'short')).toBe('• 가');
      expect(calls[0].url).toBe('https://proxy.example.workers.dev/v1/chat/completions');
      expect(calls[0].headers['x-slidelab-access']).toBe('code123');
      expect(calls[0].headers.authorization).toBeUndefined();
      expect(calls[0].body.model).toBe('gpt-5-mini');
      const img = await (await getImageProvider(s, { access: 'code123' })).generate('그림', '1024x1024');
      expect(img.type).toBe('image/png');
      expect(calls[1].url).toBe('https://proxy.example.workers.dev/v1/images/generations');
      expect(calls[1].headers['x-slidelab-access']).toBe('code123');
      await expect(getProvider({ ...s, proxy: { url: '', model: 'x' } }, {})).rejects.toThrow(/중계 서버 주소/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('중계 서버의 401 안내 문구를 그대로 보여 줌', async () => {
    const { OpenAICompatibleProvider } = await import('./openaiCompatible');
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: '접근 코드가 올바르지 않습니다.' } }), { status: 401 })) as typeof fetch;
    try {
      await expect(new OpenAICompatibleProvider('https://p.example/v1', 'gpt-5', undefined, 'GPT', {}, 'gpt-proxy').summarize('x', 'short')).rejects.toThrow(/접근 코드가 올바르지 않습니다/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
