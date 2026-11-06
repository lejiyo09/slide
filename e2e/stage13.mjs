/**
 * 13단계 E2E: 글꼴 — 글꼴 선택 상자(검색·필터·직접 입력), 무료 웹 글꼴, 내 글꼴 추가(파일 선택·끌어 놓기·이름 바꾸기·삭제),
 * 새로 고침 후 유지, 없는 글꼴 알림 → 글꼴 바꾸기, .slidelab에 글꼴 포함, PPTX 테마 한글 글꼴, 청중 창 글꼴
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage13.mjs
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
const FX = 'src/services/fonts/__fixtures__';
const TTF = readFileSync(`${FX}/TestSerif-Regular.ttf`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
watch(page);

// Google Fonts → 테스트 글꼴로 응답 (네트워크와 무관하게 실제 글꼴 적용 확인)
const webRequests = [];
await context.route('https://fonts.googleapis.com/**', (route) => {
  const u = new URL(route.request().url());
  webRequests.push(u.search);
  const fam = (u.searchParams.get('family') ?? '').split(':')[0];
  const css = `@font-face { font-family: '${fam}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/test/${encodeURIComponent(fam)}.ttf) format('truetype'); }`;
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: css });
});
await context.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'font/ttf', 'access-control-allow-origin': '*' }, body: TTF }));

const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc)));
const titleRuns = (doc) => doc.slides[0].objects.find((o) => o.ph?.type === 'ctrTitle').text.paragraphs[0].runs;
const openPicker = () => page.locator('.rb-font').click();
const editTitle = async (text) => {
  const box = await page.locator('[data-testid="slide-stage"]').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.4);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Control+a');
};

try {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="slide-stage"]');
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '.pwa-prompt { display: none !important; }' });

  /* ───── 글꼴 선택 상자 + 웹 글꼴 ───── */
  await editTitle('Hello 글꼴');
  await openPicker();
  const panel = page.locator('.font-panel');
  await panel.waitFor();
  const sections = await panel.locator('.fp-title').allTextContents();
  check('글꼴 선택 상자: 테마·웹·시스템 글꼴 구역', sections.includes('테마 글꼴') && sections.some((s) => s.startsWith('무료 웹 글꼴')) && sections.includes('기본 시스템 글꼴'), sections.join(' | '));
  const webCount = await panel.locator('.fp-section', { hasText: '무료 웹 글꼴' }).locator('.fp-item').count();
  check('무료 웹 글꼴 60여 종', webCount >= 55, String(webCount));
  await panel.locator('.fp-filters button', { hasText: '손글씨' }).click();
  await panel.locator('.fp-ko input').check();
  const hand = await panel.locator('.fp-item').allTextContents();
  check('종류(손글씨)·한글 필터', hand.some((t) => t.includes('Nanum Pen Script')) && !hand.some((t) => t.includes('Pacifico')) && !hand.some((t) => t.includes('Roboto')), String(hand.length));
  await panel.locator('.fp-filters button', { hasText: '전체' }).click();
  await panel.locator('.fp-search').fill('jua');
  const found = await panel.locator('.fp-item').allTextContents();
  check('검색', found.length === 1 && found[0].includes('Jua'), found.join(','));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__SLIDELAB__.getState().editingTextId === null || true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let doc = await S();
  check('웹 글꼴 적용 (Jua)', titleRuns(doc).every((r) => r.fontFamily === 'Jua'), JSON.stringify(titleRuns(doc).map((r) => r.fontFamily)));
  check('글꼴을 바꿔도 글자 크기 유지 (54pt)', titleRuns(doc).every((r) => r.fontSize === 54), JSON.stringify(titleRuns(doc).map((r) => r.fontSize)));
  // 일부만 선택해 글꼴 바꾸기
  {
    const box = await page.locator('[data-testid="slide-stage"]').boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await openPicker();
    await page.locator('.font-panel .fp-search').fill('Arial');
    await page.locator('.font-panel [data-font="Arial"]').first().click();
    await page.keyboard.press('Escape');
    const runs = titleRuns(await S()).map((r) => [r.text, r.fontFamily, r.fontSize]);
    check('일부 글자만 글꼴 바꾸기 (크기 유지)', JSON.stringify(runs) === JSON.stringify([['Hello ', 'Jua', 54], ['글꼴', 'Arial', 54]]), JSON.stringify(runs));
    await page.keyboard.press('Control+z');
    const undone = titleRuns(await S()).map((r) => [r.text, r.fontFamily]);
    check('다시 편집한 내용(방향키 사용)도 따로 실행 취소', JSON.stringify(undone) === JSON.stringify([['Hello 글꼴', 'Jua']]), JSON.stringify(undone));
  }
  await page.waitForFunction(() => document.fonts.check('16px "Jua"'), null, { timeout: 5000 });
  check('웹 글꼴 내려받아 등록', (await page.locator('link[data-webfont="Jua"]').count()) === 1 && webRequests.some((q) => q.includes('family=Jua:ital,wght')));
  check('목록 미리 보기는 이름 글자만 요청 (text=)', webRequests.some((q) => q.includes('text=')));
  await page.screenshot({ path: `${OUT}/s13-01-webfont.png` });

  /* ───── 없는 글꼴 → 알림 → 글꼴 바꾸기 ───── */
  await editTitle();
  await openPicker();
  await page.locator('.font-panel .fp-search').fill('My Missing Font');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  doc = await S();
  check('목록에 없는 이름 직접 입력', titleRuns(doc)[0].fontFamily === 'My Missing Font', JSON.stringify(titleRuns(doc)));
  await page.waitForSelector('[data-missing-fonts]', { timeout: 5000 });
  check('없는 글꼴 알림 (상태 표시줄)', (await page.locator('[data-missing-fonts]').textContent()).includes('글꼴 1개 없음'));
  await page.locator('[data-missing-fonts]').click();
  await page.waitForSelector('.replace-fonts');
  check('글꼴 바꾸기: 없는 글꼴 표시', (await page.locator('[data-font-row="My Missing Font"]').textContent()).includes('없음'));
  await page.locator('select[aria-label="바꿀 글꼴"]').selectOption('My Missing Font');
  await page.locator('.replace-fonts [data-font-picker]').click();
  await page.locator('.font-panel .fp-search').fill('Noto Sans KR');
  await page.keyboard.press('Enter');
  await page.locator('[data-font-replace]').click();
  doc = await S();
  check('글꼴 바꾸기 적용', titleRuns(doc).every((r) => r.fontFamily === 'Noto Sans KR'));
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-missing-fonts]'), null, { timeout: 5000 });
  check('알림 사라짐', true);
  await page.keyboard.press('Control+z');
  doc = await S();
  check('글꼴 바꾸기 실행 취소', titleRuns(doc)[0].fontFamily === 'My Missing Font');
  await page.keyboard.press('Control+y');

  /* ───── 내 글꼴 추가 ───── */
  await page.locator('.tab', { hasText: '홈' }).click();
  await page.locator('.rb', { hasText: '바꾸기' }).click();
  await page.locator('.menu-item', { hasText: '글꼴 관리' }).click();
  await page.waitForSelector('.font-manager');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-font-pick]').click()]);
  await fc.setFiles([`${FX}/TestSerif-Regular.ttf`, `${FX}/TestSerif-BoldItalic.ttf`]);
  await page.waitForSelector('[data-family="SlideLab Test Serif"]');
  const chips = await page.locator('[data-family="SlideLab Test Serif"] .chip').allTextContents();
  check('글꼴 파일 추가: 이름·스타일 읽기', chips.join(',') === 'Regular,Bold Italic', chips.join(','));
  check('한국어 이름도 표시', (await page.locator('[data-family="SlideLab Test Serif"]').textContent()).includes('슬라이드랩 테스트 명조'));
  check('브라우저에 등록', await page.evaluate(() => document.fonts.check('16px "SlideLab Test Serif"') && document.fonts.check('bold italic 16px "SlideLab Test Serif"') && document.fonts.check('16px "슬라이드랩 테스트 명조"')));
  // 끌어 놓기 (WOFF2 → 이름은 파일 이름으로 추정)
  const w2 = readFileSync(`${FX}/TestSerif-Regular.woff2`).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'Dropped-Medium.woff2', { type: 'font/woff2' }));
    document.querySelector('[data-font-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, w2);
  await page.waitForSelector('[data-family="Dropped"]');
  check('끌어 놓아 추가 (WOFF2, 이름 추정)', (await page.locator('[data-family="Dropped"] .chip').textContent()) === 'Medium');
  await page.screenshot({ path: `${OUT}/s13-02-manager.png` });
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();

  // 내 글꼴 적용
  await editTitle();
  await openPicker();
  await page.locator('.font-panel .fp-section', { hasText: '내 글꼴' }).locator('[data-font="SlideLab Test Serif"]').click();
  await page.keyboard.press('Escape');
  doc = await S();
  check('내 글꼴 적용', titleRuns(doc).every((r) => r.fontFamily === 'SlideLab Test Serif'));
  const used = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="slide-stage"] span')].find((s) => s.textContent.includes('Hello'));
    return el ? getComputedStyle(el).fontFamily : '';
  });
  check('캔버스에 내 글꼴로 표시', used.startsWith('"SlideLab Test Serif"'), used);
  await page.screenshot({ path: `${OUT}/s13-03-userfont.png` });

  /* ───── 새로 고침 후에도 유지 ───── */
  await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
  await page.reload();
  await page.waitForSelector('[data-testid="slide-stage"]');
  await page.waitForFunction(() => document.fonts.check('16px "SlideLab Test Serif"'), null, { timeout: 5000 });
  check('새로 고침 후 내 글꼴 자동 등록', true);

  /* ───── 이름 바꾸기: 기존 글자는 예전 이름으로도 계속 표시 ───── */
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ fontDialog: 'manage' }));
  await page.waitForSelector('[data-family="SlideLab Test Serif"]');
  await page.locator('[data-family="SlideLab Test Serif"] button[title="이름 바꾸기"]').click();
  await page.locator('input[aria-label="글꼴 이름"]').fill('우리 회사 명조');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-family="우리 회사 명조"]');
  check('이름 바꾸기 + 예전 이름 유지', await page.evaluate(() => document.fonts.check('16px "우리 회사 명조"') && document.fonts.check('16px "SlideLab Test Serif"')));
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();

  /* ───── .slidelab에 글꼴 포함 → 삭제 후 다시 열면 복원 ───── */
  await page.evaluate(() => window.__SLIDELAB__.getState().commit('글꼴 이름 맞춤', (d) => d.slides[0].objects.find((o) => o.ph?.type === 'ctrTitle').text.paragraphs[0].runs.forEach((r) => (r.fontFamily = '우리 회사 명조'))));
  await page.locator('.tab-file').click();
  await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'SlideLab 문서' }).click()]);
  const nativePath = `${OUT}/s13-export.slidelab`;
  await dl.saveAs(nativePath);
  const native = JSON.parse(readFileSync(nativePath, 'utf8'));
  check('.slidelab에 쓴 글꼴만 포함', native.fonts?.length === 2 && native.fonts.every((f) => f.family === '우리 회사 명조' && f.dataUrl.startsWith('data:')), JSON.stringify(native.fonts?.map((f) => f.family)));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ backstageOpen: false, fontDialog: 'manage' }));
  for (const fam of ['우리 회사 명조', 'Dropped']) await page.locator(`[data-font-delete="${fam}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[data-family]'));
  check('글꼴 삭제 (등록 해제)', await page.evaluate(() => !document.fonts.check('16px "우리 회사 명조"') || ![...document.fonts].some((f) => f.family.includes('우리 회사 명조'))));
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();
  await page.evaluate(async (text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'restored.slidelab', { type: 'application/json' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, readFileSync(nativePath, 'utf8'));
  await page.waitForFunction(() => document.fonts.check('16px "우리 회사 명조"') && [...document.fonts].some((f) => f.family.includes('우리 회사 명조')), null, { timeout: 8000 });
  check('.slidelab 열면 글꼴 복원', true);

  /* ───── PPTX: 테마 한글 글꼴 + 글자 글꼴 ───── */
  await page.evaluate(() => window.__SLIDELAB__.getState().commit('테마 글꼴', (d) => (d.theme.fonts = { heading: 'Noto Serif KR', body: 'Gowun Dodum' })));
  await page.locator('.tab-file').click();
  await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
  await dl2.saveAs(`${OUT}/s13-export.pptx`);
  const zip = await JSZip.loadAsync(readFileSync(`${OUT}/s13-export.pptx`));
  const theme = await zip.file('ppt/theme/theme1.xml').async('string');
  check('PPTX 테마: 한글(Hang·ea)도 테마 글꼴', theme.includes('<a:font script="Hang" typeface="Noto Serif KR"/>') && theme.includes('<a:font script="Hang" typeface="Gowun Dodum"/>') && theme.includes('<a:ea typeface="Gowun Dodum"/>'));
  const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
  check('PPTX 글자: latin·ea에 내 글꼴 이름', s1.includes('<a:latin typeface="우리 회사 명조"') && s1.includes('<a:ea typeface="우리 회사 명조"'));
  await page.keyboard.press('Escape');

  /* ───── 청중 창에도 내 글꼴 ───── */
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ backstageOpen: false }));
  await page.keyboard.press('Alt+F5');
  await page.waitForSelector('.presenter');
  await page.locator('[data-pv="display"]').click();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.show-menu-item', { hasText: '청중 화면 창 열기' }).click()]);
  watch(popup);
  await popup.waitForSelector('.slideshow .show-stage');
  await popup.waitForFunction(() => document.fonts.check('16px "우리 회사 명조"') && [...document.fonts].some((f) => f.family.includes('우리 회사 명조')), null, { timeout: 5000 });
  check('청중 창에 내 글꼴 등록', true);
  await page.locator('[data-pv="end"]').click();

  /* ───── 웹 글꼴 끄기 ───── */
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ fontDialog: 'manage' }));
  await page.locator('[data-webfonts]').uncheck();
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();
  await editTitle();
  await openPicker();
  check('웹 글꼴 끄면 목록에서 제외', (await page.locator('.font-panel .fp-title', { hasText: '무료 웹 글꼴' }).count()) === 0);
  await page.keyboard.press('Escape');

  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/s13-error.png` }).catch(() => {});
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
