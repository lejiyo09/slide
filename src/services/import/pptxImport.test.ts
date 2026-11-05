import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importPptx, summarizeReport } from './pptxImport';
import type { SlideObject } from '../../types/model';

const fixture = () => readFileSync('src/services/import/__fixtures__/sample.pptx');
const textOf = (o: SlideObject | undefined) => (o && (o.type === 'text' || o.type === 'shape') ? o.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '');

describe('PPTX 가져오기 (python-pptx로 만든 실제 파일)', () => {
  it('슬라이드 크기·순서·구역·숨김·노트', async () => {
    const { doc, report } = await importPptx(fixture(), 'sample.pptx');
    expect(doc.size.width).toBeCloseTo(1280, 0);
    expect(doc.size.height).toBeCloseTo(720, 0);
    expect(doc.slides).toHaveLength(5);
    expect(report.slides).toBe(5);
    expect(doc.sections.map((s) => s.name)).toEqual(['도입', '본문']);
    expect(doc.sections[1].startSlideId).toBe(doc.slides[2].id);
    expect(doc.slides[4].hidden).toBe(true);
    expect(doc.slides[0].notes).toBe('첫 슬라이드 노트');
    expect(doc.title).toBe('sample');
  });

  it('개체 틀 텍스트와 상속된 서식', async () => {
    const { doc } = await importPptx(fixture());
    const [title, sub] = doc.slides[0].objects;
    expect(textOf(title)).toBe('가져오기 테스트 제목');
    expect(textOf(sub)).toBe('부제목 텍스트');
    // tx1 + tint 75% (선형 RGB에서 적용) → 회색 #898989
    expect(sub.type === 'text' && sub.text.paragraphs[0].runs[0].color).toBe('#898989');
    // 기본 템플릿 제목 스타일: 44pt (마스터 titleStyle)
    expect(title.type === 'text' && title.text.paragraphs[0].runs[0].fontSize).toBe(44);
    expect(title.width).toBeGreaterThan(100);
    const body = doc.slides[1].objects[1];
    expect(body.type).toBe('text');
    if (body.type !== 'text') return;
    const ps = body.text.paragraphs;
    expect(ps.map((p) => p.level)).toEqual([0, 1, 0]);
    expect(ps[0].bullet).toBe('bullet'); // 마스터 bodyStyle의 buChar
    expect(ps[1].bulletChar).toBe('–');
    const bold = ps[2].runs.find((r) => r.text.startsWith('굵은'))!;
    expect(bold).toMatchObject({ bold: true, color: '#C00000', fontSize: 28 });
    expect(ps[2].runs.find((r) => r.text === '기울임')).toMatchObject({ italic: true, underline: true });
  });

  it('도형·선·그룹·텍스트 상자·그림', async () => {
    const { doc } = await importPptx(fixture());
    const objs = doc.slides[2].objects;
    const box = objs.find((o) => o.name === 'RoundBox')!;
    expect(box).toMatchObject({ type: 'shape', shape: 'roundRect', rotation: 30 });
    if (box.type !== 'shape') return;
    expect(box.fill).toEqual({ type: 'solid', color: '#4472C4', opacity: 0.5 });
    expect(box.stroke).toMatchObject({ color: '#1F3864', width: 2 });
    expect(textOf(box)).toBe('도형 안 텍스트');
    expect(box.text.paragraphs[0].align).toBe('center');
    const star = objs.find((o) => o.type === 'shape' && o.shape === 'star5')!;
    expect(star.type === 'shape' && star.fill.type).toBe('gradient');
    const line = objs.find((o) => o.type === 'line')!;
    expect(line).toMatchObject({ headEnd: 'triangle' });
    expect(line.type === 'line' && line.stroke).toMatchObject({ color: '#ED7D31', width: 3 });
    const grp = objs.find((o) => o.type === 'group')!;
    expect(grp.type === 'group' && grp.children).toHaveLength(2);
    expect(grp.x).toBeCloseTo(9 * 96, 0);
    if (grp.type === 'group') expect(grp.children[1].x).toBeCloseTo(1.5 * 96, 0);
    const tb = objs.find((o) => textOf(o).includes('Arial 20'))!;
    expect(tb.type === 'text' && tb.text.paragraphs[0].runs[0]).toMatchObject({ fontFamily: 'Arial', fontSize: 20 });
    const pic = objs.find((o) => o.type === 'image')!;
    expect(pic.type === 'image' && pic.crop.left).toBeCloseTo(0.1, 3);
    expect(pic.type === 'image' && pic.crop.right).toBeCloseTo(0.2, 3);
    expect(pic.type === 'image' && doc.assets[pic.assetId].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('표·차트를 편집 가능한 개체로 변환 (원본 XML·지문 보관), 전환·애니메이션 보존', async () => {
    const { doc, report } = await importPptx(fixture());
    const s4 = doc.slides[3];
    const table = s4.objects.find((o) => o.type === 'table');
    const chart = s4.objects.find((o) => o.type === 'chart');
    expect(table?.type).toBe('table');
    expect(chart?.type).toBe('chart');
    if (table?.type !== 'table' || chart?.type !== 'chart') return;
    expect(table.columns).toHaveLength(3);
    expect(table.rows[1].cells.map((c) => c.text.paragraphs[0].runs.map((r) => r.text).join(''))).toEqual(['R1C0', 'R1C1', 'R1C2']);
    // 기본 표 스타일(보통 스타일 2 - 강조 1) 근사: 머리글 행은 강조색, 굵은 흰 글자
    expect(table.rows[0].cells[0].fill.type).toBe('solid');
    expect(table.rows[0].cells[0].text.paragraphs[0].runs[0]).toMatchObject({ bold: true, color: '@light1' });
    expect(table.preserved?.xml).toContain('a:tbl');
    expect(chart).toMatchObject({ chartType: 'column', categories: ['1분기', '2분기', '3분기'] });
    expect(chart.series[0]).toMatchObject({ name: '매출', values: [10, 25, 18] });
    expect(chart.preserved?.xml).toMatch(/r:id="rId\d+"/);
    expect(chart.preserved?.part).toBe('ppt/slides/slide4.xml');
    expect(s4.source?.transitionXml).toContain('fade');
    expect(s4.source?.timingXml).toContain('spTgt');
    expect(report.converted).toMatchObject({ table: 1, chart: 1 });
    expect(report.unsupported).toEqual({});
    expect(summarizeReport(report).some((l) => l.includes('표 1개'))).toBe(true);
    const animated = s4.objects.find((o) => o.name === 'Animated')!;
    expect(s4.source?.timingXml).toContain(`spid="${animated.sourceId}"`);
  });

  it('테마 색과 레이아웃 정의', async () => {
    const { doc } = await importPptx(fixture());
    expect(doc.theme.colors.accent1).toBe('#4F81BD'); // python-pptx 기본 템플릿(Office 2007 테마)
    expect(Object.keys(doc.layouts ?? {}).length).toBeGreaterThan(0);
    expect(doc.layouts?.[doc.slides[0].layout]).toBeTruthy();
  });
});

describe('PPTX 가져오기 (LibreOffice가 작성한 파일)', () => {
  const lo = () => readFileSync('src/services/import/__fixtures__/libreoffice.pptx');
  it('다른 제작 도구의 XML 구조도 해석', async () => {
    const { doc, report } = await importPptx(lo(), 'libreoffice.pptx');
    expect(doc.slides.length).toBeGreaterThanOrEqual(4);
    expect(report.warnings).toEqual([]);
    const all = doc.slides.flatMap((s) => s.objects);
    const texts = all.map(textOf).join('\n');
    expect(texts).toContain('가져오기 테스트 제목');
    expect(texts).toContain('하위 항목');
    expect(texts).toContain('도형 안 텍스트');
    expect(all.some((o) => o.type === 'image')).toBe(true);
    expect(doc.size.width).toBeCloseTo(1280, 0);
  });
  it('LibreOffice 파일 왕복 저장', async () => {
    const { exportPptxBytes } = await import('../export/pptxExport');
    const src = lo();
    const { doc } = await importPptx(src, 'libreoffice.pptx');
    const { bytes } = await exportPptxBytes(doc, { sourcePackage: src });
    const again = await importPptx(bytes, 'again.pptx');
    expect(again.doc.slides.length).toBe(doc.slides.length);
    expect(again.report.unsupported).toEqual(doc.slides.length ? again.report.unsupported : {});
    const t1 = doc.slides.flatMap((s) => s.objects).map(textOf).join('|');
    const t2 = again.doc.slides.flatMap((s) => s.objects).map(textOf).join('|');
    expect(t2.split('|')).toEqual(t1.split('|'));
  });
});

describe('차트 종류별 가져오기 (python-pptx)', () => {
  const src = () => readFileSync('src/services/import/__fixtures__/charts.pptx');
  it('세로/가로 누적/꺾은선/원형/도넛/영역/분산형 → 편집 가능, 방사형 → 보존', async () => {
    const { doc, report } = await importPptx(src(), 'charts.pptx');
    const charts = doc.slides.map((s) => s.objects.find((o) => o.type === 'chart' || o.type === 'unsupported')!);
    const types = charts.map((c) => (c.type === 'chart' ? `${c.chartType}${c.stacked ? '+stacked' : ''}` : `keep:${c.type === 'unsupported' && c.kind}`));
    expect(types).toEqual(['column', 'bar+stacked', 'line', 'pie', 'doughnut', 'area', 'keep:chart', 'scatter']);
    const col = charts[0];
    expect(col.type === 'chart' && col.series.map((s) => s.values)).toEqual([[3, 5, 2, 6], [4, 1, 5, 2]]);
    expect(col.type === 'chart' && col.categories).toEqual(['가', '나', '다', '라']);
    expect(col.type === 'chart' && col.legendPos).toBe('b');
    const sc = charts[7];
    expect(sc.type === 'chart' && sc.series[0].xValues).toEqual([1, 2, 3.5, 5]);
    expect(sc.type === 'chart' && sc.series[0].values).toEqual([2.5, 3.1, 1.2, 4.4]);
    expect(report.converted.chart).toBe(7);
    expect(report.unsupported.chart).toBe(1);
  });
});

describe('마스터/레이아웃 가져오기 (9단계)', () => {
  it('첫 마스터 → doc.master, 레이아웃 전체(마스터 순서), 개체 틀 연결', async () => {
    const { doc } = await importPptx(fixture());
    expect(doc.master?.kind).toBe('master');
    const masterPhs = doc.master!.objects.filter((o) => o.type === 'text' && o.ph).map((o) => (o as { ph: { type: string } }).ph.type);
    expect(masterPhs).toEqual(expect.arrayContaining(['title', 'body']));
    // python-pptx 기본 템플릿은 레이아웃 11개
    expect(doc.layoutOrder).toHaveLength(11);
    expect(doc.layouts![doc.layoutOrder![0]].kind).toBe('layout');
    const title = doc.slides[0].objects[0];
    expect(title.type === 'text' && title.ph?.type).toBe('ctrTitle');
    const body = doc.slides[1].objects[1];
    expect(body.type === 'text' && body.ph).toMatchObject({ type: 'body', idx: 1 });
    // 레이아웃 개체 틀도 ph로 연결되어 마스터 편집이 전파될 수 있음
    const lay = doc.layouts![doc.slides[1].layout];
    expect(lay.objects.some((o) => o.type === 'text' && o.ph?.type === 'title')).toBe(true);
  });
});
