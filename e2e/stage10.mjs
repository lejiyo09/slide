/**
 * 10단계 E2E: 전환·애니메이션 편집, 애니메이션 창, 미리 보기, 슬라이드 쇼 재생, 트리거, PPTX
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage10.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const JSZip = (await import('jszip')).default;

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const results = [];
const check = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const state = () => page.evaluate(() => JSON.parse(JSON.stringify((({ doc, activeSlideId, selectedIds, selectedAnimIds, preview }) => ({ doc, activeSlideId, selectedIds, selectedAnimIds, preview }))(window.__SLIDELAB__.getState()))));
const active = async () => {
  const s = await state();
  return s.doc.slides.find((x) => x.id === s.activeSlideId);
};
const stage = () => page.locator('[data-testid="slide-stage"]').boundingBox();
const zoom = () => page.evaluate(() => window.__SLIDELAB__.getState().zoom);
const toScreen = async (x, y) => {
  const b = await stage();
  const z = await zoom();
  return { x: b.x + x * z, y: b.y + y * z };
};
const clickObj = async (o) => {
  const p = await toScreen(o.x + o.width / 2, o.y + o.height / 2);
  await page.mouse.click(p.x, p.y);
};

await page.goto(BASE);
await page.waitForSelector('[data-testid="slide-stage"]');
await page.locator('.stage').click({ position: { x: 3, y: 3 } });
await page.keyboard.press('Control+m');
// 슬라이드 2: 비우고 도형 2개 + 텍스트 상자
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
for (const [shape, x] of [['사각형', 200], ['타원', 700]]) {
  await page.locator('.tab', { hasText: '홈' }).click();
  await page.locator('.rb', { hasText: '도형' }).first().click();
  await page.locator(`.sg-item[title="${shape}"]`).click();
  const p = await toScreen(x, 300);
  await page.mouse.click(p.x, p.y);
}
let slide = await active();
const [rect, ell] = slide.objects;
check('준비: 도형 2개', slide.objects.length === 2);

// ── 전환 ──
await page.locator('.tab', { hasText: '전환' }).click();
await page.locator('.fx-item[data-transition="push"]').click();
let s = await state();
slide = s.doc.slides.find((x) => x.id === s.activeSlideId);
check('전환 적용 (밀어내기)', slide.transition?.type === 'push' && slide.transition.duration === 1000);
check('전환 미리 보기 실행', s.preview?.kind === 'transition' && (await page.locator('.preview-overlay').count()) === 1);
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/s10-01-transition-preview.png` });
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 5000 });
check('미리 보기 끝나면 자동으로 닫힘', (await page.locator('.preview-overlay').count()) === 0);
await page.locator('.rb', { hasText: '효과 옵션' }).click();
await page.locator('.menu-item', { hasText: '위로' }).click();
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 5000 });
await page.locator('.timing-field input.seconds-input').first().fill('0.5');
slide = await active();
check('방향·기간 변경', slide.transition.direction === 'up' && slide.transition.duration === 500);
await page.locator('.rb', { hasText: '모두 적용' }).click();
s = await state();
check('모두 적용', s.doc.slides.every((x) => x.transition?.type === 'push' && x.transition.duration === 500));
check('축소판 효과 표시(★)', (await page.locator('.slide-panel .thumb-fx').count()) === 2);

// ── 애니메이션 ──
await page.locator('.tab', { hasText: '애니메이션' }).click();
await clickObj(rect);
await page.locator('.fx-item[data-effect="fade"]').click();
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 5000 });
await clickObj(ell);
await page.locator('.fx-item[data-effect="flyIn"]').click();
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 5000 });
slide = await active();
check('나타내기 효과 2개 적용', slide.animations?.length === 2 && slide.animations[0].effect === 'fade' && slide.animations[1].effect === 'flyIn');
check('번호 배지 표시', (await page.locator('.anim-badge').count()) === 2);
// 시작/재생 시간/지연/방향
await page.locator('.timing-field select').first().selectOption('afterPrevious');
await page.locator('.timing-field', { hasText: '재생 시간' }).locator('input').fill('0.75');
await page.locator('.timing-field', { hasText: '지연' }).locator('input').fill('0.25');
await page.locator('.rb', { hasText: '효과 옵션' }).click();
await page.locator('.menu-item', { hasText: '왼쪽에서' }).click();
slide = await active();
const fly = slide.animations[1];
check('시작·재생 시간·지연·방향 편집', fly.start === 'afterPrevious' && fly.duration === 750 && fly.delay === 250 && fly.direction === 'left', JSON.stringify(fly));
// 같은 개체에 강조 추가
await page.locator('.rb', { hasText: '애니메이션 추가' }).click();
await page.locator('.chip[data-add-effect="spin"]').click();
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 8000 });
slide = await active();
check('애니메이션 추가 (같은 개체에 강조)', slide.animations.length === 3 && slide.animations[2].effect === 'spin' && slide.animations[2].targetId === ell.id);
// 반복
await page.locator('.timing-field', { hasText: '반복' }).locator('select').selectOption('2');
// 애니메이션 창
await page.locator('.rb', { hasText: '애니메이션 창' }).click();
check('애니메이션 창: 3개 항목', (await page.locator('.ap-item').count()) === 3);
await page.screenshot({ path: `${OUT}/s10-02-anim-pane.png` });
// 순서 바꾸기: spin을 앞으로
await page.locator('.ap-item').nth(2).click();
await page.locator('.ap-tools button[title="앞으로"]').click();
slide = await active();
check('순서 바꾸기', slide.animations[1].effect === 'spin');
// 트리거: spin → 사각형 클릭 시
await page.locator('.rb', { hasText: '트리거' }).click();
await page.locator('.popover .menu-item', { hasText: '사각형' }).click();
slide = await active();
check('트리거 설정', slide.animations[1].triggerId === rect.id);
check('애니메이션 창: 트리거 묶음 표시', (await page.locator('.ap-trigger').count()) === 1);
await page.keyboard.press('Control+z');
slide = await active();
check('실행 취소 (트리거)', !slide.animations[1].triggerId);
await page.keyboard.press('Control+y');
// 미리 보기 (모두 재생)
await page.locator('.ap-tools .btn', { hasText: '모두 재생' }).click();
await page.waitForSelector('.preview-overlay');
await page.waitForTimeout(250);
const hiddenDuringPreview = await page.evaluate(() => [...document.querySelectorAll('.preview-overlay .sl-obj')].map((e) => getComputedStyle(e).opacity));
check('애니메이션 미리 보기 재생', hiddenDuringPreview.length >= 2, hiddenDuringPreview.join(','));
await page.waitForFunction(() => !window.__SLIDELAB__.getState().preview, null, { timeout: 8000 });

// ── 슬라이드 쇼 ──
await page.keyboard.press('Shift+F5');
await page.waitForSelector('.slideshow');
const vis = (id) => page.evaluate((i) => {
  const el = document.querySelector(`.slideshow [data-obj-id="${i}"]`);
  if (!el) return 'none';
  const cs = getComputedStyle(el);
  return `${cs.visibility}:${Number(cs.opacity).toFixed(2)}`;
}, id);
check('쇼 시작: 나타내기 대상은 숨김', (await vis(rect.id)).startsWith('hidden') && (await vis(ell.id)).startsWith('hidden'), `${await vis(rect.id)} ${await vis(ell.id)}`);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const midFade = await vis(rect.id);
check('클릭 1: 페이드 재생 중', midFade.startsWith('visible') && Number(midFade.split(':')[1]) < 1, midFade);
await page.waitForTimeout(1800);
check('페이드 후 이전 효과 다음에(날아오기) 자동 연속', (await vis(ell.id)).startsWith('visible'), await vis(ell.id));
await page.screenshot({ path: `${OUT}/s10-03-show.png` });
// 트리거: 사각형 클릭 → 타원 회전
const r = await page.locator(`.slideshow [data-obj-id="${rect.id}"]`).boundingBox();
await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
await page.waitForTimeout(400);
const rot = await page.evaluate((i) => getComputedStyle(document.querySelector(`.slideshow [data-obj-id="${i}"]`)).transform, ell.id);
check('트리거 클릭 → 회전 재생', rot !== 'none' && !rot.startsWith('matrix(1, 0, 0, 1'), rot);
check('트리거 클릭은 슬라이드를 넘기지 않음', (await page.locator('.show-controls span').textContent()).startsWith('2'));
// 이전 → 첫 슬라이드 (뒤로 가면 전환 없이)
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(80);
check('다음 슬라이드로 넘어갈 때 전환 재생', (await page.locator('.show-stage[data-transition="running"]').count()) === 1);
await page.waitForTimeout(700);
check('전환 끝', (await page.locator('.show-stage[data-transition="running"]').count()) === 0);
await page.keyboard.press('Escape');

// ── PPTX ──
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
await page.locator('.doc-title-input').fill('Stage10');
await page.locator('.doc-title-input').press('Enter');
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
await dl.saveAs(`${OUT}/s10-export.pptx`);
const zip = await JSZip.loadAsync(readFileSync(`${OUT}/s10-export.pptx`));
const x2 = await zip.file('ppt/slides/slide2.xml').async('string');
check('내보내기: 밀어내기 전환', x2.includes('<p:push dir="u"/>') && x2.includes('p14:dur="500"'));
check('내보내기: 애니메이션 타이밍 (메인 + 트리거)', x2.includes('nodeType="mainSeq"') && x2.includes('nodeType="interactiveSeq"') && x2.includes('nodeType="afterEffect"'));
const spids = [...x2.matchAll(/<p:spTgt spid="(\d+)"\/>/g)].map((m) => m[1]);
check('내보내기: 대상 spid가 모두 실제 도형', spids.every((id) => x2.includes(`<p:cNvPr id="${id}"`)), spids.join(','));

check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
