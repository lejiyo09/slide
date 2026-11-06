/**
 * 13단계 보완 E2E: 글꼴 제한 해결
 *  - 웹 글꼴 자체 호스팅(같은 출처 webfonts/, Google에 요청 없음) + 목록에 없는 글꼴은 Google로 대체
 *  - TTC(글꼴 모음) 추가, WOFF2 실제 이름 읽기
 *  - 웹 글꼴 오프라인 보관(전체 TTF → 내 글꼴, 가변 글꼴)
 *  - PPTX 내보내기 글꼴 포함(fntdata/EOT) + 설정 끄기, PPTX 포함 글꼴 가져오기(PowerPoint MTX 압축 → 내 글꼴, 화면 표시)
 *   npm run build && node scripts/webfonts.mjs dist/webfonts --only=Jua,Inter && npx vite preview --port 4173 &  →  node e2e/stage13b.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
if (!existsSync('dist/webfonts/manifest.json')) throw new Error('먼저 node scripts/webfonts.mjs dist/webfonts --only=Jua,Inter 를 실행하세요.');

// 오프라인 보관용 실제 글꼴 파일 (google/fonts 고정 커밋). 브라우저 요청은 이 내용으로 응답
const gf = JSON.parse(readFileSync('src/services/fonts/googleFiles.json', 'utf8'));
const juaUrl = `https://raw.githubusercontent.com/google/fonts/${gf.commit}/${gf.fonts.Jua.path}/${gf.fonts.Jua.files[0].file}`;
const juaTtf = Buffer.from(await (await fetch(juaUrl)).arrayBuffer());

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} @ ${m.location().url}`));

const googleRequests = [];
const sameOrigin = [];
context.on('request', (r) => {
  const u = r.url();
  if (/fonts\.(googleapis|gstatic)\.com/.test(u)) googleRequests.push(u);
  if (u.startsWith(BASE) && u.includes('/webfonts/')) sameOrigin.push(u);
});
// Google Fonts는 이 테스트에서 실제로 받지 않음 (요청이 나갔는지만 확인)
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: '' }));
const rawRequests = [];
await context.route('https://raw.githubusercontent.com/**', (route) => {
  rawRequests.push(route.request().url());
  return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*', 'content-length': String(juaTtf.length) }, body: juaTtf });
});

const fontsState = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB_FONTS__.getState())));
const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc)));
const setTitleFont = (family) =>
  page.evaluate((f) => window.__SLIDELAB__.getState().commit('글꼴', (d) => d.slides[0].objects.find((o) => o.ph?.type === 'ctrTitle').text.paragraphs = [{ runs: [{ text: 'Hello 글꼴 테스트', fontFamily: f }], align: 'center' }]), family);
const openManager = async () => {
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ fontDialog: 'manage', backstageOpen: false }));
  await page.waitForSelector('.font-manager');
};
const closeDialog = () => page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();
const exportPptx = async (name) => {
  await page.locator('.tab-file').click();
  await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
  await dl.saveAs(`${OUT}/${name}`);
  return JSZip.loadAsync(readFileSync(`${OUT}/${name}`));
};

try {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="slide-stage"]');
  await page.addStyleTag({ content: '.pwa-prompt { display: none !important; }' });

  /* ───── 웹 글꼴 자체 호스팅 ───── */
  await setTitleFont('Jua');
  await page.waitForFunction(() => document.fonts.check('16px Jua') && [...document.fonts].some((f) => f.family === 'Jua' && f.status === 'loaded'), null, { timeout: 10000 });
  const juaLink = await page.evaluate(() => document.querySelector('link[data-webfont="Jua"]')?.href ?? '');
  check('자체 호스팅: 같은 출처 스타일시트', juaLink.startsWith(BASE) && /webfonts\/jua\.css\?v=/.test(juaLink), juaLink);
  check('자체 호스팅: woff2 조각을 같은 출처에서 받음', sameOrigin.some((u) => u.endsWith('.woff2')), String(sameOrigin.length));
  check('자체 호스팅: Google에 요청하지 않음', googleRequests.length === 0, googleRequests.slice(0, 2).join(' '));
  await openManager();
  check('글꼴 관리: 이 사이트에서 받는다고 표시', (await page.locator('[data-websource]').getAttribute('data-websource')) === 'self');
  await closeDialog();
  // 자체 호스팅에 없는 글꼴은 Google로 대체
  await setTitleFont('Gaegu');
  await page.waitForFunction(() => !!document.querySelector('link[data-webfont="Gaegu"]'), null, { timeout: 8000 });
  const gaegu = await page.evaluate(() => document.querySelector('link[data-webfont="Gaegu"]').href);
  check('자체 호스팅에 없는 글꼴은 Google Fonts로 대체', gaegu.startsWith('https://fonts.googleapis.com/css2?family=Gaegu'), gaegu);

  // 글꼴 선택 상자 미리 보기: 이 사이트의 작은 미리 보기 파일
  const box = await page.locator('[data-testid="slide-stage"]').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.4);
  await page.keyboard.press('Control+a');
  await page.locator('.rb-font').click();
  await page.locator('.font-panel').waitFor();
  await page.waitForFunction(() => !!document.querySelector('link[data-webfont="preview:Inter"]'), null, { timeout: 5000 });
  const previewHref = await page.evaluate(() => document.querySelector('link[data-webfont="preview:Jua"]')?.href ?? '');
  check('미리 보기: 이 사이트의 미리 보기 파일', previewHref.includes('/webfonts/jua.preview.css'), previewHref);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  /* ───── TTC, WOFF2 실제 이름 ───── */
  await openManager();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-font-pick]').click()]);
  await fc.setFiles([`${FX}/TestSerif.ttc`]);
  await page.waitForSelector('[data-family="SlideLab Test Serif"]');
  const chips = await page.locator('[data-family="SlideLab Test Serif"] .fm-styles .chip').allTextContents();
  check('TTC(글꼴 모음) → 글꼴마다 추가', chips.join(',') === 'Regular,Bold Italic', chips.join(','));
  check('TTC 글꼴 브라우저 등록', await page.evaluate(() => document.fonts.check('16px "SlideLab Test Serif"') && document.fonts.check('bold italic 16px "SlideLab Test Serif"')));
  const w2 = readFileSync(`${FX}/TestSerif-Regular.woff2`).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'NanumGothic-ExtraBold.woff2', { type: 'font/woff2' }));
    document.querySelector('[data-font-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, w2);
  await page.waitForFunction(() => window.__SLIDELAB_FONTS__.getState().userFonts.some((f) => f.fileName === 'NanumGothic-ExtraBold.woff2'), null, { timeout: 8000 });
  const wf = (await fontsState()).userFonts.find((f) => f.fileName === 'NanumGothic-ExtraBold.woff2');
  check('WOFF2: 파일 이름이 아니라 글꼴 안의 이름', wf.family === 'SlideLab Test Serif' && wf.weight === 400 && wf.aliases.includes('슬라이드랩 테스트 명조'), `${wf.family} ${wf.weight}`);
  check('Nanum Gothic으로 잘못 추정하지 않음', !(await fontsState()).userFonts.some((f) => f.family === 'Nanum Gothic'));

  /* ───── 웹 글꼴 오프라인 보관 ───── */
  await page.locator('select[aria-label="보관할 웹 글꼴"]').selectOption('Jua');
  const label = await page.locator('[data-keep-btn]').textContent();
  check('보관 크기 표시', /받기 \(\d/.test(label), label);
  await page.locator('[data-keep-btn]').click();
  await page.waitForSelector('[data-family="Jua"] [data-kept]', { timeout: 15000 });
  const jua = (await fontsState()).userFonts.filter((f) => f.family === 'Jua');
  check('오프라인 보관 → 내 글꼴 (전체 TTF)', jua.length === 1 && jua[0].origin === 'web' && jua[0].size === juaTtf.length && jua[0].license.includes('Open Font'), JSON.stringify(jua.map((f) => [f.fileName, f.size])));
  check('google/fonts 고정 커밋에서 받음', rawRequests.length === 1 && rawRequests[0].includes(gf.commit));
  await page.screenshot({ path: `${OUT}/s13b-01-manager.png` });
  await closeDialog();

  /* ───── PPTX 내보내기: 글꼴 포함 ───── */
  await page.evaluate(() =>
    window.__SLIDELAB__.getState().commit('글꼴', (d) => {
      const t = d.slides[0].objects.find((o) => o.ph?.type === 'ctrTitle');
      t.text.paragraphs = [{ runs: [{ text: 'Jua 제목', fontFamily: 'Jua' }, { text: ' Serif', fontFamily: 'SlideLab Test Serif', bold: true, italic: true }], align: 'center' }];
    }),
  );
  let zip = await exportPptx('s13b-embed.pptx');
  const pres = await zip.file('ppt/presentation.xml').async('string');
  const typefaces = [...pres.matchAll(/<p:font typeface="([^"]+)"/g)].map((m) => m[1]);
  check('PPTX: embedTrueTypeFonts + embeddedFontLst', pres.includes('embedTrueTypeFonts="1"') && typefaces.includes('Jua') && typefaces.includes('SlideLab Test Serif'), typefaces.join(','));
  const fnt = Object.keys(zip.files).filter((f) => f.endsWith('.fntdata'));
  check('PPTX: 글꼴 파일(fntdata) 3개 (Jua + Serif 보통·굵은 기울임)', fnt.length === 3, fnt.join(','));
  const eot = await zip.file('ppt/fonts/font1.fntdata').async('uint8array');
  const dv = new DataView(eot.buffer, eot.byteOffset);
  check('fntdata = EOT (크기·MagicNumber·버전)', dv.getUint32(0, true) === eot.length && dv.getUint16(34, true) === 0x504c && dv.getUint32(8, true) === 0x00020002);
  check('콘텐츠 형식 등록', (await zip.file('[Content_Types].xml').async('string')).includes('Extension="fntdata"'));
  const warn = await page.locator('.bs-warnings').textContent();
  check('내보내기 결과에 포함 글꼴 안내', warn.includes('파일에 포함했습니다'), warn.slice(0, 120));
  // 설정 끄기
  await page.locator('.bs-export-option input').uncheck();
  check('글꼴 포함 끄기 → 문서 설정', (await S()).embedFonts === false);
  await page.keyboard.press('Escape');
  zip = await exportPptx('s13b-noembed.pptx');
  check('끄면 글꼴을 넣지 않음', !Object.keys(zip.files).some((f) => f.endsWith('.fntdata')) && !(await zip.file('ppt/presentation.xml').async('string')).includes('embeddedFontLst'));
  await page.locator('.bs-export-option input').check();
  await page.keyboard.press('Escape');

  /* ───── PPTX 가져오기: PowerPoint가 넣은 MTX 압축 글꼴 ───── */
  check('Boldonse는 아직 없음', !(await page.evaluate(() => document.fonts.check('16px Boldonse') && [...document.fonts].some((f) => f.family === 'Boldonse'))));
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ backstageOpen: false }));
  const b64 = readFileSync(`${FX}/Boldonse.pptx`).toString('base64');
  await page.evaluate(async (b) => {
    const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'Boldonse.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForFunction(() => window.__SLIDELAB_FONTS__.getState().userFonts.some((f) => f.family === 'Boldonse'), null, { timeout: 15000 });
  const bold = (await fontsState()).userFonts.find((f) => f.family === 'Boldonse');
  check('포함 글꼴 → 내 글꼴 (PPTX 출처)', bold.origin === 'pptx' && bold.size > 70000, `${bold.size}`);
  await page.waitForSelector('.import-report, [data-import-report]', { timeout: 5000 }).catch(() => {});
  const report = await page.locator('body').textContent();
  check('가져오기 보고서에 포함 글꼴', report.includes('포함 글꼴 1개(Boldonse)'));
  const rendered = await page.evaluate(async () => {
    await document.fonts.ready;
    const span = [...document.querySelectorAll('[data-testid="slide-stage"] span')].find((s) => s.textContent.trim());
    return { family: span ? getComputedStyle(span).fontFamily : '', loaded: [...document.fonts].some((f) => f.family === 'Boldonse' && f.status === 'loaded') };
  });
  check('슬라이드가 포함 글꼴로 표시', rendered.family.includes('Boldonse') && rendered.loaded, JSON.stringify(rendered));
  await page.screenshot({ path: `${OUT}/s13b-02-boldonse.png` });

  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/s13b-error.png` }).catch(() => {});
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
