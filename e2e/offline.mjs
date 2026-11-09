/**
 * 오프라인(PWA) E2E: 서비스 워커 설치 → 네트워크 끊기 → 새로 고침 → 앱·지연 로딩 기능 동작
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/offline.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173/';
let failures = 0;
const results = [];
const check = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="slide-stage"]');
  // 서비스 워커가 페이지를 제어할 때까지 (처음 방문 후 새로 고침)
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 20000 });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  check('서비스 워커가 페이지 제어', true);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let n = 0;
    for (const k of names) n += (await (await caches.open(k)).keys()).length;
    return { names, n };
  });
  check('사전 캐시 (앱 파일)', cached.n > 30, `${cached.names.join(',')} ${cached.n}개`);
  // 온라인일 때 맞춤법 사전을 한 번 받아 둠
  await page.evaluate(() => window.__SLIDELAB__.getState().commit('t', (d) => (d.slides[0].objects[0].text.paragraphs = [{ runs: [{ text: 'This presentaion' }] }])));
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ spellPane: true }));
  await page.waitForSelector('[data-spell-word]', { timeout: 30000 });
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ spellPane: false }));

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid="slide-stage"]', { timeout: 15000 });
  check('오프라인에서 새로 고침 → 편집기 열림', true);
  check('오프라인: 문서 유지(IndexedDB)', await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects[0].text.paragraphs[0].runs[0].text === 'This presentaion'));
  // 지연 로딩 기능
  await page.keyboard.press('F5');
  await page.waitForSelector('.slideshow .show-stage', { timeout: 10000 });
  check('오프라인: 슬라이드 쇼 (지연 로딩 코드)', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ equationEditorId: 'new' }));
  await page.waitForSelector('[data-eq-preview] math', { timeout: 10000 });
  check('오프라인: 수식 편집기(Temml) + 수식 글꼴', await page.evaluate(async () => (await document.fonts.load('20px "STIX Two Math"', '∑')).length > 0));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ spellPane: true }));
  await page.waitForSelector('[data-spell-word]', { timeout: 30000 });
  check('오프라인: 맞춤법 검사 (한 번 받은 사전)', (await page.locator('[data-spell-word]').textContent()) === 'presentaion');
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ spellPane: false }));
  // 오프라인 편집·저장
  await page.evaluate(() => window.__SLIDELAB__.getState().commit('오프라인 편집', (d) => (d.title = '오프라인에서 고침')));
  await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
  await page.reload();
  await page.waitForSelector('[data-testid="slide-stage"]');
  check('오프라인 편집 → 저장 → 새로 고침 후 유지', (await page.evaluate(() => window.__SLIDELAB__.getState().doc.title)) === '오프라인에서 고침');
  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
