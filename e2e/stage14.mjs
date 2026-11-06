/**
 * 14단계 E2E: 그림·PDF 내보내기, 인쇄 (+ 이후 비디오·수식·메모·맞춤법·비교·3D 단계가 이어서 추가됨)
 *   npm run build && npx vite preview --port 4173 &  →  LANG=C.UTF-8 node e2e/stage14.mjs
 *   (LANG 없이 실행하면 Chromium이 한글 파일 이름을 'download'로 바꿈 — 테스트 환경 문제)
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const JSZip = (await import('jszip')).default;

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:4173/';
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const results = [];
const check = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (part) => !only || only.includes(part);
const FX = 'src/services/fonts/__fixtures__';
const JUA = readFileSync(`${FX}/TestSerif-BoldItalic.ttf`); // 웹 글꼴 응답용 (진짜 Jua 대신 모양이 뚜렷한 테스트 글꼴)

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} @ ${m.location().url}`));
// Google Fonts → 테스트 글꼴 (text= 요청 포함)
await context.route('https://fonts.googleapis.com/**', (route) => {
  const fam = (new URL(route.request().url()).searchParams.get('family') ?? '').split(':')[0];
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: `@font-face { font-family: '${fam}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/t/${encodeURIComponent(fam)}.ttf) format('truetype'); }` });
});
await context.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'font/ttf', 'access-control-allow-origin': '*' }, body: JUA }));

const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc)));
const closeBackstage = () => page.evaluate(() => window.__SLIDELAB__.getState().set({ backstageOpen: false }));
const openExport = async () => {
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ backstageOpen: true, backstagePage: 'export' }));
  await page.waitForSelector('[data-export-pdf]');
};
const download = async (trigger, name) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]);
  const path = `${OUT}/${name ?? dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
};

/** 두 그림(파일 경로)의 평균 픽셀 차이 (0~255) — 브라우저에서 계산 */
async function imageDiff(a, b) {
  const toUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  return page.evaluate(
    async ([u1, u2]) => {
      const load = (u) => new Promise((ok, bad) => Object.assign(new Image(), { onload() { ok(this); }, onerror: bad, src: u }));
      const [i1, i2] = await Promise.all([load(u1), load(u2)]);
      const w = 320, h = Math.round((320 * i1.height) / i1.width);
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const p1 = px(i1), p2 = px(i2);
      let sum = 0;
      for (let i = 0; i < p1.length; i += 4) sum += (Math.abs(p1[i] - p2[i]) + Math.abs(p1[i + 1] - p2[i + 1]) + Math.abs(p1[i + 2] - p2[i + 2])) / 3;
      return { diff: sum / (w * h), size: [i1.width, i1.height, i2.width, i2.height] };
    },
    [toUrl(a), toUrl(b)],
  );
}

try {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="slide-stage"]');
  await page.addStyleTag({ content: '.pwa-prompt { display: none !important; }' });

  // 내 글꼴 추가 (래스터화에 넣어야 하는 글꼴)
  await page.evaluate(() => window.__SLIDELAB__.getState().set({ fontDialog: 'manage' }));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-font-pick]').click()]);
  await fc.setFiles([`${FX}/TestSerif-Regular.ttf`]);
  await page.waitForSelector('[data-family="SlideLab Test Serif"]');
  await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();

  // 문서: 1) 내 글꼴 제목 + 노트, 2) 웹 글꼴 + 그림, 3) 숨긴 슬라이드
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 120;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 200, 0);
    gr.addColorStop(0, '#e63946');
    gr.addColorStop(1, '#1d3557');
    g.fillStyle = gr;
    g.fillRect(0, 0, 200, 120);
    const png = c.toDataURL('image/png');
    window.__SLIDELAB__.getState().commit('준비', (d) => {
      const s1 = d.slides[0];
      const t = s1.objects.find((o) => o.ph?.type === 'ctrTitle');
      t.text.paragraphs = [{ runs: [{ text: 'Print Test 인쇄', fontFamily: 'SlideLab Test Serif', fontSize: 66, color: '#1d3557' }], align: 'center' }];
      const sub = s1.objects.find((o) => o.ph?.type === 'subTitle');
      sub.text.paragraphs = [{ runs: [{ text: 'Subtitle line', fontSize: 28 }], align: 'center' }];
      s1.notes = '첫 슬라이드의 발표자 노트입니다.';
      const clone = (from, id, title) => {
        const s = JSON.parse(JSON.stringify(from));
        s.id = id;
        s.objects.forEach((o, i) => (o.id = `${id}-o${i}`));
        s.objects.find((o) => o.ph?.type === 'ctrTitle').text.paragraphs = [{ runs: [{ text: title, fontFamily: 'Jua', fontSize: 54 }], align: 'center' }];
        s.notes = `${title} 노트`;
        return s;
      };
      const s2 = clone(s1, 'slide-two', 'Web Font Slide');
      d.assets['img-1'] = { id: 'img-1', mime: 'image/png', dataUrl: png };
      s2.objects.push({ id: 'img-obj', type: 'image', name: '그림', assetId: 'img-1', x: 80, y: 60, width: 300, height: 180, rotation: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 }, stroke: null, naturalWidth: 200, naturalHeight: 120 });
      const s3 = clone(s1, 'slide-three', 'Hidden Slide');
      s3.hidden = true;
      d.slides.push(s2, s3);
    });
  });
  await page.waitForFunction(() => document.fonts.check('16px "SlideLab Test Serif"'));

  if (want('image')) {
    /* ───── 그림 내보내기: 브라우저 화면과 픽셀 비교 ───── */
    for (const [idx, label] of [[0, '내 글꼴'], [1, '웹 글꼴+그림']]) {
      await page.evaluate((i) => window.__SLIDELAB__.getState().set({ activeSlideId: window.__SLIDELAB__.getState().doc.slides[i].id, selectedSlideIds: [window.__SLIDELAB__.getState().doc.slides[i].id] }), idx);
      // 기준: 슬라이드 쇼 화면 (1280×720 = 슬라이드 크기 그대로)
      await page.keyboard.press('Shift+F5');
      await page.waitForSelector('.slideshow .show-stage');
      await page.waitForTimeout(800);
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator('.show-stage').first().boundingBox();
      await page.screenshot({ path: `${OUT}/s14-ref-${idx}.png`, clip: box });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
      await openExport();
      await page.locator('[data-export-image] select[aria-label="해상도"]').selectOption('1');
      const { path, name } = await download(() => page.locator('[data-export-image-go]').click(), `s14-img-${idx}.png`);
      const d = await imageDiff(path, `${OUT}/s14-ref-${idx}.png`);
      check(`그림(PNG) = 화면과 같음: ${label}`, d.diff < 6 && d.size[0] === 1280 && d.size[1] === 720, `차이 ${d.diff.toFixed(2)}, ${d.size.join('×')}`);
      check(`그림 파일 이름: ${name}`, name === `제목 없는 프레젠테이션-슬라이드${idx + 1}.png`);
      await closeBackstage();
    }
    // 글꼴을 넣지 않았다면 차이가 커야 함 (검사 자체가 의미 있는지)
    await openExport();
    await page.locator('[data-export-image] select[aria-label="내보낼 슬라이드"]').selectOption('all');
    await page.locator('[data-export-image] select[aria-label="그림 형식"]').selectOption('jpeg');
    await page.locator('[data-export-image] select[aria-label="해상도"]').selectOption('3');
    const zipDl = await download(() => page.locator('[data-export-image-go]').click(), 's14-images.zip');
    const zip = await JSZip.loadAsync(readFileSync(zipDl.path));
    const names = Object.keys(zip.files).filter((n) => !n.endsWith('/'));
    check('모든 슬라이드 → ZIP (슬라이드1.jpg…)', zipDl.name === '제목 없는 프레젠테이션.zip' && names.length === 3 && names.every((n, i) => n.endsWith(`/슬라이드${i + 1}.jpg`)), names.join(','));
    const jpg = await zip.file(names[0]).async('uint8array');
    check('JPEG 3배 해상도', jpg[0] === 0xff && jpg[1] === 0xd8 && execFileSync('python3', ['-c', `import sys,struct;b=open(sys.argv[1],'rb').read();i=2\nwhile True:\n m=b[i+1];l=struct.unpack('>H',b[i+2:i+4])[0]\n if 0xc0<=m<=0xc3: print(struct.unpack('>HH',b[i+5:i+9]));break\n i+=2+l`, (writeFileSync(`${OUT}/s14-1.jpg`, jpg), `${OUT}/s14-1.jpg`)], { encoding: 'utf8' }).includes('(2160, 3840)'));
    await closeBackstage();
  }

  if (want('pdf')) {
    /* ───── PDF (그림 PDF) ───── */
    await openExport();
    const pdf = await download(() => page.locator('[data-export-pdf-go]').click(), 's14-export.pdf');
    const info = execFileSync('pdfinfo', [pdf.path], { encoding: 'utf8' });
    check('PDF: 숨긴 슬라이드 제외 2쪽, 960×540pt', /Pages:\s+2\n/.test(info) && /Page size:\s+960 x 540 pts/.test(info), info.match(/Pages:.*|Page size:.*/g)?.join(' / '));
    const imgs = execFileSync('pdfimages', ['-list', pdf.path], { encoding: 'utf8' });
    check('PDF: 쪽마다 1920×1080 JPEG', (imgs.match(/\s1920\s+1080\s+rgb\s+3\s+8\s+jpeg/g) ?? []).length === 2, imgs.split('\n').slice(2, 4).join(' | '));
    execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', pdf.path, `${OUT}/s14-pdfpage`]);
    const d = await imageDiff(`${OUT}/s14-pdfpage-1.png`, `${OUT}/s14-ref-0.png`);
    check('PDF 1쪽(poppler로 그림) = 화면', d.diff < 7, d.diff.toFixed(2));
    await page.locator('[data-export-pdf] .fm-check input').check();
    const pdf2 = await download(() => page.locator('[data-export-pdf-go]').click(), 's14-export-hidden.pdf');
    check('PDF: 숨긴 슬라이드 포함 → 3쪽', /Pages:\s+3\n/.test(execFileSync('pdfinfo', [pdf2.path], { encoding: 'utf8' })));
    await closeBackstage();
  }

  if (want('print')) {
    /* ───── 인쇄 (벡터 PDF: 브라우저 인쇄) ───── */
    await page.locator('[data-testid="slide-stage"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+p');
    await page.waitForSelector('[data-print-preview]');
    check('Ctrl+P → 인쇄 화면', (await page.locator('.bs-nav-item.is-active').textContent()).includes('인쇄'));
    check('전체 페이지 슬라이드: 3쪽 (숨긴 슬라이드 인쇄 기본 켬)', (await page.locator('[data-print-pages]').textContent()).trim() === '1 / 3');
    await page.locator('[data-print-layout]').selectOption('handout6');
    check('유인물 6슬라이드: 1쪽', (await page.locator('[data-print-pages]').textContent()).trim() === '1 / 1');
    check('유인물 미리 보기에 슬라이드 3장', (await page.locator('[data-print-preview] .pv-slide').count()) === 3);
    await page.locator('[data-print-range]').selectOption('custom');
    await page.locator('[data-print-custom]').fill('2-9');
    check('잘못된 범위 → 오류 표시, 인쇄 막음', (await page.locator('.error-text').count()) === 1 && (await page.locator('[data-print-go]').isDisabled()));
    await page.locator('[data-print-custom]').fill('1-2');
    await page.screenshot({ path: `${OUT}/s14-print.png` });

    const printTo = async (layout, file) => {
      await page.locator('[data-print-layout]').selectOption(layout);
      await page.evaluate(() => (window.print = () => (window.__printed = (window.__printed ?? 0) + 1)));
      await page.locator('[data-print-go]').click();
      await page.waitForFunction(() => window.__printed > 0 && document.querySelectorAll('#sl-print-root [data-print-page]').length > 0);
      await page.evaluate(() => (window.__printed = 0));
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: `${OUT}/${file}`, preferCSSPageSize: true, printBackground: true });
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.waitForFunction(() => !document.querySelector('#sl-print-root'));
      return { info: execFileSync('pdfinfo', [`${OUT}/${file}`], { encoding: 'utf8' }), text: execFileSync('pdftotext', ['-layout', `${OUT}/${file}`, '-'], { encoding: 'utf8' }), fonts: execFileSync('pdffonts', [`${OUT}/${file}`], { encoding: 'utf8' }) };
    };
    let r = await printTo('slides', 's14-print-slides.pdf');
    check('인쇄(슬라이드, 범위 1-2): 2쪽, 슬라이드 크기', /Pages:\s+2\n/.test(r.info) && /Page size:\s+960 x 540 pts/.test(r.info), r.info.match(/Pages:.*|Page size:.*/g)?.join(' / '));
    check('인쇄 PDF: 글자가 벡터(선택·검색 가능)', r.text.includes('Print Test') && r.text.includes('Web Font Slide'), r.text.replace(/\s+/g, ' ').slice(0, 80));
    // 웹 글꼴(Jua) 요청에는 테스트 글꼴 BoldItalic 파일로 응답하므로 PDF 안 이름은 SlideLabTestSerifBoldItalic
    check('인쇄 PDF: 내 글꼴·웹 글꼴이 포함됨', r.fonts.includes('SlideLabTestSerifRegular') && r.fonts.includes('SlideLabTestSerifBoldItalic'), r.fonts.split('\n').slice(2).map((l) => l.split(/\s+/)[0]).join(','));
    r = await printTo('notes', 's14-print-notes.pdf');
    check('인쇄(노트): A4 2쪽 + 노트 글자', /Pages:\s+2\n/.test(r.info) && /Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)/.test(r.info) && r.text.includes('첫 슬라이드의 발표자 노트입니다'), r.info.match(/Page size:.*/)?.[0]);
    r = await printTo('outline', 's14-print-outline.pdf');
    check('인쇄(개요): 제목·본문 글자', r.text.includes('1. Print Test') && r.text.includes('Subtitle line'), r.text.replace(/\s+/g, ' ').slice(0, 80));
    await closeBackstage();
  }

  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('스크립트 실행', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/s14-error.png` }).catch(() => {});
}
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
