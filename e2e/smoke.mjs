/**
 * SlideLab 브라우저 E2E 스모크 테스트 (Playwright + Chromium)
 *
 * 사용법:  npm run build && npx vite preview --port 4173 &  →  node e2e/smoke.mjs [baseURL]
 * 결과 스크린샷과 내보낸 PPTX는 test-output/ 에 저장된다.
 */
import { createRequire } from 'node:module';
// 프로젝트에 @playwright/test가 없으면 전역 설치된 playwright 사용
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** 테스트용 PNG 생성 (200x100, 파란 그라데이션) */
function makePng(w, h) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 30;
      raw[o + 1] = Math.round((x / w) * 200);
      raw[o + 2] = 220;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const state = () => page.evaluate(() => {
  const s = window.__SLIDELAB__.getState();
  return JSON.parse(JSON.stringify({ doc: s.doc, selectedIds: s.selectedIds, activeSlideId: s.activeSlideId, editingTextId: s.editingTextId, past: s.history.past.length, saveStatus: s.saveStatus }));
});
const activeSlide = async () => {
  const s = await state();
  return s.doc.slides.find((x) => x.id === s.activeSlideId);
};
const stageBox = async () => page.locator('[data-testid="slide-stage"]').boundingBox();
const zoom = () => page.evaluate(() => window.__SLIDELAB__.getState().zoom);
const toScreen = async (x, y) => {
  const b = await stageBox();
  const z = await zoom();
  return { x: b.x + x * z, y: b.y + y * z };
};

await page.goto(BASE);
await page.waitForSelector('[data-testid="slide-stage"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-initial.png` });
let s = await state();
check('앱 로드 및 첫 슬라이드 표시', s.doc.slides.length === 1);
check('리본 탭 10개 표시', (await page.locator('.tabs .tab').count()) === 10);

// ── 슬라이드 추가 (Ctrl+M) / 레이아웃 ──
await page.locator('.stage').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+m');
await page.keyboard.press('Control+m');
s = await state();
check('Ctrl+M 슬라이드 추가', s.doc.slides.length === 3, `${s.doc.slides.length}장`);
check('축소판 3개 렌더링', (await page.locator('.slide-panel .thumb').count()) === 3);

// 첫 슬라이드로 이동
await page.locator('.slide-panel .thumb').first().click();

// ── 제목 플레이스홀더에 텍스트 입력 (더블클릭) ──
let slide = await activeSlide();
const title = slide.objects[0];
let p = await toScreen(title.x + title.width / 2, title.y + title.height / 2);
await page.mouse.dblclick(p.x, p.y);
await page.waitForTimeout(100);
await page.keyboard.type('SlideLab 첫 작동 버전');
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+b');
await page.keyboard.press('Control+i');
await page.keyboard.press('Control+e');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
slide = await activeSlide();
const t0 = slide.objects[0].text.paragraphs[0].runs;
check('텍스트 입력이 모델에 반영', t0.map((r) => r.text).join('') === 'SlideLab 첫 작동 버전', JSON.stringify(t0.map((r) => r.text)));
check('편집 중 Ctrl+B 굵게 (마스터 제목 스타일은 보통 → 굵게)', t0.every((r) => r.bold === true));
check('편집 중 Ctrl+I 기울임', t0.every((r) => r.italic === true));
check('편집 중 Ctrl+E 가운데 맞춤', slide.objects[0].text.paragraphs[0].align === 'center');

// ── 텍스트 상자 삽입 (삽입 탭) ──
await page.locator('.tab', { hasText: '삽입' }).click();
await page.locator('.rb', { hasText: '텍스트 상자' }).click();
p = await toScreen(200, 560);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(100);
await page.keyboard.type('두 번째 줄 텍스트');
await page.keyboard.press('Enter');
await page.keyboard.type('세 번째 문단');
await page.keyboard.press('Escape');
slide = await activeSlide();
const tb = slide.objects.find((o) => o.name === '텍스트 상자');
check('텍스트 상자 삽입 + 여러 문단', tb && tb.text.paragraphs.length === 2, tb ? JSON.stringify(tb.text.paragraphs.map((x) => x.runs.map((r) => r.text).join(''))) : 'none');

// 글꼴 크기 변경 (홈 탭, 선택 상태)
await page.locator('.tab', { hasText: '홈' }).click();
const fsInput = page.locator('input.font-size');
await fsInput.fill('32');
await fsInput.press('Enter');
slide = await activeSlide();
const tb2 = slide.objects.find((o) => o.id === tb.id);
check('글꼴 크기 32pt 적용', tb2.text.paragraphs.every((pp) => pp.runs.every((r) => r.fontSize === 32)));

// 가운데 맞춤 버튼
await page.locator('button[title^="가운데 맞춤"]').click();
slide = await activeSlide();
check('가운데 맞춤', slide.objects.find((o) => o.id === tb.id).text.paragraphs.every((pp) => pp.align === 'center'));

// ── 도형 삽입 (드래그로 그리기) ──
await page.locator('.rb', { hasText: '도형' }).first().click();
await page.locator('.sg-item[title="타원"]').click();
const a = await toScreen(800, 300);
const b = await toScreen(1000, 450);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
slide = await activeSlide();
let ell = slide.objects.find((o) => o.type === 'shape' && o.shape === 'ellipse');
check('드래그로 타원 그리기', ell && Math.abs(ell.width - 200) < 3 && Math.abs(ell.height - 150) < 3, ell ? `${ell.width.toFixed(1)}x${ell.height.toFixed(1)}` : 'none');

// 도형 이동
const pastBeforeMove = (await state()).past;
p = await toScreen(ell.x + ell.width / 2, ell.y + ell.height / 2);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
const z = await zoom();
await page.mouse.move(p.x - 100 * z, p.y + 50 * z, { steps: 8 });
await page.mouse.up();
s = await state();
slide = s.doc.slides.find((x) => x.id === s.activeSlideId);
let ell2 = slide.objects.find((o) => o.id === ell.id);
check('도형 드래그 이동', Math.abs(ell2.x - (ell.x - 100)) < 8 && Math.abs(ell2.y - (ell.y + 50)) < 8, `x ${ell.x}→${ell2.x.toFixed(1)}, y ${ell.y}→${ell2.y.toFixed(1)}`);
check('이동은 실행 취소 1단계', s.past === pastBeforeMove + 1);

// 크기 조절 (se 핸들)
const se = page.locator('.handle-se');
const seBox = await se.boundingBox();
await page.mouse.move(seBox.x + 4, seBox.y + 4);
await page.mouse.down();
await page.mouse.move(seBox.x + 4 + 60 * z, seBox.y + 4 + 40 * z, { steps: 6 });
await page.mouse.up();
slide = await activeSlide();
const ell3 = slide.objects.find((o) => o.id === ell.id);
check('핸들로 크기 조절', ell3.width > ell2.width + 40 && ell3.height > ell2.height + 25, `${ell2.width.toFixed(0)}x${ell2.height.toFixed(0)} → ${ell3.width.toFixed(0)}x${ell3.height.toFixed(0)}`);

// 회전 (회전 핸들)
const rot = await page.locator('.handle-rotate').boundingBox();
const cx = (await toScreen(ell3.x + ell3.width / 2, ell3.y + ell3.height / 2));
await page.mouse.move(rot.x + 9, rot.y + 9);
await page.mouse.down();
await page.mouse.move(cx.x + 200, cx.y, { steps: 10 });
await page.mouse.up();
slide = await activeSlide();
const ell4 = slide.objects.find((o) => o.id === ell.id);
check('회전 핸들로 90° 회전', Math.abs(ell4.rotation - 90) < 4, `${ell4.rotation}°`);

// 채우기 색 (속성 창: 단색 → 빨강)
await page.locator('.tab', { hasText: '홈' }).click();
await page.locator('.rb-split', { hasText: '도형 채우기' }).locator('.rb-split-caret').click();
await page.locator('.popover .swatch[title="#FF0000"]').click();
slide = await activeSlide();
check('도형 채우기 색 변경', slide.objects.find((o) => o.id === ell.id).fill.color === '#FF0000');

// ── 실행 취소 / 다시 실행 ──
await page.keyboard.press('Control+z');
slide = await activeSlide();
check('Ctrl+Z 실행 취소 (채우기 복원)', slide.objects.find((o) => o.id === ell.id).fill.color !== '#FF0000');
await page.keyboard.press('Control+z');
slide = await activeSlide();
check('Ctrl+Z 두 번째 (회전 복원)', Math.abs(slide.objects.find((o) => o.id === ell.id).rotation) < 0.5);
await page.keyboard.press('Control+y');
await page.keyboard.press('Control+y');
slide = await activeSlide();
const ell5 = slide.objects.find((o) => o.id === ell.id);
check('Ctrl+Y 다시 실행', ell5.fill.color === '#FF0000' && Math.abs(ell5.rotation - 90) < 4);

// 복사 / 붙여넣기 / 그룹
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
slide = await activeSlide();
check('복사/붙여넣기', slide.objects.filter((o) => o.type === 'shape' && o.shape === 'ellipse').length === 2);
const countBeforeGroup = (await activeSlide()).objects.length;
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+g');
slide = await activeSlide();
check('Ctrl+A, Ctrl+G 그룹화', slide.objects.length === 1 && slide.objects[0].type === 'group');
await page.keyboard.press('Control+Shift+g');
slide = await activeSlide();
check('Ctrl+Shift+G 그룹 해제', slide.objects.length === countBeforeGroup, `${slide.objects.length}/${countBeforeGroup}`);

// ── 이미지 삽입 (파일 선택) ──
writeFileSync(`${OUT}/test-image.png`, makePng(200, 100));
await page.locator('.tab', { hasText: '삽입' }).click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.rb', { hasText: '그림' }).first().click()]);
await chooser.setFiles(`${OUT}/test-image.png`);
await page.waitForFunction(() => {
  const s = window.__SLIDELAB__.getState();
  return s.doc.slides.find((x) => x.id === s.activeSlideId).objects.some((o) => o.type === 'image');
});
slide = await activeSlide();
const img = slide.objects.find((o) => o.type === 'image');
check('이미지 삽입 (비율 유지)', img && Math.abs(img.width / img.height - 2) < 0.01, img ? `${img.width}x${img.height}` : '');
await page.waitForTimeout(200);
check('상황별 탭 "그림 서식" 표시', (await page.locator('.tab-contextual', { hasText: '그림 서식' }).count()) === 1);

// 이미지 투명도 (속성 창 슬라이더)
const slider = page.locator('.properties .slider-field input').last();
await slider.fill('40');
slide = await activeSlide();
check('이미지 투명도 40%', Math.abs((slide.objects.find((o) => o.type === 'image').opacity ?? 1) - 0.6) < 0.01);

await page.screenshot({ path: `${OUT}/02-editing.png` });

// ── 슬라이드 순서 변경 (드래그) / 삭제 ──
s = await state();
const order0 = s.doc.slides.map((x) => x.id);
await page.locator('.slide-panel .thumb').nth(0).dragTo(page.locator('.slide-panel .thumb').nth(2), { targetPosition: { x: 80, y: 80 } });
s = await state();
check('축소판 드래그로 슬라이드 이동', s.doc.slides[2].id === order0[0] || s.doc.slides[1].id === order0[0], s.doc.slides.map((x) => order0.indexOf(x.id)).join(','));
await page.locator('.slide-panel .thumb').nth(1).click();
await page.keyboard.press('Control+d');
s = await state();
check('Ctrl+D 슬라이드 복제', s.doc.slides.length === 4);
await page.locator('.slide-panel .thumb').nth(2).click();
await page.keyboard.press('Delete');
s = await state();
check('Delete로 슬라이드 삭제 (슬라이드 패널 포커스)', s.doc.slides.length === 3);

// 섹션 추가
page.once('dialog', (d) => d.accept('본론'));
await page.locator('.slide-panel .thumb').nth(1).click({ button: 'right' });
await page.locator('.context-menu .menu-item', { hasText: '구역 추가' }).click();
s = await state();
check('구역 추가 (기본 구역 자동 생성)', s.doc.sections.length === 2 && s.doc.sections[1].name === '본론');

// 노트 입력
await page.locator('.notes-input').fill('발표자 노트 테스트');
await page.locator('.stage').click({ position: { x: 3, y: 3 } });
s = await state();
check('발표자 노트 저장', s.doc.slides.find((x) => x.id === s.activeSlideId).notes === '발표자 노트 테스트');

// ── 디자인: 슬라이드 크기 4:3 → 16:9, 테마 ──
await page.locator('.tab', { hasText: '디자인' }).click();
await page.locator('.rb', { hasText: '슬라이드 크기' }).click();
await page.locator('.menu-item', { hasText: '표준 (4:3)' }).click();
s = await state();
check('슬라이드 크기 4:3', s.doc.size.width === 960 && s.doc.size.height === 720);
await page.keyboard.press('Control+z');
s = await state();
check('크기 변경 실행 취소', s.doc.size.width === 1280);
await page.locator('.theme-swatch', { hasText: '해돋이' }).click();
s = await state();
check('테마 적용', s.doc.theme.id === 'sunrise');
await page.screenshot({ path: `${OUT}/03-design.png` });

// ── 자동 저장 → 새로 고침 후 복원 ──
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 5000 });
const before = await state();
await page.reload();
await page.waitForSelector('[data-testid="slide-stage"]');
await page.waitForTimeout(300);
const after = await state();
check('새로 고침 후 IndexedDB에서 복원', after.doc.id === before.doc.id && after.doc.slides.length === before.doc.slides.length && after.doc.theme.id === 'sunrise');
const restoredTitle = after.doc.slides.flatMap((x) => x.objects).some((o) => o.text?.paragraphs?.some((pp) => pp.runs.map((r) => r.text).join('').includes('SlideLab 첫 작동 버전')));
check('복원된 문서에 입력한 텍스트 유지', restoredTitle);

// ── 제목 변경 + PPTX 내보내기 ──
await page.locator('.doc-title-input').fill('SlideLab E2E');
await page.locator('.doc-title-input').press('Enter');
check('문서 제목 변경', (await state()).doc.title === 'SlideLab E2E');
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
const pptxPath = `${OUT}/e2e-export.pptx`;
await download.saveAs(pptxPath);
check('PPTX 다운로드', download.suggestedFilename().endsWith('.pptx'), download.suggestedFilename());
await page.waitForSelector('.bs-warnings');
await page.screenshot({ path: `${OUT}/04-export.png` });
await page.locator('.bs-back').click();

// ── PPTX 가져오기 (python-pptx로 만든 실제 파일) ──
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '열기' }).click();
const [pptxChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.btn', { hasText: 'PowerPoint 파일 열기' }).click()]);
await pptxChooser.setFiles('src/services/import/__fixtures__/sample.pptx');
await page.waitForSelector('.ir-list', { timeout: 15000 });
await page.screenshot({ path: `${OUT}/07-import-report.png` });
check('가져오기 결과 대화 상자 (표/차트 보존 알림)', (await page.locator('.ir-list li', { hasText: '표 1개' }).count()) === 1);
await page.locator('.dialog .btn.primary').click();
s = await state();
check('PPTX 가져오기: 슬라이드 5장, 구역 2개', s.doc.slides.length === 5 && s.doc.sections.length === 2);
check('가져온 문서에 원본 정보 기록', !!s.doc.source?.packageId);
await page.locator('.slide-panel .thumb').nth(3).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/08-imported-slide4.png` });
// 보존된 표 이동
slide = await activeSlide();
const keptTable = slide.objects.find((o) => o.type === 'table');
p = await toScreen(keptTable.x + 20, keptTable.y + 10);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(p.x + 60, p.y + 200, { steps: 6 });
await page.mouse.up();
slide = await activeSlide();
const movedTable = slide.objects.find((o) => o.id === keptTable.id);
check('가져온 표 이동 가능', movedTable.y > keptTable.y + 50);
// 도형 텍스트 편집 (가져온 도형)
await page.locator('.slide-panel .thumb').nth(2).click();
slide = await activeSlide();
const rb = slide.objects.find((o) => o.name === 'RoundBox');
p = await toScreen(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.dblclick(p.x, p.y);
await page.keyboard.press('End');
await page.keyboard.type(' 수정됨');
await page.keyboard.press('Escape');
slide = await activeSlide();
check('가져온 도형의 텍스트 편집', slide.objects.find((o) => o.id === rb.id).text.paragraphs[0].runs.map((r) => r.text).join('').endsWith('수정됨'));
await page.screenshot({ path: `${OUT}/09-imported-slide3.png` });
// 다시 PPTX로 저장
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 5000 });
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
await dl2.saveAs(`${OUT}/e2e-roundtrip.pptx`);
const { default: JSZip } = await import('jszip');
const rz = await JSZip.loadAsync((await import('node:fs')).readFileSync(`${OUT}/e2e-roundtrip.pptx`));
const rs4 = await rz.file('ppt/slides/slide4.xml').async('string');
check('브라우저 왕복 저장: 표·차트 원본 복원', rs4.includes('<a:tbl>') && /<c:chart [^>]*r:id=/.test(rs4) && !rs4.includes('__SLIDELAB_KEEP__'));
check('브라우저 왕복 저장: 전환·애니메이션 유지', rs4.includes('<p:transition') && rs4.includes('<p:timing'));
const rs3 = await rz.file('ppt/slides/slide3.xml').async('string');
check('브라우저 왕복 저장: 편집한 텍스트 반영', rs3.includes('수정됨'));
await page.locator('.bs-back').click();

// ── 슬라이드 쇼 ──
await page.keyboard.press('F5');
await page.waitForSelector('.slideshow');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/05-slideshow.png` });
await page.keyboard.press('ArrowRight');
check('슬라이드 쇼 다음 슬라이드', (await page.locator('.show-counter').textContent()).startsWith('2'));
await page.keyboard.press('b');
check('검은 화면 (B)', (await page.locator('.show-blank.black').count()) === 1);
await page.keyboard.press('b');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Esc로 쇼 종료', (await page.locator('.slideshow').count()) === 0);

// ── 다크 모드 / PWA ──
await page.locator('.tab', { hasText: '보기' }).click();
await page.locator('.rb', { hasText: '다크 모드' }).click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/06-dark.png` });
check('다크 모드', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
await page.locator('.rb', { hasText: '밝은 모드' }).click();

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  return (await fetch(link.href)).json();
});
check('PWA 매니페스트 연결', manifest?.name?.includes('SlideLab') && manifest.icons.length >= 3);
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
});
check('서비스 워커 등록', sw);

// 오프라인 재시작
await page.waitForTimeout(1000);
await context.setOffline(true);
await page.reload();
const offlineOk = await page.waitForSelector('[data-testid="slide-stage"]', { timeout: 8000 }).then(() => true).catch(() => false);
check('오프라인 상태에서 앱 실행 (서비스 워커 캐시)', offlineOk);
await context.setOffline(false);

check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
