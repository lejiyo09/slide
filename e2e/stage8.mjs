/**
 * 8단계 E2E: 표·차트·미디어·링크·아이콘 (Playwright + Chromium)
 *   npm run build && npx vite preview --port 4173 &  →  node e2e/stage8.mjs
 * 동영상/오디오 테스트 파일은 ffmpeg가 있으면 생성, 없으면 해당 단계를 건너뛴다.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

let haveMedia = false;
try {
  execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=2:size=320x180:rate=15 -c:v libvpx -b:v 200k ${OUT}/e2e-video.webm`);
  execSync(`ffmpeg -loglevel error -y -f lavfi -i sine=frequency=660:duration=1 ${OUT}/e2e-audio.wav`);
  haveMedia = existsSync(`${OUT}/e2e-video.webm`);
} catch {
  console.log('ffmpeg 없음: 미디어 단계 생략');
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const state = () => page.evaluate(() => JSON.parse(JSON.stringify((({ doc, selectedIds, activeSlideId, editingTextId, editingCell, cellSelection }) => ({ doc, selectedIds, activeSlideId, editingTextId, editingCell, cellSelection }))(window.__SLIDELAB__.getState()))));
const activeSlide = async () => {
  const s = await state();
  return s.doc.slides.find((x) => x.id === s.activeSlideId);
};
const cellText = (t, r, c) => t.rows[r].cells[c].text.paragraphs.map((p) => p.runs.map((x) => x.text).join('')).join('\n');
const cellBox = (r, c) => page.locator(`td[data-cell="${r},${c}"]`).first().boundingBox();

await page.goto(BASE);
await page.waitForSelector('[data-testid="slide-stage"]');
// 빈 슬라이드에서 시작
await page.locator('.stage').click({ position: { x: 3, y: 3 } });
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');

// ── 표 삽입 (격자에서 4열×3행) ──
await page.locator('.tab', { hasText: '삽입' }).click();
await page.locator('.rb', { hasText: '표' }).first().click();
await page.locator('.tp-cell').nth(2 * 10 + 3).click(); // 3행 4열
let slide = await activeSlide();
let table = slide.objects.find((o) => o.type === 'table');
check('표 삽입 (3행×4열)', table && table.rows.length === 3 && table.columns.length === 4);
check('상황별 탭 "표 디자인"/"레이아웃" 표시', (await page.locator('.tab-contextual', { hasText: '표 디자인' }).count()) === 1 && (await page.locator('.tab-contextual', { hasText: '레이아웃' }).count()) === 1);

// 셀 클릭 → 입력, Tab으로 다음 셀
let b = await cellBox(0, 0);
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForTimeout(100);
await page.keyboard.type('제품');
await page.keyboard.press('Tab');
await page.waitForTimeout(100);
await page.keyboard.type('1분기');
await page.keyboard.press('Tab');
await page.waitForTimeout(100);
await page.keyboard.type('2분기');
await page.keyboard.press('Escape');
slide = await activeSlide();
table = slide.objects.find((o) => o.type === 'table');
check('셀 입력 + Tab 이동', cellText(table, 0, 0) === '제품' && cellText(table, 0, 1) === '1분기' && cellText(table, 0, 2) === '2분기', [0, 1, 2].map((c) => cellText(table, 0, c)).join('|'));

// 마지막 셀에서 Tab → 행 추가
b = await cellBox(2, 3);
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForTimeout(100);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
await page.keyboard.type('새 행');
await page.keyboard.press('Escape');
slide = await activeSlide();
table = slide.objects.find((o) => o.type === 'table');
check('마지막 셀에서 Tab → 행 추가', table.rows.length === 4 && cellText(table, 3, 0) === '새 행', `${table.rows.length}행`);

// 셀 범위 드래그 선택 → 병합
const a1 = await cellBox(1, 0);
const a2 = await cellBox(2, 1);
await page.mouse.move(a1.x + 10, a1.y + 10);
await page.mouse.down();
await page.mouse.move(a2.x + a2.width - 10, a2.y + a2.height - 10, { steps: 6 });
await page.mouse.up();
let s = await state();
check('드래그로 셀 범위 선택', s.cellSelection && Math.abs(s.cellSelection.r2 - s.cellSelection.r1) === 1 && Math.abs(s.cellSelection.c2 - s.cellSelection.c1) === 1);
await page.locator('.tab-contextual', { hasText: '레이아웃' }).click();
await page.locator('.rb', { hasText: '셀 병합' }).click();
slide = await activeSlide();
table = slide.objects.find((o) => o.type === 'table');
check('셀 병합 (2×2)', table.rows[1].cells[0].colSpan === 2 && table.rows[1].cells[0].rowSpan === 2 && table.rows[2].cells[1].merged === true);
await page.locator('.rb', { hasText: '오른쪽에 삽입' }).click();
slide = await activeSlide();
table = slide.objects.find((o) => o.type === 'table');
check('열 삽입', table.columns.length === 5);
await page.keyboard.press('Control+z');
slide = await activeSlide();
check('표 편집 실행 취소', slide.objects.find((o) => o.type === 'table').columns.length === 4);

// 표 디자인: 스타일, 테두리
await page.locator('.tab-contextual', { hasText: '표 디자인' }).click();
await page.locator('.ts-item[title="표 눈금"]').click();
slide = await activeSlide();
table = slide.objects.find((o) => o.type === 'table');
check('표 스타일 변경 (표 눈금)', table.style.preset === 'grid' && table.rows[2].cells[2].borders.left !== null);
await page.screenshot({ path: `${OUT}/s8-01-table.png` });

// 표 이동 (처음 클릭 = 선택+이동)
await page.locator('.stage').click({ position: { x: 3, y: 3 } });
b = await cellBox(3, 3);
const before = (await activeSlide()).objects.find((o) => o.type === 'table');
await page.mouse.move(b.x + 5, b.y + 5);
await page.mouse.down();
await page.mouse.move(b.x + 5, b.y + 120, { steps: 6 });
await page.mouse.up();
const after = (await activeSlide()).objects.find((o) => o.type === 'table');
check('표 드래그 이동', after.y > before.y + 50);

// ── 차트 삽입 + 데이터 편집 ──
await page.keyboard.press('Control+m');
await page.locator('.tab', { hasText: '삽입' }).click();
await page.locator('.rb', { hasText: '차트' }).first().click();
await page.locator('.menu-item', { hasText: '세로 막대형' }).click();
await page.waitForSelector('.chart-editor');
check('차트 삽입 시 데이터 편집기 열림', (await page.locator('.chart-editor').count()) === 1);
const firstVal = page.locator('.ce-grid input[aria-label="2행 2열"]');
await firstVal.fill('9');
await page.locator('.ce-grid input[aria-label="2행 1열"]').fill('서울');
await page.locator('.ce-grid input[aria-label="1행 2열"]').fill('매출');
await page.locator('.dialog .btn.primary', { hasText: '적용' }).click();
slide = await activeSlide();
let chart = slide.objects.find((o) => o.type === 'chart');
check('차트 데이터 편집 반영', chart.series[0].name === '매출' && chart.series[0].values[0] === 9 && chart.categories[0] === '서울');
check('차트 SVG 렌더링', (await page.locator('.sl-obj-chart svg rect').count()) > 5);
// 붙여넣기(TSV) 테스트
await page.locator('.tab-contextual', { hasText: '차트 디자인' }).click();
await page.locator('.rb', { hasText: '데이터 편집' }).click();
await page.locator('.ce-grid input[aria-label="2행 1열"]').focus();
await page.evaluate(() => {
  const el = document.activeElement;
  const dt = new DataTransfer();
  dt.setData('text/plain', 'A\t1\t2\t3\nB\t4\t5\t6\n');
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.locator('.dialog .btn.primary', { hasText: '적용' }).click();
slide = await activeSlide();
chart = slide.objects.find((o) => o.type === 'chart');
check('Excel 형식(탭 구분) 붙여넣기', chart.categories.slice(0, 2).join(',') === 'A,B' && chart.series[2].values[1] === 6, `${chart.categories} / ${chart.series.map((x) => x.values)}`);
// 종류 변경
await page.locator('.rb', { hasText: '차트 종류 변경' }).click();
await page.locator('.menu-item', { hasText: '원형' }).click();
slide = await activeSlide();
check('차트 종류 변경 (원형)', slide.objects.find((o) => o.type === 'chart').chartType === 'pie');
check('원형 차트 렌더링', (await page.locator('.sl-obj-chart svg path').count()) >= 3);
await page.screenshot({ path: `${OUT}/s8-02-chart.png` });

// ── 링크 (텍스트) ──
await page.keyboard.press('Control+m');
await page.locator('.tab', { hasText: '삽입' }).click();
await page.locator('.rb', { hasText: '텍스트 상자' }).click();
const st = await page.locator('[data-testid="slide-stage"]').boundingBox();
await page.mouse.click(st.x + 100, st.y + 100);
await page.keyboard.type('공식 사이트');
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+k');
await page.locator('.dialog input').fill('https://example.com/');
await page.locator('.dialog .btn.primary', { hasText: '삽입' }).click();
await page.keyboard.press('Escape');
slide = await activeSlide();
const linkRun = slide.objects.flatMap((o) => o.text?.paragraphs ?? []).flatMap((p) => p.runs).find((r) => r.link);
check('텍스트에 하이퍼링크 (선택 영역 전체)', linkRun?.link === 'https://example.com/' && linkRun.underline === true && linkRun.text === '공식 사이트', JSON.stringify(linkRun));

// ── 아이콘 ──
await page.locator('.rb', { hasText: '아이콘' }).click();
await page.waitForSelector('.ip-item', { timeout: 15000 });
await page.locator('.ip-bar input.pp-input').fill('rocket');
await page.locator('.ip-item[title="Rocket"]').click();
slide = await activeSlide();
const icon = slide.objects.find((o) => o.type === 'image' && o.name.includes('Rocket'));
s = await state();
check('아이콘 삽입 (SVG)', !!icon && s.doc.assets[icon.assetId].mime === 'image/svg+xml');

// ── 미디어 ──
if (haveMedia) {
  await page.locator('.tab', { hasText: '삽입' }).click();
  const [vc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.rb', { hasText: '비디오' }).click()]);
  await vc.setFiles(`${OUT}/e2e-video.webm`);
  await page.waitForFunction(() => {
    const s = window.__SLIDELAB__.getState();
    return s.doc.slides.find((x) => x.id === s.activeSlideId).objects.some((o) => o.type === 'media');
  }, null, { timeout: 15000 });
  slide = await activeSlide();
  const video = slide.objects.find((o) => o.type === 'media');
  s = await state();
  check('비디오 삽입 (IndexedDB 저장, 문서에는 참조만)', video.kind === 'video' && !!s.doc.assets[video.assetId].blobKey && s.doc.assets[video.assetId].dataUrl === '');
  check('비디오 표지 이미지 생성', !!video.posterId);
  check('상황별 탭 "재생"', (await page.locator('.tab-contextual', { hasText: '재생' }).count()) === 1);
  await page.locator('.tab', { hasText: '삽입' }).click();
  const [ac] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.rb', { hasText: '오디오' }).click()]);
  await ac.setFiles(`${OUT}/e2e-audio.wav`);
  await page.waitForFunction(() => {
    const s = window.__SLIDELAB__.getState();
    return s.doc.slides.find((x) => x.id === s.activeSlideId).objects.some((o) => o.type === 'media' && o.kind === 'audio');
  });
  check('오디오 삽입', true);
  await page.screenshot({ path: `${OUT}/s8-03-media.png` });
  // 슬라이드 쇼에서 비디오 재생 가능
  await page.keyboard.press('Shift+F5');
  await page.waitForSelector('.slideshow video', { timeout: 5000 });
  const playable = await page.evaluate(async () => {
    const v = document.querySelector('.slideshow video');
    await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
    return { controls: v.controls, duration: v.duration };
  });
  check('슬라이드 쇼: 비디오 컨트롤 + 메타데이터 로드', playable.controls && playable.duration > 1, JSON.stringify(playable));
  check('슬라이드 쇼: 링크 표시', (await page.locator('.slideshow [data-link]').count()) >= 1);
  await page.keyboard.press('Escape');
}

// ── 새로 고침 후 복원 (미디어 포함) ──
await page.waitForFunction(() => window.__SLIDELAB__.getState().saveStatus === 'saved', null, { timeout: 8000 });
await page.reload();
await page.waitForSelector('[data-testid="slide-stage"]');
s = await state();
const all = s.doc.slides.flatMap((x) => x.objects);
check('새로 고침 후 표·차트·미디어 복원', all.some((o) => o.type === 'table') && all.some((o) => o.type === 'chart') && (!haveMedia || all.some((o) => o.type === 'media')));

// ── PPTX 내보내기 ──
await page.locator('.doc-title-input').fill('Stage8');
await page.locator('.doc-title-input').press('Enter');
await page.locator('.tab-file').click();
await page.locator('.bs-nav-item', { hasText: '내보내기' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.bs-export-item', { hasText: 'PowerPoint' }).click()]);
await dl.saveAs(`${OUT}/s8-export.pptx`);
const zip = await JSZip.loadAsync(readFileSync(`${OUT}/s8-export.pptx`));
const slideXml = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f).async('string')));
const joined = slideXml.join('\n');
check('내보내기: 표 (병합 포함)', joined.includes('<a:tbl>') && joined.includes('gridSpan="2"') && joined.includes('제품'));
check('내보내기: 차트 파트 + 내장 Excel', Object.keys(zip.files).some((f) => f.startsWith('ppt/charts/chart')) && Object.keys(zip.files).some((f) => f.startsWith('ppt/embeddings/')));
check('내보내기: 하이퍼링크', joined.includes('hlinkClick'));
if (haveMedia) check('내보내기: 비디오/오디오 파트', Object.keys(zip.files).some((f) => /ppt\/media\/.*\.(webm|wav)$/.test(f)), Object.keys(zip.files).filter((f) => f.startsWith('ppt/media')).join(','));

check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
