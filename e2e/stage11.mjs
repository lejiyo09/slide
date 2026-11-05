/**
 * 11단계 E2E: 발표 도구 — 펜/형광펜/지우개/레이저, 확대, 모든 슬라이드 보기, 오른쪽 클릭 메뉴, 숨긴 슬라이드(H),
 * 잉크 유지, 발표자 보기(타이머·노트·다음 슬라이드·청중 창 동기화), 예행 연습, 녹화(가짜 마이크), 쇼 설정, 재구성한 쇼, PPTX
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage11.mjs
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

// 가짜 마이크(녹화 테스트)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
watch(page);

const S = () => page.evaluate(() => JSON.parse(JSON.stringify((({ doc, activeSlideId, slideshow }) => ({ doc, activeSlideId, slideshow }))(window.__SLIDELAB__.getState()))));
const counter = () => page.locator('.show-counter').textContent();
const pvCounter = () => page.locator('[data-pv="counter"]').textContent();
const stageBox = (scope = '') => page.locator(`${scope} .show-stage`).first().boundingBox();
const draw = async (box, pts) => {
  await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 });
  await page.mouse.up();
};
const endShow = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
};
const waitNoShow = () => page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow, null, { timeout: 8000 });

try {
await page.goto(BASE);
await page.waitForSelector('[data-testid="slide-stage"]');
// 준비: 슬라이드 3장 (노트, 도형). 편집 UI 자체는 이전 단계에서 검증했으므로 스토어로 구성
await page.evaluate(() => {
  const st = window.__SLIDELAB__.getState();
  st.commit('준비', (d) => {
    const base = d.slides[0];
    d.slides[0].notes = '첫 번째 슬라이드 노트\n둘째 줄';
    for (let i = 2; i <= 3; i++) d.slides.push({ ...JSON.parse(JSON.stringify(base)), id: `s${i}`, notes: `노트 ${i}`, objects: [{ id: `r${i}`, type: 'shape', name: `도형${i}`, shape: 'rect', x: 100 * i, y: 200, width: 200, height: 120, rotation: 0, fill: { type: 'solid', color: '#4472C4' }, stroke: null, text: { paragraphs: [{ runs: [{ text: `슬라이드 ${i}` }] }], vAlign: 'middle', direction: 'horizontal', padding: { top: 4, right: 8, bottom: 4, left: 8 }, autoFit: 'none' } }] });
  });
});
let s = await S();
check('준비: 슬라이드 3장', s.doc.slides.length === 3);

/* ───── 청중 화면: 펜·형광펜·지우개·레이저 ───── */
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow[data-view="audience"] .show-stage');
await page.mouse.move(400, 400);
check('쇼 시작: 청중 화면 + 도구 모음', (await page.locator('.show-controls').count()) === 1 && (await counter()).trim() === '1 / 3');
await page.locator('.show-controls [data-tool="pen-menu"]').click();
await page.locator('.show-menu .show-menu-item', { hasText: '펜' }).first().click();
let box = await stageBox();
await draw(box, [[0.2, 0.2], [0.4, 0.3], [0.6, 0.25]]);
check('펜으로 그리기 (도구 모음 메뉴)', (await page.locator('.show-ink path[data-ink="pen"]').count()) === 1);
check('펜 사용 중 클릭은 슬라이드를 넘기지 않음', (await counter()).trim() === '1 / 3');
await page.keyboard.press('Control+i');
await draw(box, [[0.2, 0.7], [0.8, 0.7]]);
const hl = page.locator('.show-ink path[data-ink="highlighter"]');
check('형광펜 (Ctrl+I): 반투명 굵은 선', (await hl.count()) === 1 && Number(await hl.getAttribute('opacity')) < 1 && Number(await hl.getAttribute('stroke-width')) > 10);
await page.keyboard.press('Control+e');
await page.mouse.click(box.x + 0.5 * box.width, box.y + 0.7 * box.height);
check('지우개 (Ctrl+E): 닿은 획만 지움', (await page.locator('.show-ink path').count()) === 1 && (await page.locator('.show-ink path[data-ink="pen"]').count()) === 1);
await page.keyboard.press('Control+l');
await page.mouse.move(box.x + 300, box.y + 200);
await page.mouse.move(box.x + 310, box.y + 205);
check('레이저 포인터 (Ctrl+L)', (await page.locator('.show-laser').count()) === 1);
await page.screenshot({ path: `${OUT}/s11-01-ink-laser.png` });
await page.keyboard.press('Control+m');
check('잉크 숨기기 (Ctrl+M)', (await page.locator('.show-ink').count()) === 0);
await page.keyboard.press('Control+m');
await page.keyboard.press('Control+a');
check('화살표로 (Ctrl+A)', (await page.locator('.show-laser').count()) === 0);

/* ───── 확대 / 모든 슬라이드 / 메뉴 ───── */
await page.keyboard.press('+');
check('+ 확대', (await page.locator('.show-stage').getAttribute('data-zoom')) === '1.5');
const tf1 = await page.locator('.show-zoom').evaluate((e) => e.style.transform);
box = await stageBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 - 100, { steps: 5 });
await page.mouse.up();
const tf2 = await page.locator('.show-zoom').evaluate((e) => e.style.transform);
check('확대한 화면 끌어서 이동 (넘어가지 않음)', tf1 !== tf2 && (await counter()).trim() === '1 / 3', `${tf1} → ${tf2}`);
await page.keyboard.press('-');
check('- 축소', (await page.locator('.show-stage').getAttribute('data-zoom')) === null);
await page.locator('.show-controls [data-tool="zoom"]').click();
box = await stageBox();
await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75);
check('확대 영역 선택 렌즈', (await page.locator('.show-lens').count()) === 1);
await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.75);
check('클릭한 곳을 2배 확대', (await page.locator('.show-stage').getAttribute('data-zoom')) === '2' && (await counter()).trim() === '1 / 3');
await page.screenshot({ path: `${OUT}/s11-02-zoom.png` });
await page.keyboard.press('Escape');
check('Esc: 확대 해제 (쇼는 계속)', (await page.locator('.show-stage').getAttribute('data-zoom')) === null && (await page.locator('.slideshow').count()) === 1);
await page.keyboard.press('-');
check('확대 안 한 상태에서 - → 모든 슬라이드 보기', (await page.locator('.show-grid .show-grid-item').count()) === 3);
await page.screenshot({ path: `${OUT}/s11-03-grid.png` });
await page.locator('.show-grid-item').nth(2).click();
check('모든 슬라이드에서 슬라이드 3으로 이동', (await counter()).trim() === '3 / 3' && (await page.locator('.show-grid').count()) === 0);
await page.mouse.click(box.x + 20, box.y + 20, { button: 'right' });
check('오른쪽 클릭 메뉴', (await page.locator('.show-menu .show-menu-item', { hasText: '모든 슬라이드 보기' }).count()) === 1);
await page.locator('.show-menu .show-menu-item', { hasText: '이전' }).first().click();
check('메뉴: 이전', (await counter()).trim() === '2 / 3');
await page.keyboard.press('b');
check('검은 화면 (B)', (await page.locator('.show-blank.black').count()) === 1);
await page.keyboard.press('b');
await page.keyboard.press('1');
await page.keyboard.press('Enter');
check('번호 + Enter 이동', (await counter()).trim() === '1 / 3');
// 끝내기 → 잉크 유지
await endShow();
check('잉크가 있으면 유지 여부 질문', (await page.locator('.show-prompt', { hasText: '잉크 주석을 유지' }).count()) === 1);
await page.locator('.show-prompt .btn.primary').click();
await waitNoShow();
s = await S();
const inkShapes = s.doc.slides[0].objects.filter((o) => o.type === 'shape' && o.shape === 'custom');
check('잉크 유지 → 자유형 도형 (빨간 펜)', inkShapes.length === 1 && inkShapes[0].stroke.color === '#FF0000' && inkShapes[0].geometry.paths[0].cmds.length >= 3);
await page.keyboard.press('Control+z');
s = await S();
check('실행 취소 한 번으로 잉크 도형 제거', s.doc.slides[0].objects.filter((o) => o.type === 'shape' && o.shape === 'custom').length === 0);

/* ───── 숨긴 슬라이드 (H) ───── */
await page.evaluate(() => window.__SLIDELAB__.getState().commit('숨김', (d) => void (d.slides[1].hidden = true)));
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow .show-stage');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
check('숨긴 슬라이드 건너뜀', (await counter()).trim() === '3 / 3');
await page.keyboard.press('Home');
await page.keyboard.press('h');
await page.waitForTimeout(100);
check('H: 다음 숨긴 슬라이드 표시', (await counter()).trim() === '2 / 3');
await endShow();
await waitNoShow();
await page.evaluate(() => window.__SLIDELAB__.getState().commit('숨김 해제', (d) => void (d.slides[1].hidden = false)));

/* ───── 발표자 보기 + 청중 창 ───── */
await page.keyboard.press('Alt+F5');
await page.waitForSelector('.presenter');
await page.waitForTimeout(1300);
check('발표자 보기 (Alt+F5)', (await page.locator('.presenter .pv-current .show-stage').count()) === 1);
check('발표자 보기: 노트', (await page.locator('[data-pv="notes"]').textContent()).includes('첫 번째 슬라이드 노트'));
check('발표자 보기: 다음 슬라이드 미리 보기', (await page.locator('[data-pv="next-preview"] .sl-slide').count()) === 1);
const e1 = await page.locator('[data-pv="elapsed"]').textContent();
check('타이머 진행', e1 >= '00:00:01', e1);
await page.locator('[data-pv="timer-toggle"]').click();
const p1 = await page.locator('[data-pv="elapsed"]').textContent();
await page.waitForTimeout(1200);
check('타이머 일시 중지', (await page.locator('[data-pv="elapsed"]').textContent()) === p1);
await page.locator('[data-pv="timer-reset"]').click();
check('타이머 다시 시작(0)', (await page.locator('[data-pv="elapsed"]').textContent()) === '00:00:00');
const fs0 = await page.locator('[data-pv="notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
await page.locator('[data-pv="notes-bigger"]').click();
const fs1 = await page.locator('[data-pv="notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
check('노트 텍스트 확대', fs1 > fs0, `${fs0} → ${fs1}`);
// 청중 창
await page.locator('[data-pv="display"]').click();
const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.show-menu-item', { hasText: '청중 화면 창 열기' }).click()]);
watch(popup);
await popup.waitForSelector('.slideshow[data-view="audience-window"] .show-stage', { timeout: 5000 });
check('청중 화면 창 열림 (스타일 복사)', (await popup.locator('.slideshow').evaluate((e) => getComputedStyle(e).position)) === 'fixed');
await page.locator('[data-pv="next"]').click();
await page.waitForTimeout(150);
check('발표자 보기에서 넘기면 청중 창도 같이', (await pvCounter()).includes('2 / 3') && (await popup.locator('[data-obj-id="r2"]').count()) === 1);
// 발표자 보기에서 펜 → 청중 창에 잉크
await page.keyboard.press('Control+p');
box = await stageBox('.pv-current');
await draw(box, [[0.3, 0.3], [0.5, 0.5]]);
check('발표자 보기 잉크가 청중 창에 표시', (await popup.locator('.show-ink path').count()) === 1);
await page.keyboard.press('Control+a');
await page.keyboard.press('w');
check('흰 화면이 청중 창에 표시', (await popup.locator('.show-blank.white').count()) === 1);
await page.keyboard.press('w');
await page.screenshot({ path: `${OUT}/s11-04-presenter.png` });
await popup.screenshot({ path: `${OUT}/s11-05-audience-window.png` });
// 청중 창에서 키보드로 넘기기
await popup.locator('.slideshow').focus();
await popup.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
check('청중 창 키보드 → 발표자 보기도 이동', (await pvCounter()).includes('3 / 3'));
await page.locator('[data-pv="end"]').click();
await page.locator('.show-prompt .btn:not(.primary)').click(); // 잉크 버리기
await waitNoShow();
await page.waitForTimeout(300);
check('쇼를 끝내면 청중 창 닫힘', popup.isClosed());
s = await S();
check('잉크 취소 → 도형 추가 안 됨', s.doc.slides[1].objects.every((o) => o.shape !== 'custom'));

/* ───── 예행 연습 ───── */
await page.locator('.tab', { hasText: '슬라이드 쇼' }).click();
await page.locator('.rb', { hasText: '예행 연습' }).click();
await page.waitForSelector('.rec-bar');
await page.waitForTimeout(1100);
check('예행 연습 도구 모음: 슬라이드 시간', (await page.locator('[data-rec="slide-time"]').textContent()) === '00:00:01');
await page.locator('[data-rec="next"]').click();
await page.waitForTimeout(600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
await page.keyboard.press('ArrowRight'); // 끝
await page.waitForTimeout(100);
await page.keyboard.press('ArrowRight'); // 끝 화면 클릭 → 종료 질문
check('예행 연습 끝: 시간 저장 질문', (await page.locator('.show-prompt', { hasText: '새 슬라이드 시간을 저장' }).count()) === 1);
await page.locator('.show-prompt .btn.primary').click();
await waitNoShow();
s = await S();
const t = s.doc.slides.map((x) => x.transition?.advanceAfter);
check('예행 연습 시간 저장', t[0] >= 1000 && t[0] < 2500 && t[1] >= 500 && t[1] < 1500 && t[2] > 0 && s.doc.showSettings.useTimings === true, JSON.stringify(t));
// 시간 사용: 저장된 시간으로 자동 진행
await page.evaluate(() => window.__SLIDELAB__.getState().commit('짧게', (d) => d.slides.forEach((x) => (x.transition.advanceAfter = 300))));
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow .show-stage');
await page.waitForTimeout(1300);
check('설정된 시간으로 자동 진행', (await page.locator('.show-end').count()) === 1);
await endShow();
await waitNoShow();

/* ───── 녹화 (가짜 마이크) ───── */
await page.locator('.tab', { hasText: '녹화' }).click();
await page.locator('.rb', { hasText: '처음부터' }).click();
await page.waitForSelector('.rec-bar');
await page.locator('[data-rec="start"]').click();
await page.waitForFunction(() => document.querySelector('.rec-state')?.textContent?.includes('녹화 중'), null, { timeout: 5000 });
await page.waitForTimeout(1200);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(900);
await page.locator('[data-rec="stop"]').click();
await waitNoShow();
await page.waitForTimeout(500);
s = await S();
const nar = s.doc.slides.map((x) => x.objects.find((o) => o.type === 'media' && o.narration));
check('녹화: 슬라이드 1·2에 내레이션 오디오', !!nar[0] && !!nar[1] && !nar[2], JSON.stringify(nar.map((n) => !!n)));
check('내레이션: 자동 재생 + 쇼 중 숨김 + WAV', nar[0]?.autoPlay && nar[0]?.hideInShow && s.doc.assets[nar[0].assetId]?.mime === 'audio/wav');
check('녹화 시간 저장', s.doc.slides[0].transition.advanceAfter >= 1000 && s.doc.slides[1].transition.advanceAfter >= 700, `${s.doc.slides[0].transition.advanceAfter},${s.doc.slides[1].transition.advanceAfter}`);
const blobSize = await page.evaluate(async (key) => {
  const req = indexedDB.open('slidelab');
  const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const tx = db.transaction('blobs');
  const v = await new Promise((r) => (tx.objectStore('blobs').get(key).onsuccess = (e) => r(e.target.result)));
  const b = v?.data ?? v;
  return b?.size ?? (b instanceof Blob ? b.size : -1);
}, s.doc.assets[nar[0].assetId].blobKey);
check('내레이션 파일 저장 (IndexedDB)', blobSize > 44, String(blobSize));
// 쇼에서 내레이션 아이콘은 숨기고 재생
await page.evaluate(() => window.__SLIDELAB__.getState().commit('수동', (d) => (d.showSettings.useTimings = false)));
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow .show-stage');
await page.waitForTimeout(300);
const audio = await page.evaluate(() => {
  const a = document.querySelector('.slideshow audio');
  return a ? { hidden: getComputedStyle(a.parentElement).visibility, paused: a.paused, src: !!a.src } : null;
});
check('쇼: 내레이션 자동 재생, 아이콘 숨김', audio && audio.hidden === 'hidden' && audio.src && audio.paused === false, JSON.stringify(audio));
await endShow();
await waitNoShow();
// 녹화 지우기 (내레이션 모두)
await page.locator('.rb', { hasText: '녹화 지우기' }).click();
await page.locator('.menu-item', { hasText: '모든 슬라이드의 내레이션 지우기' }).click();
s = await S();
check('모든 슬라이드의 내레이션 지우기', s.doc.slides.every((x) => !x.objects.some((o) => o.narration)));
await page.keyboard.press('Control+z');

/* ───── 쇼 설정 / 재구성한 쇼 ───── */
await page.locator('.tab', { hasText: '슬라이드 쇼' }).click();
await page.locator('.rb', { hasText: '쇼 재구성' }).click();
await page.locator('.menu-item', { hasText: '쇼 재구성...' }).click();
await page.locator('[data-cs="new"]').click();
await page.locator('input[aria-label="쇼 이름"]').fill('요약');
const left = page.locator('ul[aria-label="프레젠테이션에 있는 슬라이드"] input[type="checkbox"]');
await left.nth(2).check();
await page.locator('[data-cs="add"]').click();
await left.nth(0).check();
await page.locator('[data-cs="add"]').click();
await page.locator('.dialog .btn.primary', { hasText: '확인' }).click();
s = await S();
check('재구성한 쇼 만들기 (3 → 1 순서)', s.doc.customShows?.length === 1 && s.doc.customShows[0].name === '요약' && s.doc.customShows[0].slideIds.join() === [s.doc.slides[2].id, s.doc.slides[0].id].join());
await page.locator('.dialog .btn.primary', { hasText: '쇼 보기' }).click();
await page.waitForSelector('.slideshow .show-stage');
const c1 = (await counter()).trim();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
const c2 = (await counter()).trim();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
check('재구성한 쇼 재생: 슬라이드 3 → 1 → 끝', c1 === '3 / 3' && c2 === '1 / 3' && (await page.locator('.show-end').count()) === 1, `${c1}, ${c2}`);
await endShow();
await endShow();
await waitNoShow().catch(() => {});
// 쇼 설정: 범위 2~3, 반복, 웹 형식
await page.locator('.rb', { hasText: '슬라이드 쇼 설정' }).click();
await page.locator('.show-settings input[name="showType"]').nth(1).check();
await page.locator('.show-settings label', { hasText: 'Esc' }).locator('input').check();
await page.locator('.show-settings input[name="range"]').nth(1).check();
await page.locator('input[aria-label="시작 슬라이드"]').fill('2');
await page.locator('input[aria-label="끝 슬라이드"]').fill('3');
await page.locator('.show-settings label', { hasText: '펜 색' }).locator('input').evaluate((e) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(e, '#00b050');
  e.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.locator('.dialog .btn.primary').click();
s = await S();
check('쇼 설정 저장', s.doc.showSettings.showType === 'browsed' && s.doc.showSettings.loop && s.doc.showSettings.range.kind === 'range' && s.doc.showSettings.range.from === 2 && s.doc.showSettings.penColor === '#00B050', JSON.stringify(s.doc.showSettings));
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow .show-stage');
check('웹 형식: 창 안 + 제목 표시줄', (await page.locator('.show-browsed-title').count()) === 1 && (await page.evaluate(() => !document.fullscreenElement)));
const b1 = await page.locator('.show-browsed-bar span').textContent();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
const b2 = await page.locator('.show-browsed-bar span').textContent();
check('범위 2~3 + 반복: 2 → 3 → 2', b1.includes('2 / 3') && b2.includes('2 / 3'), `${b1} / ${b2}`);
await page.keyboard.press('Control+p');
box = await stageBox();
await draw(box, [[0.3, 0.3], [0.4, 0.4]]);
check('쇼 설정의 펜 색', (await page.locator('.show-ink path').getAttribute('stroke')).toUpperCase() === '#00B050');
await page.keyboard.press('e');
await page.screenshot({ path: `${OUT}/s11-06-browsed.png` });
await endShow();
await endShow();
await waitNoShow();

/* ───── PPTX ───── */
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
await dl.saveAs(`${OUT}/s11-export.pptx`);
const zip = await JSZip.loadAsync(readFileSync(`${OUT}/s11-export.pptx`));
const props = await zip.file('ppt/presProps.xml').async('string');
check('내보내기: 쇼 설정 (웹 형식, 범위, 반복, 펜 색)', props.includes('<p:browse/><p:sldRg st="2" end="3"/>') && props.includes('loop="1"') && props.includes('val="00B050"'));
const presXml = await zip.file('ppt/presentation.xml').async('string');
check('내보내기: 재구성한 쇼', presXml.includes('<p:custShow name="요약" id="0">'));
const x1 = await zip.file('ppt/slides/slide1.xml').async('string');
check('내보내기: 내레이션 오디오 + 자동 재생', x1.includes('<a:audioFile') && x1.includes('presetClass="mediacall"') && x1.includes('showWhenStopped="0"'));

check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/s11-error.png` }).catch(() => {});
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
