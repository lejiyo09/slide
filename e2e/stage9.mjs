/**
 * 9단계 E2E: 슬라이드 마스터·레이아웃 전파, 테마/색/글꼴 조합, 템플릿, 사용자 지정 테마, 무늬 배경, 내보내기
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage9.mjs
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

const state = () => page.evaluate(() => JSON.parse(JSON.stringify((({ doc, activeSlideId, masterView, selectedIds }) => ({ doc, activeSlideId, masterView, selectedIds }))(window.__SLIDELAB__.getState()))));
const ph = (objs, type) => objs.find((o) => o.type === 'text' && o.ph?.type === type);
const run0 = (o) => o.text.paragraphs[0].runs[0];
const stage = () => page.locator('[data-testid="slide-stage"]').boundingBox();
const zoom = () => page.evaluate(() => window.__SLIDELAB__.getState().zoom);
const toScreen = async (x, y) => {
  const b = await stage();
  const z = await zoom();
  return { x: b.x + x * z, y: b.y + y * z };
};

await page.goto(BASE);
await page.waitForSelector('[data-testid="slide-stage"]');
let s = await state();
check('새 문서: 마스터 + 레이아웃 6개', !!s.doc.master && s.doc.layoutOrder.length === 6);
check('첫 슬라이드는 제목 슬라이드 레이아웃의 개체 틀', s.doc.slides[0].layout === 'title' && !!ph(s.doc.slides[0].objects, 'ctrTitle'));

// 슬라이드 2, 3 (제목 및 내용)
await page.locator('.stage').click({ position: { x: 3, y: 3 } });
await page.keyboard.press('Control+m');
await page.keyboard.press('Control+m');
s = await state();
check('Ctrl+M: 제목 슬라이드 다음은 "제목 및 내용"', s.doc.slides[1].layout === 'titleContent' && s.doc.slides[2].layout === 'titleContent');
// 슬라이드 3의 제목을 직접 옮김 (재정의)
const t3 = ph(s.doc.slides[2].objects, 'title');
let p = await toScreen(t3.x + t3.width / 2, t3.y + t3.height / 2);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(p.x + 80, p.y + 40, { steps: 6 });
await page.mouse.up();
s = await state();
const t3moved = ph(s.doc.slides[2].objects, 'title');
check('슬라이드 3 제목 직접 이동', t3moved.x > t3.x + 30);

// ── 슬라이드 마스터 보기 ──
await page.locator('.tab', { hasText: '보기' }).click();
await page.locator('.rb', { hasText: '슬라이드 마스터' }).click();
await page.waitForSelector('.master-panel');
s = await state();
check('마스터 보기 열기 (현재 슬라이드의 레이아웃 선택)', s.masterView && s.activeSlideId === 'titleContent');
check('마스터 패널: 마스터 + 레이아웃 축소판', (await page.locator('.master-panel .thumb').count()) === 7);
check('슬라이드 마스터 탭 표시', (await page.locator('.tab-master').count()) === 1);
await page.screenshot({ path: `${OUT}/s9-01-master-view.png` });

// 마스터 선택 → 제목 개체 틀 서식 변경 (글꼴 크기 + 테마 색 강조 2)
await page.locator('.master-panel .thumb-master').click();
s = await state();
const mt = ph(s.doc.master.objects, 'title');
p = await toScreen(mt.x + mt.width / 2, mt.y + mt.height / 2);
await page.mouse.click(p.x, p.y);
await page.locator('.tab', { hasText: '홈' }).click();
await page.locator('input.font-size').fill('48');
await page.locator('input.font-size').press('Enter');
await page.locator('.rb-split', { has: page.locator('button[title="글꼴 색"]') }).locator('.rb-split-caret').click();
await page.locator('.popover .cp-row-base .swatch[data-color="@accent2"]').click();
s = await state();
check('마스터 제목: 48pt + 테마 색 토큰(@accent2)', run0(ph(s.doc.master.objects, 'title')).fontSize === 48 && run0(ph(s.doc.master.objects, 'title')).color === '@accent2');
check('마스터 → 레이아웃 전파 (제목 및 내용)', run0(ph(s.doc.layouts.titleContent.objects, 'title')).color === '@accent2' && run0(ph(s.doc.layouts.titleContent.objects, 'title')).fontSize === 48);
check('마스터 → 레이아웃 → 슬라이드 전파 (색)', run0(ph(s.doc.slides[1].objects, 'title')).color === '@accent2' && run0(ph(s.doc.slides[2].objects, 'title')).color === '@accent2');
check('가운데 제목(제목 슬라이드)에도 색 전파', run0(ph(s.doc.slides[0].objects, 'ctrTitle')).color === '@accent2');

// 레이아웃 선택 → 제목 개체 틀을 아래로 이동 (방향키)
await page.locator('.master-panel .thumb[data-slide-id="titleContent"]').click();
s = await state();
const lt = ph(s.doc.layouts.titleContent.objects, 'title');
p = await toScreen(lt.x + lt.width / 2, lt.y + lt.height / 2);
await page.mouse.click(p.x, p.y);
await page.keyboard.press('Escape'); // 혹시 텍스트 편집이면 해제
await page.mouse.click(p.x, p.y);
for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
s = await state();
const lt2 = ph(s.doc.layouts.titleContent.objects, 'title');
check('레이아웃 제목 이동', lt2.y > lt.y + 20, `${lt.y} → ${lt2.y}`);
check('레이아웃 → 바꾸지 않은 슬라이드(2) 위치 전파', Math.abs(ph(s.doc.slides[1].objects, 'title').y - lt2.y) < 1);
check('직접 옮긴 슬라이드(3)는 위치 유지', Math.abs(ph(s.doc.slides[2].objects, 'title').y - t3moved.y) < 1);

// 레이아웃 삽입 / 이름 바꾸기 / 삭제
await page.locator('.tab-master').click();
await page.locator('.rb', { hasText: '레이아웃 삽입' }).click();
s = await state();
const newLayout = s.activeSlideId;
check('레이아웃 삽입', s.doc.layoutOrder.length === 7 && newLayout.startsWith('layout-'));
page.once('dialog', (d) => d.accept('내 레이아웃'));
await page.locator('.rb', { hasText: '이름 바꾸기' }).click();
s = await state();
check('레이아웃 이름 바꾸기', s.doc.layouts[newLayout].name === '내 레이아웃');
await page.locator('.rb', { hasText: '마스터 보기 닫기' }).click();
s = await state();
check('마스터 보기 닫기 → 원래 슬라이드로', !s.masterView && s.doc.slides.some((x) => x.id === s.activeSlideId));
// 새 레이아웃으로 슬라이드 추가 (레이아웃 갤러리)
await page.locator('.tab', { hasText: '홈' }).click();
await page.locator('.rb-split', { hasText: '새 슬라이드' }).locator('.rb-split-caret').click();
check('새 슬라이드 갤러리에 문서 레이아웃 표시', (await page.locator('.lg-item').count()) === 7);
await page.locator(`.lg-item[data-layout="${newLayout}"]`).click();
s = await state();
check('사용자 레이아웃으로 슬라이드 추가', s.doc.slides.some((x) => x.layout === newLayout));

// ── 템플릿 적용 ──
await page.locator('.tab', { hasText: '디자인' }).click();
await page.locator('.rb', { hasText: '템플릿' }).click();
await page.locator('.tpl-item[data-template="accent-bar"]').click();
s = await state();
check('디자인 템플릿 적용: 마스터 디자인 개체', s.doc.master.objects.some((o) => o.name === '디자인 요소'));
check('템플릿: 제목 슬라이드 레이아웃 배경 그래픽 숨김 + 장식', s.doc.layouts.title.showMasterShapes === false && s.doc.layouts.title.objects.some((o) => o.name === '디자인 요소'));
check('템플릿 적용 후에도 마스터 제목 서식(48pt) 유지', run0(ph(s.doc.master.objects, 'title')).fontSize === 48);
await page.locator('.slide-panel .thumb').nth(1).click();
await page.screenshot({ path: `${OUT}/s9-02-template.png` });

// 도형 하나 넣고(@accent1) 색 조합 변경 → 화면 색 변경
await page.locator('.tab', { hasText: '홈' }).click();
await page.locator('.rb', { hasText: '도형' }).first().click();
await page.locator('.sg-item[title="타원"]').click();
p = await toScreen(1000, 500);
await page.mouse.click(p.x, p.y);
const fillBefore = await page.locator('.sl-obj-shape path').last().getAttribute('fill');
await page.locator('.tab', { hasText: '디자인' }).click();
await page.locator('.rb', { hasText: '색' }).first().click();
await page.locator('.scheme-item[data-scheme="green"]').click();
s = await state();
const fillAfter = await page.locator('.sl-obj-shape path').last().getAttribute('fill');
check('색 조합(녹색) 적용', s.doc.theme.colors.accent1 === '#549E39');
check('토큰 색 도형이 새 색 조합으로 다시 그려짐', fillBefore !== fillAfter && fillAfter?.toUpperCase() === '#549E39', `${fillBefore} → ${fillAfter}`);

// 글꼴 조합
await page.locator('.rb', { hasText: '글꼴' }).first().click();
await page.locator('.font-scheme', { hasText: 'Georgia' }).click();
s = await state();
check('글꼴 조합 적용', s.doc.theme.fonts.heading === 'Georgia' && s.doc.theme.fonts.body === 'Verdana');
const titleFont = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.stage .sl-p span')].find((x) => x.textContent?.length);
  return el ? getComputedStyle(el).fontFamily : '';
});
check('제목 글꼴 토큰(@heading)이 새 글꼴로 표시', titleFont.includes('Georgia'), titleFont);

// ── 사용자 지정 테마 ──
await page.locator('.rb', { hasText: '테마 사용자 지정' }).click();
await page.locator('.td-color input').nth(4).evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, '#aa00ff');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.locator('.dialog .field input').last().fill('내 보라 테마');
await page.locator('.dialog .btn', { hasText: '사용자 지정 테마로 저장' }).click();
await page.waitForTimeout(300);
s = await state();
check('사용자 지정 테마 적용', s.doc.theme.colors.accent1 === '#AA00FF' && s.doc.theme.name === '내 보라 테마');
check('사용자 지정 테마가 테마 목록에 표시', (await page.locator('.theme-swatch', { hasText: '내 보라 테마' }).count()) === 1);

// ── 무늬 배경 ──
await page.locator('.rb', { hasText: '무늬' }).click();
await page.locator('.pattern-grid [data-pattern="smGrid"]').click();
s = await state();
const cur = s.doc.slides.find((x) => x.id === s.activeSlideId);
check('무늬 배경 적용', cur.background?.fill.type === 'pattern' && cur.background.fill.preset === 'smGrid');

// ── 템플릿으로 저장 → 새로 만들기에서 사용 ──
await page.locator('.rb', { hasText: '템플릿' }).click();
page.once('dialog', (d) => d.accept('E2E 템플릿'));
await page.locator('.menu-item', { hasText: '현재 디자인을 템플릿으로 저장' }).click();
await page.waitForTimeout(500);
const savedTpl = await page.evaluate(
  () =>
    new Promise((r) => {
      const req = indexedDB.open('slidelab');
      req.onsuccess = () => {
        const g = req.result.transaction('settings').objectStore('settings').get('userTemplates');
        g.onsuccess = () => r((g.result ?? []).map((t) => t.name));
      };
    }),
);
check('현재 디자인을 템플릿으로 저장', savedTpl.includes('E2E 템플릿'), JSON.stringify(savedTpl));

// ── 새로 고침 후 유지 ──
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
await page.reload();
await page.waitForSelector('[data-testid="slide-stage"]');
s = await state();
check('새로 고침 후 마스터·레이아웃·테마 유지', s.doc.layoutOrder.length === 7 && s.doc.theme.name === '내 보라 테마' && s.doc.master.objects.some((o) => o.name === '디자인 요소'));

// ── PPTX 내보내기 ──
await page.locator('.doc-title-input').fill('Stage9');
await page.locator('.doc-title-input').press('Enter');
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
await dl.saveAs(`${OUT}/s9-export.pptx`);
const zip = await JSZip.loadAsync(readFileSync(`${OUT}/s9-export.pptx`));
const x2 = await zip.file('ppt/slides/slide2.xml').async('string');
check('내보내기: 토큰 없이 실제 색 (@ 미포함)', !/"@[a-z]/.test(x2));
check('내보내기: 마스터 디자인 개체 포함', x2.includes('디자인 요소'));
const slides = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f).async('string')));
check('내보내기: 무늬 배경 a:pattFill', slides.some((x) => x.includes('<a:pattFill prst="smGrid">')));

// 새로 만들기: 저장한 템플릿 / 기본 템플릿
await page.locator('.bs-nav-item', { hasText: '새로 만들기' }).click();
check('새로 만들기에 내 템플릿 표시', await page.locator('.bs-card', { hasText: 'E2E 템플릿' }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
await page.locator('.bs-card[data-template="dark-stage"]').click();
await page.waitForTimeout(400);
s = await state();
check('템플릿으로 새 문서', s.doc.theme.id === 'midnight' && s.doc.slides.length === 1 && s.doc.master.objects.some((o) => o.name === '디자인 요소'));
await page.screenshot({ path: `${OUT}/s9-03-new-from-template.png` });

check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
