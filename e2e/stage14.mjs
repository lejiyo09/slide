/**
 * 14단계 E2E: 그림·PDF 내보내기, 인쇄 (+ 이후 비디오·수식·메모·맞춤법·비교·3D 단계가 이어서 추가됨)
 *   npm run build && npx vite preview --port 4173 &  →  LANG=C.UTF-8 node e2e/stage14.mjs
 *   (LANG 없이 실행하면 Chromium이 한글 파일 이름을 'download'로 바꿈 — 테스트 환경 문제)
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
