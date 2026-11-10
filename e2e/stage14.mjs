/**
 * 14단계 E2E: 그림·PDF 내보내기, 인쇄 (+ 이후 비디오·수식·메모·맞춤법·비교·3D 단계가 이어서 추가됨)
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage14.mjs
 *   (Chromium은 UTF-8 로캘이 아니면 한글 내려받기 파일 이름을 'download'로 바꾸므로 브라우저 환경에 LANG=C.UTF-8을 줌)
 */
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
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

const utf8 = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '');
const browser = await chromium.launch({ env: { ...process.env, ...(utf8 ? {} : { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) } });
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
async function imageDiff(a, b, crop = null) {
  const toUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  return page.evaluate(
    async ([u1, u2, crop]) => {
      const load = (u) => new Promise((ok, bad) => Object.assign(new Image(), { onload() { ok(this); }, onerror: bad, src: u }));
      const [i1, i2] = await Promise.all([load(u1), load(u2)]);
      const w = 320, h = Math.round((320 * i1.height) / i1.width);
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        if (crop) {
          const k = img.width / 1280; // 슬라이드 px → 그림 px
          g.drawImage(img, crop.x * k, crop.y * k, crop.w * k, crop.h * k, 0, 0, w, h);
        } else g.drawImage(img, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const p1 = px(i1), p2 = px(i2);
      let sum = 0;
      for (let i = 0; i < p1.length; i += 4) sum += (Math.abs(p1[i] - p2[i]) + Math.abs(p1[i + 1] - p2[i + 1]) + Math.abs(p1[i + 2] - p2[i + 2])) / 3;
      return { diff: sum / (w * h), size: [i1.width, i1.height, i2.width, i2.height] };
    },
    [toUrl(a), toUrl(b), crop],
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
    // 보이지 않는 글자 층: 글자 추출 + 위치가 편집기 화면의 글자 상자와 같음
    const ptext = execFileSync('pdftotext', ['-f', '1', '-l', '1', pdf.path, '-'], { encoding: 'utf8' });
    const bbox = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', pdf.path, '-'], { encoding: 'utf8' });
    const word = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">인쇄<\/word>/g)][0];
    // 편집 화면에 1번 슬라이드를 띄우고 잼 (앞 단계가 다른 슬라이드를 골랐을 수 있음)
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id] });
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.canvas-scroller .sl-slide')].some((e) => e.textContent.includes('Print Test 인쇄')));
    const domBox = await page.evaluate(() => {
      const w = document.createTreeWalker(document.querySelector('.canvas-scroller'), NodeFilter.SHOW_TEXT);
      let n = null;
      while (w.nextNode()) if (w.currentNode.data.includes('인쇄')) { n = w.currentNode; break; }
      const el = n?.parentElement;
      if (!n) return null;
      const r = document.createRange();
      r.setStart(n, n.data.indexOf('인쇄'));
      r.setEnd(n, n.data.length);
      const b = r.getBoundingClientRect(), slide = el.closest('.sl-slide');
      const s = slide.getBoundingClientRect();
      const k = 960 / s.width;
      return { x0: (b.left - s.left) * k, x1: (b.right - s.left) * k, y0: (b.top - s.top) * k, y1: (b.bottom - s.top) * k };
    });
    const near = word && domBox && Math.abs(+word[1] - domBox.x0) < 4 && Math.abs(+word[3] - domBox.x1) < 4 && Math.abs(+word[2] - domBox.y0) < 6 && Math.abs(+word[4] - domBox.y1) < 6;
    check('PDF 글자 층: 글자 추출(선택·검색) + 위치 = 화면 글자 상자(pt)', ptext.includes('Print Test 인쇄') && ptext.includes('Subtitle line') && near, `${JSON.stringify(ptext.trim())} pdf=${word?.slice(1, 5).map((v) => (+v).toFixed(0))} dom=${domBox && Object.values(domBox).map((v) => v.toFixed(0))}`);
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

  if (want('video')) {
    /* ───── 비디오 만들기 ───── */
    // 1: 부제목에 클릭 나타내기 + 기록된 시간 3초, 2: 밀어내기 전환 1초 + 내레이션 2.5초(440Hz), 3: 숨김
    await page.evaluate(() => {
      const sr = 48000, n = Math.round(sr * 2.5);
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000), true);
      let bin = '';
      new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
      const wav = `data:audio/wav;base64,${btoa(bin)}`;
      window.__SLIDELAB__.getState().commit('비디오 준비', (d) => {
        const [s1, s2] = d.slides;
        const sub = s1.objects.find((o) => o.ph?.type === 'subTitle');
        s1.animations = [{ id: 'an1', targetId: sub.id, effect: 'fade', category: 'entrance', start: 'onClick', delay: 0, duration: 500, repeat: 1 }];
        s1.transition = { type: 'none', duration: 0, advanceAfter: 3000 };
        s2.transition = { type: 'push', duration: 1000, direction: 'left' };
        d.assets['narr'] = { id: 'narr', mime: 'audio/wav', dataUrl: wav, name: 'narration.wav' };
        s2.objects.push({ id: 'narr-obj', type: 'media', name: '내레이션', kind: 'audio', assetId: 'narr', x: 1200, y: 640, width: 48, height: 48, rotation: 0, autoPlay: true, hideInShow: true, narration: true });
      });
    });
    await openExport();
    await page.locator('[data-video-seconds]').fill('2');
    await page.locator('select[aria-label="비디오 형식"]').selectOption('webm');
    await page.locator('select[aria-label="비디오 품질"]').selectOption('720');
    const t0 = Date.now();
    const webm = await download(() => page.locator('[data-export-video-go]').click(), 's14-video.webm');
    const took = (Date.now() - t0) / 1000;
    check('비디오 파일 이름', webm.name === '제목 없는 프레젠테이션.webm', webm.name);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', webm.path], { encoding: 'utf8' }));
    const vs = probe.streams.find((x) => x.codec_type === 'video');
    const as = probe.streams.find((x) => x.codec_type === 'audio');
    const dur = Number(probe.format.duration);
    check('WebM: VP9 1280×720 + Opus 소리', vs?.codec_name === 'vp9' && vs.width === 1280 && vs.height === 720 && as?.codec_name === 'opus', `${vs?.codec_name} ${vs?.width}×${vs?.height} ${as?.codec_name}`);
    check('길이 = 3초(기록) + 1초(전환) + 2.5초(내레이션이 2초보다 김)', Math.abs(dur - 6.5) < 0.15, `${dur}s, 만드는 데 ${took.toFixed(1)}초`);
    const frameAt = (t, name) => (execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', webm.path, '-frames:v', '1', `${OUT}/${name}`]), `${OUT}/${name}`);
    const before = await imageDiff(frameAt(0.3, 's14-v-0.3.png'), `${OUT}/s14-img-0.png`);
    const after = await imageDiff(frameAt(2.8, 's14-v-2.8.png'), `${OUT}/s14-img-0.png`);
    check('애니메이션: 클릭 전에는 부제목이 없고, 재생 뒤에는 그림 내보내기와 같음', before.diff > after.diff + 0.3 && after.diff < 6, `전 ${before.diff.toFixed(2)} / 후 ${after.diff.toFixed(2)}`);
    const mid = await imageDiff(frameAt(3.5, 's14-v-3.5.png'), `${OUT}/s14-img-1.png`);
    const hold = await imageDiff(frameAt(5.5, 's14-v-5.5.png'), `${OUT}/s14-img-1.png`);
    check('전환(밀어내기) 중간 프레임은 다르고, 다음 슬라이드 표시 중에는 같음', mid.diff > 15 && hold.diff < 6, `전환 ${mid.diff.toFixed(2)} / 표시 ${hold.diff.toFixed(2)}`);
    const volOf = (ss, t) => {
      const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', webm.path, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
      return Number(r.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/)?.[1] ?? -99);
    };
    const quiet = volOf(0.2, 2.5), loud = volOf(4.3, 2.0);
    check('내레이션은 2번 슬라이드(4초~)에서만 들림', quiet < -60 && loud > -30, `1번 ${quiet}dB / 2번 ${loud}dB`);
    // MP4
    await page.locator('select[aria-label="비디오 형식"]').selectOption('mp4');
    await page.locator('select[aria-label="비디오 품질"]').selectOption('480');
    await page.locator('[data-video-recorded]').uncheck();
    const mp4 = await download(() => page.locator('[data-export-video-go]').click(), 's14-video.mp4');
    const p2 = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4.path], { encoding: 'utf8' }));
    const v2 = p2.streams.find((x) => x.codec_type === 'video');
    check('MP4: 854×480, 기록 무시 → 2초 + 1초 + 2초', p2.format.format_name.includes('mp4') && v2.width === 854 && v2.height === 480 && Math.abs(Number(p2.format.duration) - 5) < 0.15 && !p2.streams.some((x) => x.codec_type === 'audio'), `${p2.format.format_name} ${v2.codec_name} ${v2.width}×${v2.height} ${p2.format.duration}s`);
    check('결과 안내', (await page.locator('[data-video-result]').textContent()).includes('854×480'));
    // 자동 재생 동영상 개체: 빨강(0–1초)·초록(1–2초)·파랑(2–3초) + 660Hz 소리, 위에 검은 사각형이 일부를 가림
    const webmB64 = readFileSync('e2e/fixtures/rgb-3s.webm').toString('base64');
    const hiddenBefore = await page.evaluate((b64) => {
      const st = window.__SLIDELAB__.getState();
      const hidden = st.doc.slides.map((s) => !!s.hidden);
      st.commit('동영상 개체', (d) => {
        d.assets['vid'] = { id: 'vid', mime: 'video/webm', dataUrl: `data:video/webm;base64,${b64}`, name: 'rgb.webm' };
        d.slides.forEach((s, i) => (s.hidden = i > 0));
        d.slides[0].objects.push({ id: 'vid-obj', type: 'media', kind: 'video', name: '동영상', assetId: 'vid', x: 640, y: 360, width: 480, height: 270, rotation: 0, autoPlay: true });
        d.slides[0].objects.push({ id: 'vid-cover', type: 'shape', name: '가림', shape: 'rect', x: 600, y: 320, width: 120, height: 120, rotation: 0, fill: { type: 'solid', color: '#000000' }, stroke: null, text: { paragraphs: [{ runs: [{ text: '' }] }], vAlign: 'middle', direction: 'horizontal', padding: { top: 4, right: 8, bottom: 4, left: 8 }, autoFit: 'none' } });
      });
      return hidden;
    }, webmB64);
    await openExport();
    await page.locator('[data-video-seconds]').fill('4');
    await page.locator('select[aria-label="비디오 형식"]').selectOption('webm');
    await page.locator('select[aria-label="비디오 품질"]').selectOption('720');
    const vo = await download(() => page.locator('[data-export-video-go]').click(), 's14-video-obj.webm');
    const px = (t, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', vo.path, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    const name = ([r, g, b]) => (r > 180 && g < 80 && b < 80 ? 'R' : g > 180 && r < 80 && b < 80 ? 'G' : b > 180 && r < 80 && g < 80 ? 'B' : r < 40 && g < 40 && b < 40 ? 'K' : `(${r},${g},${b})`);
    const seq = [0.5, 1.5, 2.5, 3.6].map((t) => name(px(t, 900, 500))).join('');
    const cover = [0.5, 1.5, 2.5].map((t) => name(px(t, 690, 410))).join('');
    check('비디오: 동영상 개체 재생 (빨강→초록→파랑, 끝나면 마지막 프레임)', seq === 'RGBB', seq);
    check('비디오: 동영상 위 개체는 동영상 위에 그대로 (층 합성)', cover === 'KKK', cover);
    {
      const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', '0.2', '-t', '2.6', '-i', vo.path, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
      const vol = Number(r.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/)?.[1] ?? -99);
      check('비디오: 동영상 소리도 섞임', vol > -30, `${vol}dB`);
    }
    await page.evaluate((hidden) => {
      window.__SLIDELAB__.getState().commit('동영상 개체 제거', (d) => {
        d.slides.forEach((s, i) => (s.hidden = hidden[i]));
        d.slides[0].objects = d.slides[0].objects.filter((o) => o.id !== 'vid-obj' && o.id !== 'vid-cover');
        delete d.assets['vid'];
      });
    }, hiddenBefore);
    await closeBackstage();
  }

  if (want('equation')) {
    /* ───── 수식 ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      // 앞 단계(비디오)의 나타내기 애니메이션은 쇼 화면 비교에 방해 → 제거
      st.commit('애니메이션 제거', (d) => void (d.slides[0].animations = []));
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id] });
    });
    await page.locator('.tab', { hasText: '삽입' }).click();
    await page.locator('.rb', { hasText: '수식' }).click();
    await page.waitForSelector('[data-eq-preview] math');
    await page.locator('[data-eq-gallery]').selectOption({ label: '근의 공식' });
    await page.waitForFunction(() => !!document.querySelector('[data-eq-preview] math mfrac msqrt'));
    check('수식 창: 갤러리 → 미리 보기(MathML)', true);
    await page.locator('[data-eq-latex]').fill('\\frac{a}{');
    await page.waitForSelector('[data-eq-error]');
    check('잘못된 LaTeX → 오류 표시', (await page.locator('[data-eq-error]').textContent()).length > 5);
    await page.locator('[data-eq-latex]').fill('E=mc^{2}+\\sum_{i=1}^{n} \\frac{a_i}{\\sqrt{b}}');
    await page.locator('[data-eq-size]').fill('36');
    await page.waitForFunction(() => !!document.querySelector('[data-eq-preview] math munderover'));
    await page.locator('.dialog .btn.primary', { hasText: '확인' }).click();
    const eqObj = () => page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.type === 'equation'));
    let eq = await eqObj();
    check('수식 삽입 (LaTeX·MathML·크기 36pt, 내용에 맞춘 상자)', eq && eq.latex.startsWith('E=mc^{2}') && eq.mathml.includes('<munderover>') && eq.fontSize === 36 && eq.width > 150 && eq.height > 40, eq && `${Math.round(eq.width)}×${Math.round(eq.height)}`);
    await page.waitForFunction((id) => !!document.querySelector(`[data-testid="slide-stage"] [data-obj-id="${id}"] math`), eq.id);
    check('편집 화면에 수식 표시 + 수식 글꼴(STIX Two Math)', await page.evaluate(() => document.fonts.check('20px "STIX Two Math"') && [...document.fonts].some((f) => f.family === 'STIX Two Math' && f.status === 'loaded')));
    // 더블클릭 → 편집
    const box = await page.locator(`[data-testid="slide-stage"] [data-obj-id="${eq.id}"]`).boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('[data-equation-dialog]');
    check('더블클릭 → 수식 편집 (기존 LaTeX)', (await page.locator('[data-eq-latex]').inputValue()).startsWith('E=mc^{2}'));
    await page.locator('[data-eq-latex]').fill('E=mc^{2}');
    await page.locator('[data-eq-latex]').press('Control+Enter');
    eq = await eqObj();
    check('Ctrl+Enter로 편집 적용', eq.latex === 'E=mc^{2}' && !eq.mathml.includes('munderover'));
    await page.keyboard.press('Control+z');
    eq = await eqObj();
    check('실행 취소 → 이전 수식', eq.latex.startsWith('E=mc^{2}+\\sum'));
    await page.screenshot({ path: `${OUT}/s14-equation.png` });
    // 그림 내보내기 = 화면 (MathML도 그림으로)
    await page.keyboard.press('Shift+F5');
    await page.waitForSelector('.slideshow .show-stage');
    await page.waitForTimeout(800);
    const sbox = await page.locator('.show-stage').first().boundingBox();
    await page.screenshot({ path: `${OUT}/s14-ref-eq.png`, clip: sbox });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
    await openExport();
    await page.locator('[data-export-image] select[aria-label="내보낼 슬라이드"]').selectOption('current');
    await page.locator('[data-export-image] select[aria-label="그림 형식"]').selectOption('png');
    await page.locator('[data-export-image] select[aria-label="해상도"]').selectOption('1');
    const eqPng = await download(() => page.locator('[data-export-image-go]').click(), 's14-img-eq.png');
    // 수식 영역만 비교: 화면과는 같고, 수식이 없는 같은 슬라이드 그림과는 달라야 함
    const crop = { x: eq.x, y: eq.y, w: eq.width, h: eq.height };
    const d = await imageDiff(eqPng.path, `${OUT}/s14-ref-eq.png`, crop);
    const without = await imageDiff(eqPng.path, `${OUT}/s14-img-0.png`, crop);
    check('그림 내보내기에 수식이 화면과 같게 그려짐', d.diff < 8 && without.diff > d.diff * 3, `화면과 ${d.diff.toFixed(2)} / 수식 없는 그림과 ${without.diff.toFixed(2)}`);
    // PPTX: a14:m + 대체 그림
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dl.saveAs(`${OUT}/s14-equation.pptx`);
    const z = await JSZip.loadAsync(readFileSync(`${OUT}/s14-equation.pptx`));
    const sx = await z.file('ppt/slides/slide1.xml').async('string');
    check('PPTX: a14:m(OMML) + 대체 그림', /<a14:m><m:oMathPara[\s\S]*<m:nary>[\s\S]*<m:f>[\s\S]*<m:rad>/.test(sx) && /<mc:Fallback><p:sp>[\s\S]*<a:blip r:embed=/.test(sx));
    const media = Object.keys(z.files).find((n) => /ppt\/media\/slGen\d+\.png$/.test(n));
    const pngBytes = await z.file(media).async('nodebuffer');
    writeFileSync(`${OUT}/s14-eq-fallback.png`, pngBytes);
    const alpha = await page.evaluate(async (b64) => {
      const img = await new Promise((ok) => Object.assign(new Image(), { onload() { ok(this); }, src: `data:image/png;base64,${b64}` }));
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let ink = 0, clear = 0;
      for (let i = 3; i < px.length; i += 4) px[i] > 128 ? ink++ : px[i] === 0 && clear++;
      return { w: img.width, h: img.height, ink, clear };
    }, pngBytes.toString('base64'));
    check('대체 그림: 2배 해상도, 투명 배경 위 수식', alpha.w >= eq.width * 2 - 2 && alpha.ink > 300 && alpha.clear > alpha.ink, JSON.stringify(alpha));
    await closeBackstage();
    // 문단 안 수식: 텍스트 편집 중 커서 자리에 넣기 → 화면·모델·PPTX, 두 번 클릭으로 고치기
    const subId = await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      const sub = st.doc.slides[0].objects.find((o) => o.ph?.type === 'subTitle');
      st.commit('문단 안 수식 준비', (d) => (d.slides[0].objects.find((o) => o.id === sub.id).text.paragraphs = [{ runs: [{ text: '원의 넓이는 ', fontSize: 28 }] }]));
      st.setEditingText(sub.id);
      return sub.id;
    });
    await page.waitForSelector('.sl-editing');
    // 커서를 글 끝에
    await page.evaluate(() => {
      const ed = document.querySelector('.sl-editing');
      ed.focus();
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let t = null;
      while (w.nextNode()) t = w.currentNode;
      const r = document.createRange();
      r.setStart(t, t.data.length);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.locator('.tab', { hasText: '삽입' }).click();
    await page.locator('.rb', { hasText: '수식' }).click();
    await page.waitForSelector('[data-eq-inline]');
    await page.locator('[data-eq-latex]').fill('A=\\pi r^{2}');
    await page.locator('.dialog .btn.primary').click();
    await page.waitForSelector('.sl-editing .sl-math-inline math msup');
    await page.keyboard.type(' 입니다.');
    await page.keyboard.press('Escape');
    const runs = await page.evaluate((id) => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === id).text.paragraphs[0].runs, subId);
    const joined = runs.map((r) => (r.math ? `$${r.math.latex}$` : r.text)).join('');
    check('문단 안 수식: 커서 자리에 넣고 이어서 입력', joined === '원의 넓이는 $A=\\pi r^{2}$ 입니다.' && runs.find((r) => r.math)?.fontSize === 28, joined);
    const inl = await page.evaluate((id) => {
      const m = document.querySelector(`.canvas-scroller [data-obj-id="${id}"] .sl-math-inline`);
      const t = [...document.querySelectorAll(`.canvas-scroller [data-obj-id="${id}"] .sl-p span`)].find((x) => x.textContent.includes('원의 넓이는'));
      if (!m || !t) return null;
      const a = m.getBoundingClientRect(), b = t.getBoundingClientRect();
      return { sameLine: a.top < b.bottom && a.bottom > b.top, after: a.left >= b.right - 1, font: getComputedStyle(m.querySelector("math")).fontFamily };
    }, subId);
    await page.locator(`.canvas-scroller [data-obj-id="${subId}"]`).screenshot({ path: `${OUT}/s14-inline-math.png` });
    check('문단 안 수식: 글줄 안에 그려짐 (같은 줄, 글자 뒤, 수식 글꼴)', inl?.sameLine && inl.after && inl.font.includes('STIX Two Math'), JSON.stringify(inl));
    await page.evaluate((id) => window.__SLIDELAB__.getState().setEditingText(id), subId);
    await page.waitForSelector('.sl-editing .sl-math-inline');
    await page.locator('.sl-editing .sl-math-inline').dblclick();
    await page.waitForSelector('[data-eq-inline]');
    check('두 번 클릭 → 문단 안 수식 편집 (원래 LaTeX)', (await page.locator('[data-eq-latex]').inputValue()) === 'A=\\pi r^{2}');
    await page.locator('[data-eq-latex]').fill('A=\\pi r^{2}+1');
    await page.locator('.dialog .btn.primary').click();
    await page.waitForFunction(() => document.querySelector('.sl-editing .sl-math-inline math')?.textContent.includes('1'));
    await page.keyboard.press('Escape');
    const runs2 = await page.evaluate((id) => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === id).text.paragraphs[0].runs, subId);
    const joined2 = runs2.map((r) => (r.math ? `$${r.math.latex}$` : r.text)).join('');
    check('고친 수식 반영, 앞뒤 글자 그대로', joined2 === '원의 넓이는 $A=\\pi r^{2}+1$ 입니다.', joined2);
    await openExport();
    const [dlI] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dlI.saveAs(`${OUT}/s14-inline-math.pptx`);
    const sxI = await (await JSZip.loadAsync(readFileSync(`${OUT}/s14-inline-math.pptx`))).file('ppt/slides/slide1.xml').async('string');
    check('PPTX: 문단 안 a14:m (글자 런 사이) + 대체 글자', /<a:t>원의 넓이는 <\/a:t><\/a:r><a14:m><m:oMath [^>]*>[\s\S]*<m:sSup>[\s\S]*?<\/a14:m><a:r>[\s\S]*?<a:t> 입니다.<\/a:t>/.test(sxI) && /<mc:Fallback><p:sp>[\s\S]*<a:t>A=\\pi r\^\{2\}\+1<\/a:t>/.test(sxI) && !sxI.includes('[[SLM:'));
    await closeBackstage();
  }

  if (want('comments')) {
    /* ───── 메모 ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: [] });
    });
    await page.locator('.tab', { hasText: '검토' }).click();
    await page.locator('.rb', { hasText: '새 메모' }).click();
    await page.waitForSelector('[data-cm-username]');
    await page.locator('[data-cm-username]').fill('김민지');
    await page.keyboard.press('Enter');
    await page.locator('[data-cm-new]').click();
    await page.locator('[data-cm-input]').fill('제목 색을 바꿔 주세요');
    await page.locator('[data-cm-input]').press('Control+Enter');
    const comments = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc.slides.map((s) => s.comments ?? []))));
    let cm = await comments();
    check('새 메모: 이름·이니셜·내용·위치', cm[0].length === 1 && cm[0][0].author === '김민지' && cm[0][0].initials === '김민' && cm[0][0].text === '제목 색을 바꿔 주세요' && cm[0][0].x === 10, JSON.stringify(cm[0][0]).slice(0, 120));
    check('슬라이드에 메모 표시(말풍선)', (await page.locator('[data-cm-marker]').count()) === 1 && (await page.locator('[data-cm-marker]').textContent()) === '김민');
    // 개체에 단 메모
    const titleId = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects[0].id);
    await page.evaluate((id) => window.__SLIDELAB__.getState().select([id]), titleId);
    await page.locator('[data-cm-new]').click();
    await page.locator('[data-cm-input]').fill('이 개체 위치 확인');
    await page.locator('[data-cm-post]').click();
    cm = await comments();
    const t = await page.evaluate((id) => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === id), titleId);
    check('선택한 개체에 연결된 메모 (개체 오른쪽 위)', cm[0][1].objectId === titleId && Math.round(cm[0][1].x) === Math.round(t.x + t.width) && Math.round(cm[0][1].y) === Math.round(t.y));
    // 답글·해결·다시 열기
    const card = page.locator(`[data-cm-id="${cm[0][0].id}"]`);
    await card.click();
    await card.locator('[data-cm-reply]').fill('네, 남색으로 바꿀게요');
    await card.locator('[data-cm-reply-send]').click();
    await card.locator('[data-cm-resolve]').click();
    cm = await comments();
    check('답글 + 해결', cm[0][0].replies.length === 1 && cm[0][0].replies[0].text === '네, 남색으로 바꿀게요' && cm[0][0].resolved === true);
    await card.locator('[data-cm-reopen]').click();
    check('다시 열기', (await comments())[0][0].resolved === false);
    await page.keyboard.press('Control+z');
    check('실행 취소 (다시 열기 취소 → 해결됨)', (await comments())[0][0].resolved === true);
    // 다른 슬라이드 메모 + 이전/다음
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.commit('메모', (d) => (d.slides[1].comments = [{ id: 'c-s2', author: 'Alex', initials: 'AK', text: '두 번째 슬라이드', created: new Date().toISOString(), x: 300, y: 200, replies: [] }]));
      st.set({ activeCommentId: st.doc.slides[0].comments[1].id });
    });
    await page.locator('.rb', { hasText: '다음' }).click();
    const st1 = await page.evaluate(() => ({ slide: window.__SLIDELAB__.getState().doc.slides.findIndex((s) => s.id === window.__SLIDELAB__.getState().activeSlideId), c: window.__SLIDELAB__.getState().activeCommentId }));
    check('다음 메모 → 다음 슬라이드로 이동', st1.slide === 1 && st1.c === 'c-s2', JSON.stringify(st1));
    await page.screenshot({ path: `${OUT}/s14-comments.png` });
    // PPTX에 메모
    await openExport();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dl.saveAs(`${OUT}/s14-comments.pptx`);
    const z = await JSZip.loadAsync(readFileSync(`${OUT}/s14-comments.pptx`));
    const m1 = await z.file('ppt/comments/modernComment_100_0.xml')?.async('string');
    check('PPTX(자동 → 해결한 메모가 있어 최신 메모): 해결 상태 + 답글 + 작성자', !!m1 && (m1.match(/<p188:cm /g) ?? []).length === 2 && (m1.match(/status="resolved"/g) ?? []).length === 1 && m1.includes('<p188:reply ') && (await z.file('ppt/authors.xml').async('string')).includes('name="김민지"') && !z.file('ppt/commentAuthors.xml'));
    await page.locator('[data-comment-format]').selectOption('legacy');
    const [dlL] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dlL.saveAs(`${OUT}/s14-comments-legacy.pptx`);
    const zL = await JSZip.loadAsync(readFileSync(`${OUT}/s14-comments-legacy.pptx`));
    const c1 = await zL.file('ppt/comments/comment1.xml')?.async('string');
    check('PPTX(기존 메모 선택): 메모 3개(답글 포함) + 작성자', !!c1 && (c1.match(/<p:cm /g) ?? []).length === 3 && c1.includes('p15:parentCm') && (await zL.file('ppt/commentAuthors.xml').async('string')).includes('name="김민지"') && !!zL.file('ppt/comments/comment2.xml'));
    await page.locator('[data-comment-format]').selectOption('auto');
    await closeBackstage();
    // 모든 메모 삭제
    await page.locator('.tab', { hasText: '검토' }).click();
    await page.locator('.rb', { hasText: '삭제' }).click();
    await page.locator('.menu-item', { hasText: '프레젠테이션의 모든 메모' }).click();
    check('모든 메모 삭제', (await comments()).every((c) => c.length === 0) && (await page.locator('[data-cm-marker]').count()) === 0);
  }

  if (want('spell')) {
    /* ───── 맞춤법 검사 ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.commit('맞춤법 준비', (d) => {
        const [s1, s2] = d.slides;
        s1.objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs = [{ runs: [{ text: 'This presentaion is is good' }] }];
        s2.objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs = [{ runs: [{ text: '누구나 할수있다. 몇일 뒤 발표' }] }];
        d.slides[2].hidden = false;
        d.slides[2].objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs = [{ runs: [{ text: 'presentaion again' }] }];
        d.slides.forEach((s) => (s.notes = ''));
      });
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: [] });
    });
    await page.locator('[data-testid="slide-stage"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F7');
    await page.waitForSelector('[data-spell-word]', { timeout: 30000 });
    const word = () => page.locator('[data-spell-word]').textContent();
    check('F7 → 맞춤법 검사 (사전 받기 → 첫 오류)', (await word()) === 'presentaion');
    const sugs = await page.locator('[data-spell-suggestions] button').allTextContents();
    check('영어 추천 단어 (Hunspell)', sugs[0] === 'presentation', sugs.slice(0, 3).join(','));
    const sel = await page.evaluate(() => window.__SLIDELAB__.getState().selectedIds);
    check('오류가 있는 개체 선택', sel.length === 1);
    await page.locator('[data-spell-change-all]').click();
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === 'is is');
    let texts = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.map((s) => s.objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0].runs.map((r) => r.text).join('')));
    check('모두 변경: 모든 슬라이드의 같은 단어', texts[0].startsWith('This presentation') && texts[2] === 'presentation again', texts.join(' | '));
    check('반복된 단어 → 추천은 한 번', (await page.locator('[data-spell-suggestions] button').first().textContent()) === 'is');
    await page.locator('[data-spell-change]').click();
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === '할수있');
    check('한국어 규칙(띄어쓰기) + 설명', (await page.locator('.spell-why').textContent()).includes('의존 명사'));
    check('한국어 오류의 슬라이드로 이동', await page.evaluate(() => window.__SLIDELAB__.getState().activeSlideId === window.__SLIDELAB__.getState().doc.slides[1].id));
    await page.locator('[data-spell-change]').click();
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === '몇일');
    await page.locator('[data-spell-ignore]').click();
    await page.waitForSelector('[data-spell-done]');
    texts = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.map((s) => s.objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0].runs.map((r) => r.text).join('')));
    check('완료: 고친 글자·무시한 글자', texts[0] === 'This presentation is good' && texts[1] === '누구나 할 수 있다. 몇일 뒤 발표' && (await page.locator('[data-spell-done]').textContent()).includes('곳을 고쳤습니다'), texts.join(' | '));
    await page.keyboard.press('Control+z');
    texts = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.map((s) => s.objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0].runs.map((r) => r.text).join('')));
    check('실행 취소 → 고치기 전', texts[1] === '누구나 할수있다. 몇일 뒤 발표');
    await page.screenshot({ path: `${OUT}/s14-spell.png` });
    await page.locator('[data-spell-pane] .pp-head .icon-btn').click();
    // 입력할 때 맞춤법 검사: 편집 영역 spellcheck
    await page.evaluate(() => window.__SLIDELAB__.getState().setEditingText(window.__SLIDELAB__.getState().doc.slides[1].objects.find((o) => o.ph?.type === 'subTitle').id));
    await page.waitForSelector('.sl-editing');
    check('입력할 때 맞춤법 검사(브라우저) 켜짐', (await page.locator('.sl-editing').getAttribute('spellcheck')) === 'true' && (await page.locator('.sl-editing').getAttribute('lang')) === 'ko');
    await page.keyboard.press('Escape');
    // 문맥 문법: 조사 받침 맞춤(hunspell 확인) + 숫자 뒤 조사 + AI 문법 검사(GPT 중계 서버, 응답은 가짜)
    await page.evaluate(() => {
      localStorage.setItem('slidelab.ai.settings', JSON.stringify({ provider: 'gpt-proxy', proxy: { url: 'https://proxy.test/', model: 'gpt-5-mini' } }));
      sessionStorage.setItem('slidelab.ai.keys', JSON.stringify({ access: 'e2e' }));
      const st = window.__SLIDELAB__.getState();
      st.commit('문법 준비', (d) => {
        const sub = (i) => d.slides[i].objects.find((o) => o.ph?.type === 'subTitle');
        sub(0).text.paragraphs = [{ runs: [{ text: 'This presentation is good' }] }];
        sub(1).text.paragraphs = [{ runs: [{ text: '학교을 지나 2을 더하고 내일 회의를 참석합니다.' }] }];
        sub(2).text.paragraphs = [{ runs: [{ text: 'presentation again' }] }];
      });
      st.set({ activeSlideId: st.doc.slides[1].id, selectedSlideIds: [st.doc.slides[1].id], selectedIds: [] });
    });
    let proxyBody = '', proxyAccess = '';
    await context.route('https://proxy.test/**', (route) => {
      proxyBody = route.request().postData() ?? '';
      proxyAccess = route.request().headers()['x-slidelab-access'] ?? '';
      const id = proxyBody.match(/\[(p\d+)\] [^\[]*회의를 참석/)?.[1] ?? 'p0';
      const edits = [{ id, find: '회의를 참석', replace: '회의에 참석', reason: "'참석하다'는 '-에'와 함께 씁니다." }];
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ edits }) }, finish_reason: 'stop' }] }) });
    });
    await page.locator('[data-testid="slide-stage"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F7');
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === '학교을', null, { timeout: 30000 });
    check('조사 받침 맞춤: 학교을 → 학교를 (문법)', (await page.locator('[data-spell-suggestions] button').first().textContent()) === '학교를' && (await page.locator('.spell-why').textContent()).includes("받침이 없으면 '를'") && (await page.locator('.spell-kind').textContent()).includes('문법'));
    await page.locator('[data-spell-change]').click();
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === '을');
    check('숫자 뒤 조사: 2을 → 2를 (읽는 소리 \'이\')', (await page.locator('[data-spell-suggestions] button').first().textContent()) === '를' && (await page.locator('.spell-why').textContent()).includes("끝소리 '이'"));
    await page.locator('[data-spell-change]').click();
    await page.waitForSelector('[data-spell-done]');
    await page.locator('[data-spell-ai]').click();
    await page.waitForFunction(() => document.querySelector('[data-spell-word]')?.textContent === '회의를 참석', null, { timeout: 15000 });
    check('AI 문법 검사: 중계 서버로 문단 전송(접근 코드) → 문맥 오류 표시', (await page.locator('.spell-kind').textContent()).includes('AI 문맥 문법') && proxyBody.includes('회의를 참석합니다') && proxyAccess === 'e2e' && (await page.locator('[data-spell-suggestions] button').first().textContent()) === '회의에 참석');
    await page.locator('[data-spell-change]').click();
    await page.waitForSelector('[data-spell-done]');
    texts = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[1].objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0].runs.map((r) => r.text).join(''));
    check('문맥 문법 고친 결과', texts === '학교를 지나 2를 더하고 내일 회의에 참석합니다.', texts);
    await page.locator('[data-spell-pane] .pp-head .icon-btn').click();
    await context.unroute('https://proxy.test/**');
    await page.evaluate(() => {
      localStorage.removeItem('slidelab.ai.settings');
      sessionStorage.removeItem('slidelab.ai.keys');
    });
  }

  if (want('compare')) {
    /* ───── 비교 ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.commit('비교 준비', (d) => {
        d.slides.forEach((s, i) => {
          s.hidden = false;
          s.comments = undefined;
          const sub = s.objects.find((o) => o.ph?.type === 'subTitle');
          if (sub) sub.text.paragraphs = [{ runs: [{ text: ['첫 슬라이드 부제목 내용', '둘째 슬라이드 설명 문장', '셋째 슬라이드 정리 내용'][i] ?? 'x' }] }];
        });
      });
    });
    // 검토본: PPTX로 내보낸 뒤 Node에서 수정 (2번 부제목 글자 변경, 3번 슬라이드 삭제)
    await openExport();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dl.saveAs(`${OUT}/s14-compare-base.pptx`);
    await closeBackstage();
    const z = await JSZip.loadAsync(readFileSync(`${OUT}/s14-compare-base.pptx`));
    const s2 = await z.file('ppt/slides/slide2.xml').async('string');
    z.file('ppt/slides/slide2.xml', s2.replace('둘째 슬라이드 설명 문장', '둘째 슬라이드 고친 설명 문장'));
    const pres = await z.file('ppt/presentation.xml').async('string');
    const ids = [...pres.matchAll(/<p:sldId [^>]*\/>/g)].map((m) => m[0]);
    z.file('ppt/presentation.xml', pres.replace(ids[2], ''));
    writeFileSync(`${OUT}/s14-compare-revised.pptx`, await z.generateAsync({ type: 'nodebuffer' }));
    await page.locator('.tab', { hasText: '검토' }).click();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.rb', { hasText: '비교' }).click()]);
    await fc.setFiles(`${OUT}/s14-compare-revised.pptx`);
    await page.waitForSelector('[data-compare-pane]');
    const kinds = await page.locator('[data-compare-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-compare-kind')));
    const labels = await page.locator('[data-compare-kind] .cmp-main').allTextContents();
    check('비교: 글자 변경 + 슬라이드 삭제만 (PPTX 왕복의 잡음 없음)', kinds.join(',') === 'textChanged,slideDeleted', labels.join(' | '));
    check('낱말 단위 차이 표시', (await page.locator('.cmp-diff .d-add').first().textContent()).trim() === '고친');
    await page.locator('[data-compare-kind="textChanged"]').click();
    check('변경 선택 → 현재/검토본 미리 보기', (await page.locator('.cmp-preview .sl-slide').count()) === 2);
    await page.locator('[data-compare-kind="textChanged"] [data-compare-apply]').click();
    const t2 = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[1].objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0].runs.map((r) => r.text).join(''));
    check('하나 적용', t2 === '둘째 슬라이드 고친 설명 문장' && (await page.locator('[data-compare-kind]').count()) === 1, t2);
    const para = await page.evaluate(() => JSON.stringify(window.__SLIDELAB__.getState().doc.slides[1].objects.find((o) => o.ph?.type === 'subTitle').text.paragraphs[0]));
    check('글자만 바꾸고 현재 서식 유지', para === JSON.stringify({ runs: [{ text: '둘째 슬라이드 고친 설명 문장' }] }), para);
    await page.locator('[data-compare-all]').click();
    check('모두 적용 → 다른 점 없음', (await page.locator('[data-compare-done]').count()) === 1 && (await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.length)) === 2);
    await page.screenshot({ path: `${OUT}/s14-compare.png` });
    await page.keyboard.press('Control+z');
    check('실행 취소 → 슬라이드 복원', (await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.length)) === 3);
    await page.locator('[data-compare-end]').click();
  }

  if (want('model3d')) {
    /* ───── 3D 모델 (확장 인터페이스) ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: [] });
    });
    await page.locator('.tab', { hasText: '삽입' }).click();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.rb', { hasText: '3D 모델' }).click()]);
    await fc.setFiles('src/extensions/model3d/__fixtures__/cube.glb');
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.type === 'extension'));
    const m = await page.evaluate(() => JSON.parse(JSON.stringify(window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.type === 'extension'))));
    const assets = await page.evaluate((m) => { const a = window.__SLIDELAB__.getState().doc.assets; return { model: a[m.assetId], poster: a[m.posterId]?.dataUrl.slice(0, 30) }; }, m);
    check('3D 모델 삽입: GLB(IndexedDB) + 대체 그림', m.kind === 'model3d' && m.name === 'cube' && !!assets.model.blobKey && assets.poster.startsWith('data:image/png'), JSON.stringify(assets).slice(0, 120));
    await page.waitForSelector(`[data-obj-id="${m.id}"] [data-model3d="ready"]`, { timeout: 15000 });
    const stats = (sel) => page.evaluate((sel) => {
      const c = document.querySelector(sel);
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let ink = 0, r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { ink++; r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return { ink, frac: ink / (c.width * c.height), rgb: ink ? [Math.round(r / ink), Math.round(gg / ink), Math.round(b / ink)] : null };
    }, sel);
    const canvasSel = `[data-testid="slide-stage"] [data-obj-id="${m.id}"] canvas`;
    const s0 = await stats(canvasSel);
    check('WebGL로 그림 (정육면체가 상자의 일부를 채움)', s0.frac > 0.1 && s0.frac < 0.9, JSON.stringify(s0));
    // 서식 창: Y 회전 → 다시 그림 + 대체 그림 갱신 (한 단계 실행 취소)
    await page.waitForSelector('[data-m3d-props]');
    const posterBefore = await page.evaluate((m) => window.__SLIDELAB__.getState().doc.assets[m.posterId].dataUrl, m);
    // 마우스로 끌기: 한 번의 동작 = 실행 취소 한 단계
    const sb = await page.locator('[data-m3d="rotY"]').boundingBox();
    const xAt = (deg) => sb.x + ((deg + 180) / 360) * sb.width;
    await page.mouse.move(xAt(m.data.rotY), sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(xAt(m.data.rotY + 30), sb.y + sb.height / 2, { steps: 8 });
    await page.mouse.move(xAt(m.data.rotY + 60), sb.y + sb.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.__SLIDELAB__.getState().gestureBase, null, { timeout: 5000 });
    const after = await page.evaluate((m) => { const st = window.__SLIDELAB__.getState(); const o = st.doc.slides[0].objects.find((x) => x.id === m.id); return { rotY: o.data.rotY, poster: st.doc.assets[m.posterId].dataUrl }; }, m);
    const s1 = await stats(canvasSel);
    check('회전(끌기) → 화면·대체 그림이 바뀜', Math.abs(after.rotY - (m.data.rotY + 60)) <= 8 && after.poster !== posterBefore && JSON.stringify(s1.rgb) !== JSON.stringify(s0.rgb), `${after.rotY}° ${JSON.stringify(s0.rgb)}→${JSON.stringify(s1.rgb)}`);
    await page.locator('[data-testid="slide-stage"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate((m) => { const st = window.__SLIDELAB__.getState(); return st.doc.slides[0].objects.find((x) => x.id === m.id)?.data.rotY; }, m);
    check('실행 취소 → 원래 각도', undone === m.data.rotY, String(undone));
    await page.screenshot({ path: `${OUT}/s14-model3d.png` });
    // 그림 내보내기 = 대체 그림 위치에 정육면체
    await openExport();
    await page.locator('[data-export-image] select[aria-label="내보낼 슬라이드"]').selectOption('current');
    await page.locator('[data-export-image] select[aria-label="그림 형식"]').selectOption('png');
    await page.locator('[data-export-image] select[aria-label="해상도"]').selectOption('1');
    const png = await download(() => page.locator('[data-export-image-go]').click(), 's14-img-3d.png');
    const inBox = await page.evaluate(async ([b64, m]) => {
      const img = await new Promise((ok) => Object.assign(new Image(), { onload() { ok(this); }, src: `data:image/png;base64,${b64}` }));
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.round(m.x), Math.round(m.y), Math.round(m.width), Math.round(m.height)).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) colored++;
      return colored / (d.length / 4);
    }, [readFileSync(png.path).toString('base64'), m]);
    check('그림 내보내기에 3D 모델(대체 그림)', inBox > 0.1, inBox.toFixed(2));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dl.saveAs(`${OUT}/s14-model3d.pptx`);
    const z = await JSZip.loadAsync(readFileSync(`${OUT}/s14-model3d.pptx`));
    {
      const sx = await z.file('ppt/slides/slide1.xml').async('string');
      const rels = await z.file('ppt/slides/_rels/slide1.xml.rels').async('string');
      const glbName = rels.match(/relationships\/model3d" Target="\.\.\/media\/([^"]+\.glb)"/)?.[1];
      const glbLen = glbName ? (await z.file(`ppt/media/${glbName}`).async('uint8array')).length : -1;
      const warn = (await page.locator('.bs-warnings').count()) ? await page.locator('.bs-warnings').textContent() : '';
      check('PPTX: PowerPoint 3D 모델(am3d) + GLB + 대체 그림(Fallback)', /Requires="am3d"[\s\S]*<am3d:model3d r:embed="rIdSL\d+">[\s\S]*<mc:Fallback><p:pic>[\s\S]*descr="cube"/.test(sx) && glbLen === readFileSync('src/extensions/model3d/__fixtures__/cube.glb').length && !warn.includes('그림으로 저장'), `glb=${glbLen}`);
    }
    // .slidelab에 GLB 포함
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'SlideLab 문서' }).click()]);
    await dl2.saveAs(`${OUT}/s14-model3d.slidelab`);
    const native = JSON.parse(readFileSync(`${OUT}/s14-model3d.slidelab`, 'utf8'));
    check('.slidelab에 3D 모델 파일(GLB) 포함', native.blobs?.[assets.model.blobKey]?.startsWith('data:model/gltf-binary;base64,') && Buffer.from(native.blobs[assets.model.blobKey].split(',')[1], 'base64').length === readFileSync('src/extensions/model3d/__fixtures__/cube.glb').length);
    await closeBackstage();
  }

  if (want('a11y')) {
    /* ───── 접근성 (axe-core): 심각·치명 위반 없음 ───── */
    await closeBackstage();
    const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
    const scan = async (label, setup) => {
      await setup();
      await page.waitForTimeout(400);
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSrc });
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => x.impact === 'critical' || x.impact === 'serious').map((x) => `${x.id}(${x.nodes.length}: ${x.nodes.slice(0, 1).map((n) => n.failureSummary.replace(/\s+/g, ' ') + ' | ' + document.querySelector(n.target[0])?.getAttribute('aria-label') + ' | visible=' + JSON.stringify(document.querySelector(n.target[0])?.innerText)).join(' ; ')})`));
      check(`접근성: ${label}`, v.length === 0, v.join(', '));
    };
    const st = (patch) => page.evaluate((p) => window.__SLIDELAB__.getState().set(p), patch);
    await scan('편집 화면', () => st({ backstageOpen: false, commentsPane: false, spellPane: false }));
    // 리본의 모든 탭
    for (const tab of await page.locator('.tab:not(.tab-file)').allTextContents()) {
      await scan(`리본 [${tab}] 탭`, () => page.locator('.tab', { hasText: tab }).first().click());
    }
    await scan('메모 창', () => st({ commentsPane: true }));
    await scan('맞춤법 창', () => st({ commentsPane: false, spellPane: true }));
    await scan('내보내기', () => st({ spellPane: false, backstageOpen: true, backstagePage: 'export' }));
    await scan('인쇄', () => st({ backstagePage: 'print' }));
    await scan('수식 창', () => st({ backstageOpen: false, equationEditorId: 'new' }));
    await page.keyboard.press('Escape');
    await st({ equationEditorId: null });
  }

  if (want('morph')) {
    /* ───── 모핑 전환 ───── */
    await closeBackstage();
    const hiddenBefore = await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      const hidden = st.doc.slides.map((s) => !!s.hidden);
      const body = (t, size, color) => ({ paragraphs: [{ runs: [{ text: t, fontSize: size, color }], align: 'left' }], vAlign: 'middle', direction: 'horizontal', padding: { top: 4, right: 8, bottom: 4, left: 8 }, autoFit: 'none' });
      const circle = (id, x, y, w, color) => ({ id, type: 'shape', name: '공', shape: 'ellipse', x, y, width: w, height: w, rotation: 0, fill: { type: 'solid', color }, stroke: null, text: body('', 18, '#000000') });
      const label = (id, x, y, t) => ({ id, type: 'text', name: '제목', x, y, width: 500, height: 70, rotation: 0, fill: { type: 'none' }, stroke: null, text: body(t, 40, '#1F3864') });
      st.commit('모핑 준비', (d) => {
        const base = JSON.parse(JSON.stringify(d.slides[0]));
        const mk = (id, objects, transition) => ({ ...base, id, hidden: false, notes: '', animations: [], comments: undefined, objects, ...(transition ? { transition } : { transition: undefined }) });
        d.slides.forEach((s) => (s.hidden = true));
        d.slides.push(mk('m1', [circle('m1c', 100, 100, 200, '#FF0000'), label('m1t', 100, 500, '분기 실적')]));
        d.slides.push(mk('m2', [circle('m2c', 800, 300, 300, '#0000FF'), label('m2t', 600, 100, '실적 보고')], { type: 'morph', duration: 3000, advanceOnClick: true }));
      });
      st.set({ activeSlideId: 'm2', selectedSlideIds: ['m2'] });
      return hidden;
    });
    // 리본: 전환 탭에 모핑, 효과 옵션 개체/단어/문자
    await page.locator('.tab', { hasText: '전환' }).click();
    check('전환 갤러리에 모핑 (선택됨)', (await page.locator('.fx-item[data-transition="morph"].is-active').count()) === 1);
    await page.locator('.rb', { hasText: '효과 옵션' }).click();
    const opts = await page.locator('[data-transition-options] .menu-item').allTextContents();
    check('모핑 효과 옵션: 개체·단어·문자', opts.map((x) => x.trim()).join(',') === '개체,단어,문자', opts.join(','));
    await page.keyboard.press('Escape');
    // 슬라이드 쇼: 전환 중 공이 앞 자리와 새 자리 사이를 움직이고 색이 섞임
    const sampleShow = async (sel) => {
      await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm1', selectedSlideIds: ['m1'] }));
      await page.keyboard.press('Shift+F5');
      await page.waitForSelector('.slideshow .show-stage');
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowRight');
      await page.waitForSelector('.show-stage[data-transition="running"]');
      const samples = [];
      for (let i = 0; i < 12; i++) {
        samples.push(
          await page.evaluate((sel) => {
            const stage = document.querySelector('.show-stage');
            if (!stage || !stage.dataset.transition) return null;
            const k = stage.getBoundingClientRect().width / 1280;
            const s0 = stage.getBoundingClientRect();
            const el = document.querySelector(sel);
            if (!el) return { missing: true };
            const r = el.getBoundingClientRect();
            const fillEl = el.querySelector('svg [fill]:not([fill="none"])') ?? el.querySelector('svg path, svg ellipse');
            return { cx: (r.left + r.width / 2 - s0.left) / k, w: r.width / k, fill: fillEl ? getComputedStyle(fillEl).fill : null, tokens: [...document.querySelectorAll('[data-morph-token]')].map((t) => [t.dataset.morphToken, Number(getComputedStyle(t).opacity).toFixed(2)]) };
          }, sel),
        );
        await page.waitForTimeout(200);
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
      return samples.filter((x) => x && !x.missing);
    };
    const sm = await sampleShow('[data-obj-id="mp:m2c"]');
    const mids = sm.filter((x) => x.cx > 210 && x.cx < 940);
    const increasing = sm.every((x, i) => i === 0 || x.cx >= sm[i - 1].cx - 0.5);
    const mixed = sm.some((x) => /rgb\((\d+), 0, (\d+)\)/.test(x.fill ?? '') && Number(x.fill.match(/rgb\((\d+)/)[1]) > 20 && Number(x.fill.match(/, (\d+)\)/)[1]) > 20);
    check('쇼: 모핑 중 공이 앞 자리→새 자리로 이동(중간 위치·크기), 색이 섞임', mids.length >= 3 && increasing && mixed && mids.some((x) => x.w > 205 && x.w < 295), JSON.stringify(sm.slice(0, 6).map((x) => [Math.round(x.cx), Math.round(x.w), x.fill])));
    // 단어 옵션: 같은 단어 '실적'은 이동, '분기'는 사라지고 '보고'는 나타남
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('모핑 단어', (d) => (d.slides.find((s) => s.id === 'm2').transition.morphOption = 'byWord')));
    const sw = await sampleShow('[data-obj-id="mp:m2t"]');
    const tk = sw.find((x) => x.tokens.length >= 3 && x.tokens.some(([t, o]) => t === '보고' && o > 0 && o < 1));
    check('쇼: 단어 단위 모핑 (실적=이동, 분기=사라짐, 보고=나타남)', !!tk && tk.tokens.some(([t, o]) => t === '실적' && o === '1.00') && tk.tokens.some(([t]) => t === '분기'), JSON.stringify(tk?.tokens ?? sw.map((x) => x.tokens).slice(0, 3)));
    // 비디오: 슬라이드 1(2초) 뒤 모핑 3초 → 3.5초(중간)에는 공의 중간 자리가 보라색
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('모핑 개체', (d) => (d.slides.find((s) => s.id === 'm2').transition.morphOption = 'byObject')));
    await openExport();
    await page.locator('[data-video-seconds]').fill('2');
    await page.locator('select[aria-label="비디오 형식"]').selectOption('webm');
    await page.locator('select[aria-label="비디오 품질"]').selectOption('720');
    const mv = await download(() => page.locator('[data-export-video-go]').click(), 's14-morph.webm');
    const pxAt = (t, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', mv.path, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    // 공 중심: (200,200) → (950,450), 3.5초 = 진행률 0.5 → 가감속 0.5 → (575,325), 지름 250 → 글자와 겹치지 않는 (620,300)을 봄
    const midPx = pxAt(3.5, 620, 300), startPx = pxAt(1.0, 200, 200), endPx = pxAt(5.6, 950, 450);
    const purple = midPx[0] > 80 && midPx[0] < 180 && midPx[2] > 80 && midPx[2] < 180 && midPx[1] < 60;
    check('비디오: 모핑 중간 프레임 = 중간 자리·섞인 색, 처음 빨강·끝 파랑', purple && startPx[0] > 200 && startPx[2] < 60 && endPx[2] > 200 && endPx[0] < 60, `${midPx} / ${startPx} / ${endPx}`);
    // PPTX
    const [dlM] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dlM.saveAs(`${OUT}/s14-morph.pptx`);
    const zm = await JSZip.loadAsync(readFileSync(`${OUT}/s14-morph.pptx`));
    const names = Object.keys(zm.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    let morphXml = '';
    for (const n of names) {
      const x = await zm.file(n).async('string');
      if (x.includes('p159:morph')) morphXml = x;
    }
    check('PPTX: p159:morph + 대체 페이드', /<p159:morph option="byObject"\/>[\s\S]*<mc:Fallback><p:transition[^>]*><p:fade\/>/.test(morphXml));
    await closeBackstage();
    // ── 문자 단위: ABCDE 👨‍👩‍👧 → EDCBA 👨‍👩‍👧 (이모지는 한 글자, 각 글자가 새 자리로) ──
    await page.evaluate(() => {
      window.__SLIDELAB__.getState().commit('문자 모핑 준비', (d) => {
        const m1 = d.slides.find((s) => s.id === 'm1'), m2 = d.slides.find((s) => s.id === 'm2');
        m1.objects.find((o) => o.id === 'm1t').text.paragraphs[0].runs[0].text = 'ABCDE 👨‍👩‍👧';
        m2.objects.find((o) => o.id === 'm2t').text.paragraphs[0].runs[0].text = 'EDCBA 👨‍👩‍👧';
        m2.transition.morphOption = 'byChar';
      });
    });
    const sc = await sampleShow('[data-obj-id="mp:m2t"]');
    const ct = sc.find((x) => x.tokens.length >= 6);
    check('쇼: 문자 단위 (각 글자 이동, 가족 이모지는 한 글자)', !!ct && ct.tokens.filter(([t]) => t === '👨‍👩‍👧').length === 1 && ['A', 'B', 'C', 'D', 'E'].every((c) => ct.tokens.some(([t, o]) => t === c && o === '1.00')), JSON.stringify(ct?.tokens));
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm1', selectedSlideIds: ['m1'] }));
    await page.keyboard.press('Shift+F5');
    await page.waitForSelector('.slideshow .show-stage');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.show-stage[data-transition="running"]');
    await page.waitForTimeout(1500);
    await page.locator('.show-stage').screenshot({ path: `${OUT}/s14-morph-chars.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
    // ── 명세 테스트 5: '!!' 이름의 원 → 사각형은 경로 모핑 (전환 중 도형이 사용자 지정 경로) ──
    await page.evaluate(() => {
      window.__SLIDELAB__.getState().commit('도형 변형 준비', (d) => {
        const m1 = d.slides.find((s) => s.id === 'm1'), m2 = d.slides.find((s) => s.id === 'm2');
        m1.objects.find((o) => o.id === 'm1c').name = '!!모양';
        Object.assign(m2.objects.find((o) => o.id === 'm2c'), { name: '!!모양', shape: 'rect' });
        m2.transition.morphOption = 'byObject';
      });
    });
    const sp = await sampleShow('[data-obj-id="mp:m2c"]');
    const pathInfo = sp.length ? await Promise.resolve(sp) : [];
    check('쇼: !! 원 → 사각형 경로 모핑 (전환 중 같은 개체가 이동)', pathInfo.length >= 3 && pathInfo.some((x) => x.cx > 210 && x.cx < 940), JSON.stringify(pathInfo.slice(0, 3).map((x) => Math.round(x.cx))));
    {
      // 경로 모양 확인: 쇼를 다시 시작해 전환 중 path의 점 개수와 모양을 읽음
      await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm1', selectedSlideIds: ['m1'] }));
      await page.keyboard.press('Shift+F5');
      await page.waitForSelector('.slideshow .show-stage');
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowRight');
      await page.waitForSelector('.show-stage[data-transition="running"]');
      await page.waitForTimeout(1200);
      await page.locator('.show-stage').screenshot({ path: `${OUT}/s14-morph-shape.png` });
      const d = await page.evaluate(() => document.querySelector('[data-obj-id="mp:m2c"] svg path')?.getAttribute('d') ?? '');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
      const pts = (d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).length;
      check('쇼: 도형 변형 중 경로는 원도 사각형도 아닌 중간 모양 (점 128개 윤곽)', pts >= 100, `점 ${pts}개`);
    }
    // ── 모핑 연결 대화 상자: 현재 연결 표시, '연결 안 함' → 나타나는 개체, 실행 취소 ──
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm2', selectedSlideIds: ['m2'] }));
    await page.locator('.tab', { hasText: '전환' }).click();
    await page.locator('.rb', { hasText: '모핑 연결' }).click();
    await page.waitForSelector('[data-morph-link]');
    const st1 = await page.locator('[data-morph-status="m2c"]').textContent();
    await page.locator('[data-morph-select="m2c"]').selectOption('none');
    await page.waitForFunction(() => document.querySelector('[data-morph-status="m2c"]')?.textContent.includes('나타남'));
    const excl = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.find((s) => s.id === 'm2').objects.find((o) => o.id === 'm2c').morphExclude);
    await page.locator('[data-morph-select="m2c"]').selectOption('m1t');
    await page.waitForFunction(() => document.querySelector('[data-morph-status="m2c"]')?.textContent.includes('같은 개체'));
    const key = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.find((s) => s.id === 'm2').objects.find((o) => o.id === 'm2c').morphKey);
    await page.locator('[data-morph-select="m2c"]').selectOption('auto');
    await page.locator('.dialog .btn.primary', { hasText: '닫기' }).click();
    check("모핑 연결: 현재 연결('!!' 이름) 표시 → 연결 안 함 → 다른 개체로 지정(morphKey) → 자동", st1.includes("'!!' 이름") && excl === true && key === 'm1t', `${st1} / ${excl} / ${key}`);
    // ── 가감속·기간 범위·초기화 ──
    await page.locator('[data-morph-easing]').selectOption('cubicBezier');
    await page.locator('[data-morph-bezier]').fill('0.1, 0.7, 0.3, 1');
    await page.locator('.seconds-input').first().fill('9');
    const tr1 = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.find((s) => s.id === 'm2').transition);
    check('가감속 cubic-bezier 저장, 기간은 5초를 넘지 않음', tr1.easing === 'cubicBezier' && tr1.bezier.join(',') === '0.1,0.7,0.3,1' && tr1.duration <= 5000, JSON.stringify(tr1));
    // ── 명세 테스트 10: 슬라이드 복제 후 객체 이동 → morphKey로 자동 매칭 ──
    await page.locator('.tab', { hasText: '홈' }).click();
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm1', selectedSlideIds: ['m1'] }));
    await page.locator('.rb', { hasText: '복제' }).first().click();
    const dupInfo = await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      const i = st.doc.slides.findIndex((s) => s.id === 'm1');
      const dup = st.doc.slides[i + 1];
      st.commit('복제본 이동', (d) => {
        const s = d.slides[i + 1];
        const c = s.objects.find((o) => o.morphKey === 'm1c');
        c.x = 900;
        c.y = 400;
        c.name = '다른 이름';
        s.transition = { type: 'morph', duration: 3000, advanceOnClick: true, easing: 'linear' };
      });
      return { id: dup.id, keys: dup.objects.map((o) => o.morphKey), ids: dup.objects.map((o) => o.id) };
    });
    check('슬라이드 복제: 개체 ID는 새로, morphKey는 원본 ID', dupInfo.keys.join(',') === 'm1c,m1t' && !dupInfo.ids.includes('m1c'), JSON.stringify(dupInfo));
    const dupC = dupInfo.ids[0];
    const sd = await sampleShow(`[data-obj-id="mp:${dupC}"]`);
    check('쇼: 복제본에서 이름을 바꾸고 옮긴 원도 morphKey로 이어져 이동', sd.length >= 3 && sd.some((x) => x.cx > 210 && x.cx < 1040), JSON.stringify(sd.slice(0, 4).map((x) => Math.round(x.cx))));
    // ── 동작 줄이기(prefers-reduced-motion): 움직임 없이 페이드 ──
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ activeSlideId: 'm1', selectedSlideIds: ['m1'] }));
    await page.keyboard.press('Shift+F5');
    await page.waitForSelector('.slideshow .show-stage');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.show-stage[data-transition="running"]');
    await page.waitForTimeout(400);
    const reducedLayer = await page.evaluate(() => document.querySelectorAll('.show-stage [data-morph]').length);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    check('동작 줄이기 설정이면 모핑 장면 없이 페이드', reducedLayer === 0, `모핑 층 ${reducedLayer}개`);
    // ── 명세 테스트 12: 저장 → 새로 고침 → 모핑 설정·연결 관계 유지 ──
    await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
    await page.reload();
    await page.waitForSelector('[data-testid="slide-stage"]');
    await page.waitForTimeout(500);
    const kept = await page.evaluate((dupId) => {
      const d = window.__SLIDELAB__.getState().doc;
      const m2 = d.slides.find((s) => s.id === 'm2'), dup = d.slides.find((s) => s.id === dupId);
      return { tr: m2?.transition, keys: dup?.objects.map((o) => o.morphKey), dupTr: dup?.transition };
    }, dupInfo.id);
    check('새로 고침 후 모핑 설정(단위·가감속·곡선)과 복제본 morphKey 유지', kept.tr?.type === 'morph' && kept.tr.easing === 'cubicBezier' && kept.tr.bezier?.join(',') === '0.1,0.7,0.3,1' && kept.keys?.join(',') === 'm1c,m1t' && kept.dupTr?.easing === 'linear', JSON.stringify(kept));
    await page.evaluate((dupId) => window.__SLIDELAB__.getState().commit('복제본 삭제', (d) => (d.slides = d.slides.filter((s) => s.id !== dupId))), dupInfo.id);
    await page.evaluate((hidden) => {
      window.__SLIDELAB__.getState().commit('모핑 정리', (d) => {
        d.slides = d.slides.filter((s) => s.id !== 'm1' && s.id !== 'm2');
        d.slides.forEach((s, i) => (s.hidden = hidden[i]));
      });
      const st = window.__SLIDELAB__.getState();
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id] });
    }, hiddenBefore);
  }

  if (want('offslide')) {
    /* ───── 슬라이드 바깥(작업 영역) 개체: 보이고, 클릭·끌기·편집, 쇼·축소판에서는 잘림 ───── */
    await closeBackstage();
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      const body = (t) => ({ paragraphs: [{ runs: [{ text: t, fontSize: 28, color: '#000000' }], align: 'left' }], vAlign: 'middle', direction: 'horizontal', padding: { top: 4, right: 8, bottom: 4, left: 8 }, autoFit: 'none' });
      st.commit('바깥 개체', (d) => {
        d.slides[0].objects.push({ id: 'off-l', type: 'shape', name: '왼쪽 바깥', shape: 'ellipse', x: -320, y: 200, width: 200, height: 200, rotation: 0, fill: { type: 'solid', color: '#E04040' }, stroke: null, text: body('') });
        d.slides[0].objects.push({ id: 'off-r', type: 'text', name: '오른쪽 바깥', x: 1340, y: 300, width: 300, height: 80, rotation: 0, fill: { type: 'none' }, stroke: null, text: body('바깥 글자') });
      });
      st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: [] });
    });
    await page.waitForSelector('.canvas-scroller[data-offslide] [data-obj-id="off-l"]');
    const vis = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="slide-stage"]').getBoundingClientRect();
      const out = {};
      for (const id of ['off-l', 'off-r']) {
        const el = document.querySelector(`.canvas-scroller [data-obj-id="${id}"]`);
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-obj-id]')?.dataset.objId;
        out[id] = { outside: id === 'off-l' ? r.right <= stage.left + 1 + (document.querySelector('[data-testid="slide-stage"]').getBoundingClientRect().left - stage.left) : r.left >= document.querySelector('[data-testid="slide-stage"]').getBoundingClientRect().right - 1, w: Math.round(r.width), hit };
      }
      return out;
    });
    check('슬라이드 바깥 개체가 작업 영역에 보이고 그 자리에서 맞음(클릭 대상)', vis['off-l'].w > 0 && vis['off-l'].hit === 'off-l' && vis['off-l'].outside && vis['off-r'].hit === 'off-r' && vis['off-r'].outside, JSON.stringify(vis));
    // 클릭 → 선택, 끌어서 슬라이드 안으로
    const el = page.locator('.canvas-scroller [data-obj-id="off-l"]');
    await el.scrollIntoViewIfNeeded();
    await el.click();
    check('바깥 개체 클릭 → 선택', JSON.stringify(await page.evaluate(() => window.__SLIDELAB__.getState().selectedIds)) === '["off-l"]');
    const zoom = await page.evaluate(() => window.__SLIDELAB__.getState().zoom);
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 10 * zoom, b.y + b.height / 2, { steps: 1 });
    await page.mouse.up();
    const x1 = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === 'off-l').x);
    check('바깥 개체 끌기: 끈 만큼 정확히 이동 (작업 영역이 늘어도 튀지 않음)', Math.abs(x1 - -220) < 3, `x=${x1}`);
    // 크기 조절 핸들
    const h = page.locator('.sel-handle[data-handle="e"], [data-handle="e"]').first();
    if (await h.count()) {
      const hb = await h.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 50 * zoom, hb.y + hb.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    const w1 = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === 'off-l').width);
    check('바깥 개체 크기 조절 핸들 (스냅 허용)', w1 > 240 && w1 < 260, `width=${w1}`);
    // 바깥 텍스트 상자: 두 번 클릭 → 편집 → 입력
    const tl = page.locator('.canvas-scroller [data-obj-id="off-r"]');
    await tl.scrollIntoViewIfNeeded();
    await tl.dblclick();
    await page.waitForSelector('.sl-editing');
    await page.keyboard.press('End');
    await page.keyboard.type(' 편집');
    await page.keyboard.press('Escape');
    const txt = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === 'off-r').text.paragraphs[0].runs.map((r) => r.text).join(''));
    check('바깥 텍스트 상자 두 번 클릭 → 편집·입력', txt === '바깥 글자 편집', txt);
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ zoom: 0.4, fitMode: false, selectedIds: ['off-l'] }));
    await page.waitForTimeout(300);
    await page.locator('.canvas-viewport').screenshot({ path: `${OUT}/s14-offslide.png` });
    // 축소판·슬라이드 쇼에서는 슬라이드 밖이 잘림
    const thumbClip = await page.evaluate(() => getComputedStyle(document.querySelector('[data-slide-id] .sl-slide')).overflow);
    await page.keyboard.press('F5');
    await page.waitForSelector('.slideshow .show-stage');
    await page.waitForTimeout(300);
    const showClip = await page.evaluate(() => getComputedStyle(document.querySelector('.show-stage .sl-slide')).overflow);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__SLIDELAB__.getState().slideshow);
    check('축소판·슬라이드 쇼에서는 슬라이드 밖을 잘라 보여 줌', thumbClip === 'hidden' && showClip === 'hidden', `${thumbClip} / ${showClip}`);
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('바깥 개체 정리', (d) => (d.slides[0].objects = d.slides[0].objects.filter((o) => !o.id.startsWith('off-')))));
  }

  if (want('merge')) {
    /* ───── 도형 병합 (통합·결합·조각·교차·빼기) + 점 편집 ───── */
    await closeBackstage();
    const setup = (objs) =>
      page.evaluate((objs) => {
        const st = window.__SLIDELAB__.getState();
        const body = { paragraphs: [{ runs: [{ text: '' }] }], vAlign: 'middle', direction: 'horizontal', padding: { top: 4, right: 8, bottom: 4, left: 8 }, autoFit: 'none' };
        st.commit('병합 준비', (d) => {
          d.slides[0].objects = d.slides[0].objects.filter((o) => !o.id.startsWith('mg') && !o.merged);
          for (const o of objs) d.slides[0].objects.push({ type: 'shape', rotation: 0, stroke: { color: '#203040', width: 2, dash: 'solid' }, text: body, ...o });
        });
        st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: objs.map((o) => o.id), editPointsId: null });
      }, objs);
    const objsNow = () => page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.filter((o) => o.id.startsWith('mg') || o.merged).map((o) => JSON.parse(JSON.stringify(o))));
    const openMerge = async () => {
      await page.locator('.tab', { hasText: '도형 서식' }).click();
      await page.locator('.rb', { hasText: '도형 병합' }).click();
      await page.waitForSelector('[data-merge-items]');
    };
    const A = { id: 'mgA', name: '원 A', shape: 'ellipse', x: 300, y: 250, width: 200, height: 200, fill: { type: 'solid', color: '#3B82F6' } };
    const B = { id: 'mgB', name: '원 B', shape: 'ellipse', x: 420, y: 250, width: 200, height: 200, fill: { type: 'solid', color: '#F59E0B' } };
    // 한 개만 선택하면 비활성
    await setup([A]);
    await page.locator('.tab', { hasText: '도형 서식' }).click();
    await page.screenshot({ path: `${OUT}/s14-merge-ribbon.png` });
    check('도형 하나만 선택하면 도형 병합 비활성', await page.locator('.rb', { hasText: '도형 병합' }).isDisabled());
    // 메뉴: 다섯 가지 + 아이콘·설명 + 빼기 기준 안내, 마우스를 올리면 결과 미리 보기
    await setup([B, A]);
    await openMerge();
    const items = await page.locator('[data-merge-op]').allTextContents();
    const base = await page.locator('[data-merge-base]').textContent();
    check('메뉴: 통합·결합·조각·교차·빼기 (아이콘·설명), 빼기 기준 = 처음 선택한 도형', items.length === 5 && ['통합', '결합', '조각', '교차', '빼기'].every((n, i) => items[i].includes(n)) && (await page.locator('[data-merge-op] svg').count()) === 5 && base.includes('원 B') && base.includes('원 B → 원 A'), `${items.map((x) => x.slice(0, 8)).join('|')} / ${base}`);
    await page.locator('[data-merge-op="intersect"]').hover();
    await page.waitForSelector('[data-merge-preview] path', { timeout: 10000 });
    check('마우스를 올리면 결과 윤곽 미리 보기', (await page.locator('[data-merge-preview] path').count()) === 1);
    await page.keyboard.press('Escape');
    // 통합: 하나의 자유형, 첫 선택(B)의 서식, 원본 삭제, 결과 선택
    await setup([A, B]);
    const before = await objsNow();
    await openMerge();
    await page.locator('[data-merge-op="union"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged));
    let after = await objsNow();
    const sel = await page.evaluate(() => window.__SLIDELAB__.getState().selectedIds);
    check('통합: 원본 대신 자유형 하나 (첫 선택 서식, 결과 선택됨)', after.length === 1 && after[0].shape === 'custom' && after[0].merged.op === 'union' && after[0].fill.color === '#3B82F6' && sel[0] === after[0].id && Math.abs(after[0].width - 320) < 1, JSON.stringify(after.map((o) => [o.shape, o.merged?.op, o.fill?.color, Math.round(o.width)])));
    // J. 실행 취소 / 다시 실행
    await page.keyboard.press('Control+z');
    const undone = await objsNow();
    await page.keyboard.press('Control+y');
    const redone = await objsNow();
    check('실행 취소 → 원본 그대로 복원, 다시 실행 → 같은 결과', JSON.stringify(undone) === JSON.stringify(before) && JSON.stringify(redone) === JSON.stringify(after), `${undone.length} / ${redone.length}`);
    // 결합·교차·빼기 (각각 실행 → 실행 취소)
    const res = {};
    for (const op of ['combine', 'intersect', 'subtract']) {
      await setup([A, B]);
      await openMerge();
      await page.locator(`[data-merge-op="${op}"]`).click();
      await page.waitForFunction((op) => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged?.op === op), op);
      res[op] = (await objsNow()).map((o) => Math.round(o.width));
      await page.keyboard.press('Control+z');
      res[op].push(JSON.stringify(await objsNow()) === JSON.stringify(await (async () => { await setup([A, B]); return objsNow(); })()) ? 'undo-ok' : 'undo-bad');
    }
    check('결합(전체 폭)·교차(렌즈 폭 80)·빼기(A − B 초승달 폭 160), 각각 실행 취소', res.combine[0] === 320 && res.intersect[0] === 80 && res.subtract[0] === 160 && Object.values(res).every((r) => r.at(-1) === 'undo-ok'), JSON.stringify(res));
    // I. 조각 → 세 조각 모두 선택, 가운데 조각만 색 바꾸고 옮기기
    await setup([A, B]);
    await openMerge();
    await page.locator('[data-merge-op="fragment"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.filter((o) => o.merged?.op === 'fragment').length === 3);
    const frag = await objsNow();
    const fragSel = await page.evaluate(() => window.__SLIDELAB__.getState().selectedIds.length);
    check('조각: 독립 개체 3개, 모두 선택됨', frag.length === 3 && fragSel === 3, frag.map((o) => Math.round(o.width)).join(','));
    const mid = frag.find((o) => Math.round(o.width) === 80);
    // 가운데 조각을 화면에서 클릭해 선택
    await page.evaluate(() => window.__SLIDELAB__.getState().select([]));
    const stageBox = await page.locator('[data-testid="slide-stage"]').boundingBox();
    const z = await page.evaluate(() => window.__SLIDELAB__.getState().zoom);
    await page.mouse.click(stageBox.x + 460 * z, stageBox.y + 350 * z);
    const picked = await page.evaluate(() => window.__SLIDELAB__.getState().selectedIds);
    await page.evaluate((id) => window.__SLIDELAB__.getState().commit('조각 색', (d) => (d.slides[0].objects.find((o) => o.id === id).fill = { type: 'solid', color: '#10B981' })), mid.id);
    await page.mouse.move(stageBox.x + 460 * z, stageBox.y + 350 * z);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 460 * z, stageBox.y + 250 * z, { steps: 6 });
    await page.mouse.up();
    const frag2 = await objsNow();
    const others = frag2.filter((o) => o.id !== mid.id), m2 = frag2.find((o) => o.id === mid.id);
    check('가운데 조각 클릭 선택 → 색·위치만 바뀌고 나머지 조각은 그대로', picked.length === 1 && picked[0] === mid.id && m2.fill.color === '#10B981' && m2.y < mid.y - 50 && JSON.stringify(others) === JSON.stringify(frag.filter((o) => o.id !== mid.id)), `${picked} y ${Math.round(mid.y)}→${Math.round(m2.y)}`);
    // C. 빼기로 도넛: 가운데가 실제로 비어 있음 (클릭하면 도형이 아니라 슬라이드, 화면도 배경색)
    await setup([{ ...A, id: 'mgBig', name: '큰 원', x: 300, y: 150, width: 400, height: 400 }, { ...B, id: 'mgSmall', name: '작은 원', x: 400, y: 250, width: 200, height: 200 }]);
    await openMerge();
    await page.locator('[data-merge-op="subtract"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged?.op === 'subtract'));
    await page.evaluate(() => window.__SLIDELAB__.getState().select([]));
    const donut = (await objsNow())[0];
    const hole = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-obj-id]')?.dataset.objId ?? null, [stageBox.x + 500 * z, stageBox.y + 350 * z]);
    const ring = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-obj-id]')?.dataset.objId ?? null, [stageBox.x + 330 * z, stageBox.y + 350 * z]);
    const pixelAt = async (name) => {
      const shot = await page.screenshot({ clip: { x: stageBox.x + 500 * z - 2, y: stageBox.y + 350 * z - 2, width: 4, height: 4 } });
      writeFileSync(`${OUT}/${name}.png`, shot);
      return page.evaluate(async (b64) => {
        const img = await new Promise((ok) => Object.assign(new Image(), { onload() { ok(this); }, src: `data:image/png;base64,${b64}` }));
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return [...g.getImageData(1, 1, 1, 1).data].slice(0, 3);
      }, shot.toString('base64'));
    };
    // 구멍이 투명하다 = 도형을 숨겼을 때와 같은 색 (뒤에 있는 것이 그대로 보임)
    const holePx = await pixelAt('s14-donut-hole');
    await page.evaluate((id) => window.__SLIDELAB__.getState().set({ doc: { ...window.__SLIDELAB__.getState().doc, slides: window.__SLIDELAB__.getState().doc.slides.map((s, i) => (i ? s : { ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, hidden: true } : o)) })) } }), donut.id);
    await page.waitForTimeout(150);
    const behindPx = await pixelAt('s14-donut-behind');
    await page.evaluate((id) => window.__SLIDELAB__.getState().set({ doc: { ...window.__SLIDELAB__.getState().doc, slides: window.__SLIDELAB__.getState().doc.slides.map((s, i) => (i ? s : { ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, hidden: false } : o)) })) } }), donut.id);
    await page.waitForTimeout(150);
    await page.locator('.canvas-viewport').screenshot({ path: `${OUT}/s14-merge-donut.png` });
    check('빼기: 도넛 — 구멍은 비어 있음(클릭 통과·뒤의 것이 그대로 보임), 고리는 도형', donut.geometry.paths[0].cmds.filter((c) => c.c === 'M').length === 2 && hole !== donut.id && ring === donut.id && holePx.every((v, i) => Math.abs(v - behindPx[i]) <= 3), `hole=${hole} ring=${ring} 구멍 ${holePx} / 뒤 ${behindPx}`);
    // 점 편집: 꼭짓점을 끌면 모양·상자가 바뀌고, 실행 취소 한 번에 되돌아감, Esc로 끝
    await page.evaluate((id) => window.__SLIDELAB__.getState().select([id]), donut.id);
    await page.locator('.tab', { hasText: '도형 서식' }).click();
    await page.locator('.rb', { hasText: '점 편집' }).click();
    await page.waitForSelector('[data-point-edit] .pe-point');
    const nPts = await page.locator('[data-point-edit] .pe-point').count();
    const nCtrl = await page.locator('[data-point-edit] .pe-ctrl').count();
    const pt = page.locator('[data-point-edit] .pe-point').first();
    const pb = await pt.boundingBox();
    const g0 = (await objsNow())[0];
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2 - 60 * z, pb.y + pb.height / 2, { steps: 6 });
    await page.mouse.up();
    const g1 = (await objsNow())[0];
    await page.keyboard.press('Control+z');
    const g2 = (await objsNow())[0];
    await page.keyboard.press('Escape');
    const peOff = await page.evaluate(() => window.__SLIDELAB__.getState().editPointsId);
    check('점 편집: 꼭짓점·곡선 조절점 표시, 끌면 모양과 상자가 바뀜, 실행 취소 한 번, Esc로 끝', nPts >= 8 && nCtrl >= 8 && g1.width > g0.width + 30 && JSON.stringify(g1.geometry) !== JSON.stringify(g0.geometry) && JSON.stringify(g2) === JSON.stringify(g0) && peOff === null, `점 ${nPts} 조절점 ${nCtrl} 폭 ${Math.round(g0.width)}→${Math.round(g1.width)}`);
    // 원(프리셋)도 점 편집 → 베지어 자유형으로
    await setup([A]);
    await page.locator('.tab', { hasText: '도형 서식' }).click();
    await page.locator('.rb', { hasText: '점 편집' }).click();
    await page.waitForSelector('[data-point-edit] .pe-ctrl');
    const conv = (await objsNow())[0];
    await page.keyboard.press('Escape');
    check('프리셋 원 → 점 편집 시 같은 모양의 베지어 자유형', conv.shape === 'custom' && conv.geometry.paths[0].cmds.filter((c) => c.c === 'C').length >= 4 && Math.abs(conv.width - 200) < 0.5);
    // 그림이 섞이면 비활성 + 이유
    await page.evaluate(() => {
      const st = window.__SLIDELAB__.getState();
      st.commit('그림 섞기', (d) => d.slides[0].objects.push({ id: 'mgImg', type: 'image', name: '그림', x: 10, y: 10, width: 50, height: 50, rotation: 0, assetId: 'none', crop: { left: 0, top: 0, right: 0, bottom: 0 }, stroke: null, naturalWidth: 50, naturalHeight: 50 }));
      st.set({ selectedIds: ['mgA', 'mgImg'] });
    });
    await page.locator('.tab', { hasText: '도형 서식' }).click();
    const imgBtn = page.locator('.rb', { hasText: '도형 병합' });
    check('그림이 섞이면 도형 병합 비활성 + 이유 안내', (await imgBtn.isDisabled()) && ((await imgBtn.getAttribute('title')) ?? '').includes('그림'));
    // L. 저장 → 새로 고침 → 복잡한 병합 도형(구멍 포함) 그대로
    await setup([{ ...A, id: 'mgBig', name: '큰 원', x: 300, y: 150, width: 400, height: 400 }, { ...B, id: 'mgSmall', name: '작은 원', x: 400, y: 250, width: 200, height: 200 }, { id: 'mgBar', name: '막대', shape: 'rect', x: 250, y: 330, width: 500, height: 40, rotation: 20, fill: { type: 'solid', color: '#222222' } }]);
    await openMerge();
    await page.locator('[data-merge-op="subtract"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged?.op === 'subtract'));
    const saved = await objsNow();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
    await page.reload();
    await page.waitForSelector('[data-testid="slide-stage"]');
    await page.waitForTimeout(500);
    const restored = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.filter((o) => o.merged).map((o) => JSON.parse(JSON.stringify(o))));
    check('새로 고침 후 병합 도형(회전 막대로 잘린 도넛 조각들) 경로 그대로', JSON.stringify(restored) === JSON.stringify(saved) && saved.length >= 1, `${saved.length}개, 하위 경로 ${saved.map((o) => o.geometry.paths[0].cmds.filter((c) => c.c === 'M').length)}`);
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('병합 정리', (d) => (d.slides[0].objects = d.slides[0].objects.filter((o) => !o.id.startsWith('mg') && !o.merged))));
  }

  if (want('merge2')) {
    /* ───── 도형 병합 확장: 텍스트 윤곽·선을 도형으로·그림 자르기·점 추가/삭제·SVG·저사양 성능 ───── */
    await closeBackstage();
    const body = (t, extra = {}) => ({ paragraphs: [{ runs: [{ text: t, ...extra }], align: 'left' }], vAlign: 'top', direction: 'horizontal', padding: { top: 0, right: 0, bottom: 0, left: 0 }, autoFit: 'none' });
    const put = (objs, sel = objs.map((o) => o.id)) =>
      page.evaluate(([objs, sel]) => {
        const st = window.__SLIDELAB__.getState();
        st.commit('준비', (d) => {
          d.slides[0].objects = d.slides[0].objects.filter((o) => !o.id.startsWith('x2') && !o.merged && !String(o.name).includes('윤곽'));
          d.slides[0].objects.push(...objs);
        });
        st.set({ activeSlideId: st.doc.slides[0].id, selectedSlideIds: [st.doc.slides[0].id], selectedIds: sel, editPointsId: null, editPointSel: null });
      }, [objs, sel]);
    const all = () => page.evaluate(() => window.__SLIDELAB__.getState().doc.slides[0].objects.map((o) => JSON.parse(JSON.stringify(o))));
    const fmtTab = () => page.locator('.tab', { hasText: '도형 서식' }).click();
    const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).pop() ?? '');
    // ── 텍스트를 윤곽선으로 (내 글꼴 SlideLab Test Serif) ──
    const T = { id: 'x2T', type: 'text', name: '글자', x: 200, y: 200, width: 400, height: 160, rotation: 0, fill: { type: 'none' }, stroke: null, text: body('Ab', { fontFamily: 'SlideLab Test Serif', fontSize: 96, color: '#C0392B' }) };
    await put([T]);
    await fmtTab();
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ zoom: 1, fitMode: false }));
    await page.waitForTimeout(400);
    const tb = await page.locator('[data-testid="slide-stage"]').boundingBox();
    await page.evaluate(() => window.__SLIDELAB__.getState().select([]));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/s14-text-before.png`, clip: { x: tb.x + 200, y: tb.y + 200, width: 400, height: 160 } });
    await page.evaluate(() => window.__SLIDELAB__.getState().select(['x2T']));
    await page.locator('.rb', { hasText: '텍스트를 윤곽선으로' }).click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => String(o.name).includes('윤곽')), null, { timeout: 15000 });
    const outl = (await all()).filter((o) => String(o.name).includes('윤곽'));
    await page.evaluate(() => window.__SLIDELAB__.getState().select([]));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/s14-text-after.png`, clip: { x: tb.x + 200, y: tb.y + 200, width: 400, height: 160 } });
    const textDiff = await imageDiff(`${OUT}/s14-text-before.png`, `${OUT}/s14-text-after.png`);
    check('텍스트 윤곽이 원래 글자와 같은 자리·모양 (변환 전후 화면 차이 작음)', textDiff.diff < 6, textDiff.diff.toFixed(2));
    await page.evaluate(() => window.__SLIDELAB__.getState().set({ fitMode: true }));
    const textGone = !(await all()).some((o) => o.id === 'x2T');
    const subs = outl[0].geometry.paths[0].cmds.filter((c) => c.c === 'M').length;
    check('텍스트를 윤곽선으로: 글자 색 자유형, 글자 수만큼 이상 윤곽(구멍 포함), 원래 텍스트 상자 대신', outl.length === 1 && outl[0].shape === 'custom' && outl[0].fill.color === '#C0392B' && subs >= 3 && textGone && outl[0].x > 200 && outl[0].x < 260 && outl[0].width > 60 && outl[0].width < 260, `하위 경로 ${subs}, 상자 ${Math.round(outl[0].x)},${Math.round(outl[0].y)} ${Math.round(outl[0].width)}×${Math.round(outl[0].height)} / ${await lastToast()}`);
    // 텍스트 상자 + 사각형 병합(빼기) → 글자 모양이 뚫린 사각형
    await put([{ id: 'x2R', type: 'shape', name: '판', shape: 'rect', x: 180, y: 180, width: 460, height: 200, rotation: 0, fill: { type: 'solid', color: '#1F3864' }, stroke: null, text: body('') }, T]);
    await fmtTab();
    await page.locator('.rb', { hasText: '도형 병합' }).click();
    await page.locator('[data-merge-op="subtract"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged?.op === 'subtract'), null, { timeout: 15000 });
    const stencil = (await all()).find((o) => o.merged?.op === 'subtract');
    check('텍스트 상자와 병합: 사각형 − 글자 = 글자 모양으로 뚫린 판(+ 글자 안 섬), 안내', stencil.geometry.paths[0].cmds.filter((c) => c.c === 'M').length >= 4 && stencil.fill.color === '#1F3864' && (await lastToast()).includes('윤곽선'), `${stencil.geometry.paths[0].cmds.filter((c) => c.c === 'M').length}개 윤곽`);
    // 글꼴 파일이 없으면 바꾸지 않고 안내
    await put([{ ...T, text: body('Zz', { fontFamily: 'No Such Font XYZ', fontSize: 60, color: '#000000' }) }]);
    await fmtTab();
    await page.locator('.rb', { hasText: '텍스트를 윤곽선으로' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('글꼴 파일을 구할 수 없어')), null, { timeout: 15000 });
    const mt = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => t.includes('글꼴 파일을 구할 수 없어')) ?? '');
    check('글꼴 파일이 없는 글자는 바꾸지 않고, 실제로 그려진 글꼴 이름을 안내', (await all()).some((o) => o.id === 'x2T') && !(await all()).some((o) => String(o.name).includes('윤곽')) && /: \S/.test(mt), mt.slice(0, 120));
    // ── 선을 도형으로 ──
    await put([
      { id: 'x2S', type: 'shape', name: '테두리', shape: 'ellipse', x: 200, y: 200, width: 200, height: 200, rotation: 0, fill: { type: 'none' }, stroke: { color: '#2E7D32', width: 9, dash: 'solid' }, text: body('') },
      { id: 'x2L', type: 'line', name: '화살표', x: 500, y: 300, width: 300, height: 0, rotation: 0, stroke: { color: '#6A1B9A', width: 6, dash: 'dash' }, headStart: 'none', headEnd: 'triangle' },
    ]);
    await fmtTab();
    await page.locator('.rb', { hasText: '선을 도형으로' }).click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.filter((o) => String(o.name).includes('윤곽')).length === 2, null, { timeout: 15000 });
    const so = (await all()).filter((o) => String(o.name).includes('윤곽'));
    const ring = so.find((o) => o.fill.color === '#2E7D32'), arrow = so.find((o) => o.fill.color === '#6A1B9A');
    check('선을 도형으로: 원 테두리 → 고리(구멍), 대시 화살표 → 끊긴 조각 + 화살촉, 원본 선 대신', ring.geometry.paths[0].cmds.filter((c) => c.c === 'M').length === 2 && !ring.stroke && arrow.geometry.paths[0].cmds.filter((c) => c.c === 'M').length >= 4 && !(await all()).some((o) => o.id === 'x2L'), `고리 ${ring.geometry.paths[0].cmds.filter((c) => c.c === 'M').length} / 화살 ${arrow.geometry.paths[0].cmds.filter((c) => c.c === 'M').length}`);
    // 선만 고른 병합은 안내
    await put([{ id: 'x2L', type: 'line', name: '선', x: 500, y: 300, width: 300, height: 0, rotation: 0, stroke: { color: '#000000', width: 3, dash: 'solid' }, headStart: 'none', headEnd: 'none' }, { id: 'x2S2', type: 'shape', name: '네모', shape: 'rect', x: 450, y: 250, width: 100, height: 100, rotation: 0, fill: { type: 'solid', color: '#999999' }, stroke: null, text: body('') }]);
    await fmtTab();
    check("선이 섞인 병합은 비활성 + '선을 도형으로' 안내", (await page.locator('.rb', { hasText: '도형 병합' }).isDisabled()) && ((await page.locator('.rb', { hasText: '도형 병합' }).getAttribute('title')) ?? '').includes('선을 도형으로'));
    // ── 그림 ∩ 원: 그림을 원 모양으로 (픽셀 제자리), 모서리는 비어 있음 ──
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 200, 0);
      gr.addColorStop(0, '#ff0000');
      gr.addColorStop(1, '#0000ff');
      g.fillStyle = gr;
      g.fillRect(0, 0, 200, 200);
      return c.toDataURL('image/png');
    });
    await page.evaluate((png) => window.__SLIDELAB__.getState().commit('그림 자산', (d) => (d.assets.x2img = { id: 'x2img', mime: 'image/png', dataUrl: png })), png);
    const IMG = { id: 'x2I', type: 'image', name: '사진', x: 200, y: 150, width: 400, height: 400, rotation: 0, assetId: 'x2img', crop: { left: 0, top: 0, right: 0, bottom: 0 }, stroke: null, naturalWidth: 200, naturalHeight: 200 };
    const C = { id: 'x2C', type: 'shape', name: '원', shape: 'ellipse', x: 300, y: 250, width: 200, height: 200, rotation: 0, fill: { type: 'solid', color: '#000000' }, stroke: null, text: body('') };
    await put([IMG, C]);
    await fmtTab();
    await page.locator('.rb', { hasText: '도형 병합' }).click();
    const unionDisabled = await page.locator('[data-merge-op="union"]').isDisabled();
    await page.locator('[data-merge-op="intersect"]').click();
    await page.waitForFunction(() => !!window.__SLIDELAB__.getState().doc.slides[0].objects.find((o) => o.id === 'x2I')?.clip);
    const ci = (await all()).find((o) => o.id === 'x2I');
    await page.evaluate(() => window.__SLIDELAB__.getState().select([]));
    const sb = await page.locator('[data-testid="slide-stage"]').boundingBox();
    const z = await page.evaluate(() => window.__SLIDELAB__.getState().zoom);
    const hitAt = (x, y) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-obj-id]')?.dataset.objId ?? null, [sb.x + x * z, sb.y + y * z]);
    const centerHit = await hitAt(400, 350), cornerHit = await hitAt(310, 260);
    await page.locator('.canvas-viewport').screenshot({ path: `${OUT}/s14-merge-imgclip.png` });
    check('그림 ∩ 원: 같은 그림 개체가 원 모양으로 (상자 = 원, 자르기 25%), 원 밖 모서리는 클릭 통과, 통합 등은 그림에 비활성', unionDisabled && Math.round(ci.x) === 300 && Math.round(ci.width) === 200 && Math.abs(ci.crop.left - 0.25) < 0.001 && centerHit === 'x2I' && cornerHit !== 'x2I' && !(await all()).some((o) => o.id === 'x2C'), `${Math.round(ci.x)} ${Math.round(ci.width)} crop ${ci.crop.left.toFixed(3)} / 가운데 ${centerHit} 모서리 ${cornerHit}`);
    // PPTX에 custGeom 그림
    await openExport();
    const [dlP] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
    await dlP.saveAs(`${OUT}/s14-merge-imgclip.pptx`);
    const zx = await (await JSZip.loadAsync(readFileSync(`${OUT}/s14-merge-imgclip.pptx`))).file('ppt/slides/slide1.xml').async('string');
    check('PPTX: 원 모양 그림 = p:pic + srcRect + custGeom', /<p:pic[ >](?:(?!<\/p:pic>)[\s\S])*<a:srcRect l="25000" t="25000" r="25000" b="25000"\/>(?:(?!<\/p:pic>)[\s\S])*<a:custGeom>/.test(zx));
    await closeBackstage();
    // ── 점 추가(선 두 번 클릭)·삭제(Delete)·곡선/직선 ──
    const SQ = { id: 'x2Q', type: 'shape', name: '네모', shape: 'rect', x: 300, y: 200, width: 300, height: 200, rotation: 0, fill: { type: 'solid', color: '#90CAF9' }, stroke: { color: '#000000', width: 1, dash: 'solid' }, text: body('') };
    await put([SQ]);
    await fmtTab();
    await page.locator('.rb', { hasText: '점 편집' }).click();
    await page.waitForSelector('[data-point-edit] .pe-point');
    const n0 = await page.locator('[data-point-edit] .pe-point').count();
    // 위쪽 변 가운데(450, 200)를 두 번 클릭 → 점 추가
    await page.mouse.dblclick(sb.x + 450 * z, sb.y + 200 * z);
    await page.waitForFunction((n) => document.querySelectorAll('[data-point-edit] .pe-point').length === n + 1, n0);
    const nAdded = await page.locator('[data-point-edit] .pe-point').count();
    // 추가된 점을 위로 끌기 → 지붕 모양
    const sel = page.locator('[data-point-edit] .pe-point.is-sel');
    const pb2 = await sel.boundingBox();
    await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2 - 80 * z, { steps: 5 });
    await page.mouse.up();
    const roof = (await all()).find((o) => o.id === 'x2Q');
    // 곡선/직선 전환
    await page.locator('.rb', { hasText: '곡선/직선' }).click();
    const curved = (await all()).find((o) => o.id === 'x2Q');
    // Delete로 고른 점 삭제
    await page.keyboard.press('Delete');
    await page.waitForFunction((n) => document.querySelectorAll('[data-point-edit] .pe-point').length === n, n0);
    const nRemoved = await page.locator('[data-point-edit] .pe-point').count();
    await page.keyboard.press('Escape');
    check('점 편집: 선 두 번 클릭 → 점 추가, 끌어 지붕 모양(상자 커짐), 곡선 전환, Delete로 삭제', nAdded === n0 + 1 && roof.height > 270 && curved.geometry.paths[0].cmds.some((c) => c.c === 'C') && nRemoved === n0, `점 ${n0}→${nAdded}→${nRemoved}, 높이 ${Math.round(roof.height)}`);
    // ── SVG 내보내기: 도넛(구멍)·그라데이션·자른 그림이 벡터로, 브라우저로 다시 그려도 구멍이 투명 ──
    await put([
      { id: 'x2big', type: 'shape', name: '큰 원', shape: 'ellipse', x: 300, y: 150, width: 400, height: 400, rotation: 0, fill: { type: 'gradient', angle: 0, stops: [{ offset: 0, color: '#FF8800' }, { offset: 1, color: '#8800FF' }] }, stroke: { color: '#000000', width: 2, dash: 'solid' }, text: body('') },
      { id: 'x2small', type: 'shape', name: '작은 원', shape: 'ellipse', x: 400, y: 250, width: 200, height: 200, rotation: 0, fill: { type: 'solid', color: '#000000' }, stroke: null, text: body('') },
    ]);
    await fmtTab();
    await page.locator('.rb', { hasText: '도형 병합' }).click();
    await page.locator('[data-merge-op="subtract"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.some((o) => o.merged?.op === 'subtract'));
    await openExport();
    await page.locator('select[aria-label="SVG로 내보낼 슬라이드"]').selectOption('current');
    // foreignObject가 든 SVG는 캔버스에 그리면 보안상 픽셀을 못 읽으므로, 새 탭에 띄워 스크린샷으로 확인
    const svgShotOf = async (name) => {
      const f = await download(() => page.locator('[data-export-svg-go]').click(), `${name}.svg`);
      const text = readFileSync(f.path, 'utf8');
      const sp = await context.newPage();
      await sp.setViewportSize({ width: 1280, height: 720 });
      await sp.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${text.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
      await sp.waitForTimeout(300);
      const shot = await sp.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
      writeFileSync(`${OUT}/${name}.png`, shot);
      await sp.close();
      return { text, b64: shot.toString('base64') };
    };
    const pix = (b64) =>
      page.evaluate(async (b64) => {
        const img = await new Promise((ok) => Object.assign(new Image(), { onload() { ok(this); }, src: `data:image/png;base64,${b64}` }));
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
        return { hole: at(500, 350), ring: at(320, 350) };
      }, b64);
    const withDonut = await svgShotOf('s14-merge-svg');
    const svgText = withDonut.text;
    // 구멍이 투명하다 = 도넛을 숨기고 내보낸 SVG의 같은 자리와 같은 색
    await closeBackstage();
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('도넛 숨김', (d) => d.slides[0].objects.forEach((o) => o.merged?.op === 'subtract' && (o.hidden = true))));
    await openExport();
    const noDonut = await svgShotOf('s14-merge-svg-behind');
    await closeBackstage();
    await page.keyboard.press('Control+z');
    await openExport();
    const a = await pix(withDonut.b64), b = await pix(noDonut.b64);
    const svgCheck = await page.evaluate((svg) => {
      const docx = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const donut = [...docx.querySelectorAll('path')].find((p) => (p.getAttribute('d') ?? '').split('M').length - 1 === 2 && (p.getAttribute('fill') ?? '').startsWith('url(#g'));
      return { err: !!docx.querySelector('parsererror'), donut: !!donut, gradient: !!docx.querySelector('linearGradient') };
    }, svgText);
    Object.assign(svgCheck, { hole: a.hole, behind: b.hole, ring: a.ring });
    check('SVG: 도넛 경로(하위 경로 2·그라데이션), 브라우저로 다시 그리면 구멍은 뒤가 비쳐 보이고 고리는 칠해짐', !svgCheck.err && svgCheck.donut && svgCheck.gradient && svgCheck.hole.every((v, i) => Math.abs(v - svgCheck.behind[i]) <= 3) && svgCheck.ring[0] > 150 && svgText.includes('<svg xmlns="http://www.w3.org/2000/svg"'), JSON.stringify(svgCheck));
    await closeBackstage();
    // ── 저사양 기기: CPU 6배 느리게(크롬북급) 원 10개 조각 ──
    const circles = Array.from({ length: 10 }, (_, i) => ({ id: `x2c${i}`, type: 'shape', name: `원${i}`, shape: 'ellipse', x: 150 + i * 80, y: 200 + (i % 2) * 80, width: 180, height: 180, rotation: 0, fill: { type: 'solid', color: '#4FC3F7' }, stroke: null, text: body('') }));
    await put(circles);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await fmtTab();
    await page.locator('.rb', { hasText: '도형 병합' }).click();
    const t0 = Date.now();
    await page.locator('[data-merge-op="fragment"]').click();
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.slides[0].objects.filter((o) => o.merged?.op === 'fragment').length > 10, null, { timeout: 60000 });
    const slowMs = Date.now() - t0;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const pieces = (await all()).filter((o) => o.merged?.op === 'fragment').length;
    check('저사양(CPU 6배 감속): 원 10개 조각 계산이 10초 안에', slowMs < 10000, `${pieces}조각, ${(slowMs / 1000).toFixed(1)}초`);
    await page.evaluate(() => window.__SLIDELAB__.getState().commit('정리', (d) => (d.slides[0].objects = d.slides[0].objects.filter((o) => !o.id.startsWith('x2') && !o.merged && !String(o.name).includes('윤곽')))));
  }

  if (want('perf')) {
    /* ───── 성능: 슬라이드 1000장 ───── */
    await closeBackstage();
    const perf = await page.evaluate(async () => {
      const st = window.__SLIDELAB__.getState();
      const saved = st.doc;
      const base = saved.slides[0];
      const doc = JSON.parse(JSON.stringify(saved));
      doc.id = 'perf-test';
      doc.slides = Array.from({ length: 1000 }, (_, i) => {
        const s = JSON.parse(JSON.stringify(base));
        s.id = `p${i}`;
        s.comments = undefined;
        s.objects = s.objects.filter((o) => o.type === 'text').map((o, k) => ({ ...o, id: `p${i}o${k}`, text: { ...o.text, paragraphs: [{ runs: [{ text: `슬라이드 ${i + 1}` }] }] } }));
        for (let k = 0; k < 8; k++) s.objects.push({ ...JSON.parse(JSON.stringify(s.objects[0])), id: `p${i}x${k}`, x: 50 + k * 60, y: 400, width: 200, height: 60 });
        return s;
      });
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      st.loadDocument(doc);
      await frame();
      const load = performance.now() - t0;
      const sw = [];
      for (let i = 1; i <= 10; i++) {
        const t = performance.now();
        window.__SLIDELAB__.getState().setActiveSlide(`p${i * 90}`);
        await frame();
        sw.push(performance.now() - t);
      }
      const ed = [];
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        window.__SLIDELAB__.getState().commit('편집', (d) => void (d.slides[500].objects[1].x += 1));
        await frame();
        ed.push(performance.now() - t);
      }
      const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
      return { load: Math.round(load), switchMed: Math.round(med(sw)), editMed: Math.round(med(ed)), dom: document.getElementsByTagName('*').length };
    });
    check('슬라이드 1000장: 열기 1.5초 이내, 전환·편집 100ms 이내, DOM 2만 개 이하', perf.load < 1500 && perf.switchMed < 100 && perf.editMed < 100 && perf.dom < 20000, JSON.stringify(perf));
    // 화면 밖 축소판은 아직 그리지 않음 → 아래로 내리면 그림
    await page.evaluate(() => document.querySelector('[data-slide-id="p0"]').scrollIntoView());
    await page.waitForTimeout(300);
    check('화면에서 먼 축소판은 그리지 않음', (await page.locator('[data-slide-id="p999"] .sl-slide').count()) === 0 && (await page.locator('[data-slide-id="p999"] .thumb-placeholder').count()) === 1);
    await page.evaluate(() => document.querySelector('[data-slide-id="p999"]').scrollIntoView());
    await page.waitForFunction(() => !!document.querySelector('[data-slide-id="p999"] .sl-slide'), null, { timeout: 5000 });
    check('맨 아래 축소판 표시', await page.evaluate(() => document.querySelector('[data-slide-id="p999"] .sl-slide')?.textContent.includes('슬라이드 1000')));
  }

  if (want('equation')) {
    // 문서를 바꾸므로 마지막에: LibreOffice가 만든 수식 PPTX 가져오기
    await closeBackstage();
    // LibreOffice가 만든 수식 PPTX 가져오기
    const lo = readFileSync('src/services/math/__fixtures__/lo-equations.pptx').toString('base64');
    await page.evaluate(async (b) => {
      const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'lo-equations.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, lo);
    await page.waitForFunction(() => window.__SLIDELAB__.getState().doc.title === 'lo-equations', null, { timeout: 15000 });
    await page.locator('.dialog .btn.primary').click().catch(() => {});
    const n = await page.evaluate(() => window.__SLIDELAB__.getState().doc.slides.filter((s) => s.objects[0]?.type === 'equation').length);
    await page.waitForFunction(() => !!document.querySelector('[data-testid="slide-stage"] math mfrac'));
    check('LibreOffice PPTX의 수식 12개 → 편집 가능한 수식', n === 12);
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
