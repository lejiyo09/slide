/**
 * 12단계 E2E: AI 도우미 — 기본 엔진(키 없음)으로 만들기/목차/문서/요약/대본/비교/디자인 점검·아이디어/구성 추천,
 * Claude 제공자(가짜 API 응답으로 요청 형식·오류 처리 확인), 이미지 생성 인터페이스, 키 저장 위치
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage12.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const results = [];
const check = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const DOC = `# 재택근무 도입 제안

## 배경
코로나 이후 원격 근무가 보편화되었다. 우리 회사도 출퇴근 시간이 평균 1시간 20분으로 길다. 직원 설문에서 72%가 재택근무를 원했다.

## 기대 효과
- 출퇴근 시간 절감
- 사무실 운영비 15% 절감
- 채용 지역 확대

## 실행 계획
1단계로 한 팀에서 3개월 시범 운영한다. 2단계로 전사 확대 여부를 결정한다.

## 위험 요소
소통 부족과 성과 관리가 어려워질 수 있다. 정기 화상 회의로 보완한다.`;

const worker = (await import('../proxy/src/worker.js')).default;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/status of (401|500)/.test(m.text()) && errors.push(m.text()));

const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc)));
const slideTitles = (doc) =>
  doc.slides.map((s) => {
    const t = s.objects.find((o) => o.type === 'text' && (o.ph?.type === 'title' || o.ph?.type === 'ctrTitle'));
    return t ? t.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('') : '';
  });
const waitIdle = () => page.waitForFunction(() => !document.querySelector('[data-ai="busy"]'), null, { timeout: 15000 });
const pane = page.locator('.ai-pane');
const tab = (name) => pane.locator('.ai-tabs button', { hasText: name }).click();

// Claude API 가짜 응답 (SSE)
const sse = (text, stop = 'end_turn') => {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }),
    ev('message_stop', {}),
  ].join('');
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
let claudeMode = 'deck';
const claudeRequests = [];
await context.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  claudeRequests.push({ headers: req.headers(), body: JSON.parse(req.postData() ?? '{}') });
  if (claudeMode === '401') return route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid key' } }) });
  const body = JSON.parse(req.postData() ?? '{}');
  const schemaKeys = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  let json;
  if (schemaKeys.includes('slides'))
    json = { title: 'Claude가 만든 발표', slides: [{ kind: 'title', title: 'Claude가 만든 발표', subtitle: '부제', bullets: [], left: [], right: [], notes: '안녕하세요.' }, { kind: 'twoColumn', title: '장단점', subtitle: '', bullets: [], left: ['장점 1'], right: ['단점 1'], notes: '장단점입니다.' }] };
  else if (schemaKeys.includes('points')) json = { points: ['연결 테스트 요약'] };
  else json = {};
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(JSON.stringify(json)) });
});
// OpenAI (GPT) 가짜 응답: /chat/completions, /images/generations (1x1 PNG)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const gptRequests = [];
await context.route('https://api.openai.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  gptRequests.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() ?? '{}') });
  if (req.url().endsWith('/images/generations')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: PNG }] }) });
  const deck = { title: 'GPT가 만든 발표', slides: [{ kind: 'title', title: 'GPT가 만든 발표', subtitle: '', bullets: [], left: [], right: [], notes: '' }, { kind: 'bullets', title: '요점', subtitle: '', bullets: ['하나', '둘'], left: [], right: [], notes: '' }] };
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(deck) }, finish_reason: 'stop' }] }) });
});

// AI 중계 서버: 실제 Worker 코드(proxy/src/worker.js)로 처리, OpenAI 호출만 가짜
const PROXY = 'https://slidelab-ai-proxy.test.workers.dev';
const PROXY_ENV = { OPENAI_API_KEY: 'sk-server-only', ACCESS_CODE: 'e2e-code', ALLOWED_ORIGINS: new URL(BASE).origin, ALLOWED_MODELS: 'gpt-5-mini,gpt-image-1' };
const upstream = [];
await context.route(`${PROXY}/**`, async (route) => {
  const r = route.request();
  const req = new Request(r.url(), { method: r.method(), headers: r.headers(), ...(r.method() === 'POST' ? { body: r.postData() ?? '' } : {}) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    upstream.push({ url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
    if (String(url).endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const props = Object.keys(JSON.parse(init.body).response_format?.json_schema?.schema?.properties ?? {});
    const deck = props.includes('points')
      ? { points: ['중계 서버 요약'] }
      : { title: '중계 서버 발표', slides: [{ kind: 'title', title: '중계 서버 발표', subtitle: '', bullets: [], left: [], right: [], notes: '' }, { kind: 'bullets', title: '안전한 키', subtitle: '', bullets: ['키는 서버에만'], left: [], right: [], notes: '' }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(deck) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await worker.fetch(req, PROXY_ENV);
    const headers = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  } finally {
    globalThis.fetch = realFetch;
  }
});

try {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="slide-stage"]');
  // PWA 준비 알림이 창 아래 단추를 가리지 않게 닫음
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__SLIDELAB__.getState().toasts.forEach((t) => window.__SLIDELAB__.getState().dismissToast(t.id)));
  await page.addStyleTag({ content: '.toasts, .pwa-prompt { display: none !important; }' });

  /* ───── 기본 엔진: 만들기 ───── */
  await page.locator('.rb', { hasText: 'AI 도우미' }).click();
  await pane.waitFor();
  check('AI 도우미 창 열기 (홈 탭)', (await pane.locator('[data-ai="provider"]').textContent()).includes('기본 엔진'));
  await pane.locator('[data-ai="prompt"]').fill('신규 물류 시스템 도입 제안');
  await pane.locator('input[aria-label="슬라이드 수"]').fill('6');
  await pane.locator('[data-ai="generate"]').click();
  await waitIdle();
  let doc = await S();
  let titles = slideTitles(doc);
  check('주제로 만들기 (키 없음)', doc.slides.length === 6 && titles[0] === '신규 물류 시스템 도입 제안' && titles.includes('기대 효과'), titles.join(' | '));
  check('발표자 노트 함께 작성', doc.slides.every((s) => s.notes.length > 5));
  check('레이아웃 개체 틀 사용', doc.slides[0].layout === 'title' && doc.slides[1].layout === 'titleContent');
  await page.screenshot({ path: `${OUT}/s12-01-create.png` });
  await page.keyboard.press('Control+z');
  doc = await S();
  check('실행 취소 한 번으로 되돌림', doc.slides.length === 1);
  await page.keyboard.press('Control+y');

  // 목차 먼저
  await pane.locator('.ai-seg button', { hasText: '목차 먼저' }).click();
  await pane.locator('[data-ai="prompt"]').fill('인공지능 개념 교육');
  await pane.locator('input[aria-label="슬라이드 수"]').fill('');
  await pane.locator('[data-ai="outline"]').click();
  await waitIdle();
  const ot = await pane.locator('[data-ai="outline-text"]').inputValue();
  check('목차 만들기 → 편집 가능한 텍스트', ot.startsWith('# 인공지능 개념 교육') && ot.includes('## 핵심 원리'));
  await pane.locator('[data-ai="outline-text"]').fill(`${ot}\n\n## 직접 추가한 구역\n- 추가 요점`);
  await pane.locator('.ai-check', { hasText: '현재 슬라이드 뒤에 추가' }).locator('input').check();
  const before = (await S()).slides.length;
  await pane.locator('[data-ai="generate-outline"]').click();
  await waitIdle();
  doc = await S();
  titles = slideTitles(doc);
  check('고친 목차로 슬라이드 추가', doc.slides.length > before && titles.includes('직접 추가한 구역'), `${before} → ${doc.slides.length}`);

  // 문서에서
  await pane.locator('.ai-seg button', { hasText: '문서에서' }).click();
  await pane.locator('[data-ai="doc-text"]').fill(DOC);
  await pane.locator('.ai-check', { hasText: '현재 슬라이드를 모두 바꾸기' }).locator('input').check();
  await pane.locator('[data-ai="generate-doc"]').click();
  await waitIdle();
  doc = await S();
  titles = slideTitles(doc);
  check('문서로 만들기: 제목·목차·구역·핵심 정리', titles[0] === '재택근무 도입 제안' && titles.includes('기대 효과') && titles.at(-1) === '핵심 정리' && doc.title === '재택근무 도입 제안', titles.join(' | '));
  const effect = doc.slides[titles.indexOf('기대 효과')];
  const effectText = JSON.stringify(effect.objects);
  check('문서의 목록 항목을 그대로 사용', effectText.includes('사무실 운영비 15% 절감'));
  // docx 파일
  await pane.locator('[data-ai="doc-file"]').setInputFiles({ name: 'memo.md', mimeType: 'text/markdown', buffer: Buffer.from('# 메모\n\n## 첫째\n첫째 내용입니다.\n\n## 둘째\n- 항목 A\n- 항목 B') });
  check('문서 파일 읽기', (await pane.locator('[data-ai="doc-name"]').textContent()).includes('memo.md'));

  /* ───── 다듬기 ───── */
  await page.evaluate(() => {
    const st = window.__SLIDELAB__.getState();
    st.setActiveSlide(st.doc.slides[2].id);
  });
  await tab('다듬기');
  await pane.locator('[data-ai="summarize"]').click();
  await waitIdle();
  const sum = await pane.locator('[data-ai="summary"] pre').textContent();
  check('현재 슬라이드 요약', sum.startsWith('• '), sum.slice(0, 40));
  const n0 = (await S()).slides.length;
  await pane.locator('[data-ai="summary-slide"]').click();
  check('요약을 새 슬라이드로', (await S()).slides.length === n0 + 1);
  // 대본: 기존 노트 지우고 모든 슬라이드에
  await page.evaluate(() => window.__SLIDELAB__.getState().commit('노트 비우기', (d) => d.slides.forEach((s) => (s.notes = ''))));
  await pane.locator('[data-ai="script"]').click();
  await waitIdle();
  doc = await S();
  check('발표 대본 → 모든 슬라이드 노트', doc.slides.every((s) => s.notes.trim().length > 5) && doc.slides[0].notes.includes('안녕하세요'));
  await pane.locator('[data-ai="compare"]').click();
  await waitIdle();
  check('대본과 슬라이드 비교 (슬라이드별 포함률·시간)', (await pane.locator('.ai-cmp-row').count()) === doc.slides.length && (await pane.locator('.ai-total').textContent()).includes('예상 발표 시간'));
  await page.screenshot({ path: `${OUT}/s12-02-refine.png` });

  /* ───── 디자인 ───── */
  await page.evaluate(() => {
    const st = window.__SLIDELAB__.getState();
    const sid = st.doc.slides[1].id;
    st.setActiveSlide(sid);
    st.commit('문제 만들기', (d) => {
      const s = d.slides.find((x) => x.id === sid);
      s.objects.push({ id: 'tiny', type: 'text', name: '작은 글', x: 1200, y: 650, width: 300, height: 60, rotation: 0, fill: { type: 'none' }, stroke: null, text: { paragraphs: [{ runs: [{ text: '작고 흐린 글', fontSize: 8, color: '#F0F0F0' }] }], vAlign: 'top', direction: 'horizontal', padding: { top: 4, right: 4, bottom: 4, left: 4 }, autoFit: 'none' } });
    });
  });
  await tab('디자인');
  const kinds = await pane.locator('[data-ai="issues"] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  check('디자인 점검: 작은 글자·대비·슬라이드 밖', ['smallText', 'contrast', 'offSlide'].every((k) => kinds.includes(k)), kinds.join(','));
  await pane.locator('[data-ai="fix-all"]').click();
  const after = await pane.locator('[data-ai="issues"] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  doc = await S();
  const tiny = doc.slides[1].objects.find((o) => o.id === 'tiny');
  check('모두 고치기', !after.includes('smallText') && !after.includes('contrast') && !after.includes('offSlide') && tiny.x + tiny.width <= 1280 && tiny.text.paragraphs[0].runs[0].fontSize >= 12, after.join(','));
  await pane.locator('[data-ai="ideas"]').click();
  await waitIdle();
  check('디자인 아이디어 3가지 (미리 보기)', (await pane.locator('[data-ai="idea"]').count()) === 3 && (await pane.locator('[data-ai="idea"] .sl-slide').count()) === 3);
  await page.screenshot({ path: `${OUT}/s12-03-design.png` });
  const themeBefore = (await S()).theme.colors.accent1;
  await pane.locator('[data-ai="idea"]').first().click();
  const themeAfter = (await S()).theme;
  check('디자인 아이디어 적용', themeAfter.colors.accent1 !== themeBefore, `${themeBefore} → ${themeAfter.colors.accent1}`);
  // 구성 추천: 비교 슬라이드
  await page.evaluate(() => {
    const st = window.__SLIDELAB__.getState();
    st.commit('비교 슬라이드', (d) => {
      const s = d.slides[1];
      const t = s.objects.find((o) => o.ph?.type === 'title');
      t.text.paragraphs[0].runs[0].text = 'A안 vs B안 비교';
    });
  });
  await pane.locator('[data-ai="layout"]').click();
  await waitIdle();
  const sg = pane.locator('[data-ai="suggestions"] li', { hasText: '콘텐츠 2개' });
  check('구성 추천: 비교 → 2단 레이아웃', (await sg.count()) >= 1);
  await sg.first().locator('button', { hasText: '적용' }).click();
  doc = await S();
  check('추천 적용 → 레이아웃 변경', doc.slides[1].layout === 'twoContent' && doc.slides[1].objects.filter((o) => o.ph?.type === 'body').length === 2);

  /* ───── 이미지 (설정 전) ───── */
  await tab('이미지');
  check('이미지: 제공자 없으면 안내', (await pane.textContent()).includes('이미지 생성 제공자가 연결되어 있지 않습니다'));
  await tab('만들기');

  /* ───── Claude 연결 (가짜 API) ───── */
  await pane.locator('[data-ai="settings"]').click();
  await page.locator('.ai-settings label', { hasText: 'Claude (Anthropic)' }).locator('input').check();
  await page.locator('input[aria-label="Claude API 키"]').fill('sk-ant-e2e-test-key');
  await page.locator('[data-ai="test"]').click();
  await page.waitForSelector('.ai-test .ai-ok, .ai-test .ai-err', { timeout: 10000 });
  check('연결 테스트 (Claude)', (await page.locator('.ai-test .ai-ok').textContent()).includes('연결 테스트 요약'));
  await page.locator('.dialog .btn.primary', { hasText: '저장' }).click();
  check('제공자 표시 갱신', (await pane.locator('[data-ai="provider"]').textContent()).includes('Claude Opus 5.5'));
  const store = await page.evaluate(() => ({ local: localStorage.getItem('slidelab.ai.keys'), session: sessionStorage.getItem('slidelab.ai.keys'), settings: localStorage.getItem('slidelab.ai.settings') }));
  check('키는 세션 저장소에만 (기억 안 함)', !store.local && store.session.includes('sk-ant-e2e') && !store.settings.includes('sk-ant'));

  await tab('만들기');
  await pane.locator('.ai-seg button', { hasText: '주제·설명으로' }).click();
  await pane.locator('[data-ai="prompt"]').fill('장단점 발표');
  await pane.locator('.ai-check', { hasText: '현재 슬라이드를 모두 바꾸기' }).locator('input').check();
  claudeRequests.length = 0;
  await pane.locator('[data-ai="generate"]').click();
  await waitIdle();
  doc = await S();
  titles = slideTitles(doc);
  check('Claude 응답으로 슬라이드 생성', titles.join('|') === 'Claude가 만든 발표|장단점' && doc.slides[1].layout === 'twoContent' && doc.slides[1].notes === '장단점입니다.', titles.join('|'));
  const r = claudeRequests[0];
  check(
    'Claude 요청: 모델·키·브라우저 헤더·JSON 스키마·스트리밍·대체 모델',
    r && r.body.model === 'claude-opus-5-5' && r.headers.authorization === 'Bearer sk-ant-e2e-test-key' && r.headers['anthropic-dangerous-direct-browser-access'] === 'true' && r.body.output_config?.format?.type === 'json_schema' && r.body.stream === true && r.body.fallbacks === 'default',
    r ? JSON.stringify({ model: r.body.model, stream: r.body.stream, fallbacks: r.body.fallbacks }) : 'no request',
  );
  // 저장된 문서에 키가 없음
  await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
  const leaked = await page.evaluate(async () => {
    const req = indexedDB.open('slidelab');
    const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const names = [...db.objectStoreNames];
    let found = false;
    for (const n of names) {
      const all = await new Promise((r) => (db.transaction(n).objectStore(n).getAll().onsuccess = (e) => r(e.target.result)));
      if (JSON.stringify(all, (k, v) => (v instanceof Blob ? null : v)).includes('sk-ant-e2e')) found = true;
    }
    return found;
  });
  check('IndexedDB에 API 키 저장 안 됨', !leaked);
  // 401 오류
  claudeMode = '401';
  await tab('다듬기');
  await pane.locator('[data-ai="summarize"]').click();
  await waitIdle();
  check('잘못된 키(401) → 안내', (await pane.locator('[data-ai="error"]').textContent()).includes('API 키가 올바르지 않습니다'));
  claudeMode = 'deck';

  /* ───── GPT 중계 서버 (실제 Worker 코드) ───── */
  await pane.locator('[data-ai="settings"]').click();
  await page.locator('.ai-settings label', { hasText: 'GPT — 사이트 중계 서버' }).locator('input').check();
  await page.locator('input[aria-label="중계 서버 주소"]').fill(PROXY);
  await page.locator('input[aria-label="중계 서버 모델"]').fill('gpt-5-mini');
  await page.locator('input[aria-label="접근 코드"]').fill('wrong-code');
  await page.locator('[data-ai="test"]').click();
  await page.waitForSelector('.ai-test .ai-ok, .ai-test .ai-err', { timeout: 10000 });
  check('중계 서버: 틀린 접근 코드 거절', (await page.locator('.ai-test .ai-err').textContent()).includes('접근 코드가 올바르지 않습니다'));
  await page.locator('input[aria-label="접근 코드"]').fill('e2e-code');
  await page.locator('[data-ai="test"]').click();
  await page.waitForFunction(() => document.querySelector('.ai-test .ai-ok'), null, { timeout: 10000 });
  check('중계 서버: 연결 테스트', (await page.locator('.ai-test .ai-ok').textContent()).includes('연결됨'));
  await page.locator('.dialog .btn.primary', { hasText: '저장' }).click();
  check('제공자: GPT 중계 서버', (await pane.locator('[data-ai="provider"]').textContent()).includes('중계 서버'));
  await tab('만들기');
  await pane.locator('[data-ai="prompt"]').fill('중계 서버 발표');
  upstream.length = 0;
  await pane.locator('[data-ai="generate"]').click();
  await waitIdle();
  doc = await S();
  titles = slideTitles(doc);
  check('중계 서버 경유 GPT로 슬라이드 생성', titles.join('|') === '중계 서버 발표|안전한 키', titles.join('|'));
  check('OpenAI에는 서버 키로만 호출 (브라우저는 키 모름)', upstream.length === 1 && upstream[0].url === 'https://api.openai.com/v1/chat/completions' && upstream[0].auth === 'Bearer sk-server-only' && upstream[0].body.model === 'gpt-5-mini');
  const pageHasKey = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.documentElement.outerHTML);
  check('브라우저 저장소·화면 어디에도 OpenAI 키 없음', !pageHasKey.includes('sk-server-only'));
  await page.screenshot({ path: `${OUT}/s12-05-proxy.png` });

  /* ───── GPT (OpenAI) 연결 + 이미지 생성 (가짜 API) ───── */
  await pane.locator('[data-ai="settings"]').click();
  await page.locator('.ai-settings label', { hasText: 'OpenAI (GPT)' }).locator('input').check();
  await page.locator('input[aria-label="OpenAI API 키"]').fill('sk-gpt-e2e-test-key');
  await page.locator('input[aria-label="GPT 모델"]').fill('gpt-5-mini');
  await page.locator('.ai-settings label', { hasText: '이미지 생성 사용' }).locator('input').check();
  await page.locator('.ai-settings label', { hasText: '위 GPT 키 사용' }).locator('input').check();
  await page.locator('.ai-settings label', { hasText: '이 브라우저에 API 키 기억' }).locator('input').check();
  await page.locator('.dialog .btn.primary', { hasText: '저장' }).click();
  check('제공자: GPT', (await pane.locator('[data-ai="provider"]').textContent()).includes('GPT (gpt-5-mini)'));
  const kept = await page.evaluate(() => ({ local: localStorage.getItem('slidelab.ai.keys'), session: sessionStorage.getItem('slidelab.ai.keys') }));
  check('키 기억 켜면 localStorage', kept.local?.includes('sk-gpt-e2e') && !kept.session);
  await tab('만들기');
  await pane.locator('[data-ai="prompt"]').fill('GPT 발표');
  gptRequests.length = 0;
  await pane.locator('[data-ai="generate"]').click();
  await waitIdle();
  doc = await S();
  titles = slideTitles(doc);
  const g = gptRequests[0];
  check('GPT 응답으로 슬라이드 생성', titles.join('|') === 'GPT가 만든 발표|요점', titles.join('|'));
  check(
    'GPT 요청: 주소·키·모델·JSON 스키마(strict)',
    g && g.url === 'https://api.openai.com/v1/chat/completions' && g.headers.authorization === 'Bearer sk-gpt-e2e-test-key' && g.body.model === 'gpt-5-mini' && g.body.response_format?.type === 'json_schema' && g.body.response_format.json_schema.strict === true,
    g ? `${g.url} ${g.body.model}` : 'no request',
  );
  await tab('이미지');
  await pane.locator('[data-ai="image-prompt"]').fill('풍력 발전기');
  await pane.locator('[data-ai="image-generate"]').click();
  await waitIdle();
  await pane.locator('[data-ai="image-preview"]').waitFor();
  const ir = gptRequests.find((x) => x.url.endsWith('/images/generations'));
  check('GPT 이미지 요청 (gpt-image-1, 같은 키)', ir && ir.body.model === 'gpt-image-1' && ir.headers.authorization === 'Bearer sk-gpt-e2e-test-key' && ir.body.size === '1536x1024');
  await pane.locator('[data-ai="image-insert"]').click();
  await page.waitForTimeout(400);
  doc = await S();
  const active = await page.evaluate(() => window.__SLIDELAB__.getState().activeSlideId);
  check('생성한 이미지를 슬라이드에 삽입', doc.slides.find((s) => s.id === active).objects.some((o) => o.type === 'image' && o.name.includes('풍력')));
  await page.screenshot({ path: `${OUT}/s12-04-gpt.png` });

  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/s12-error.png` }).catch(() => {});
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
