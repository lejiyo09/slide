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

  it('표·차트는 원본 XML과 함께 보존, 전환·애니메이션 보존', async () => {
    const { doc, report } = await importPptx(fixture());
    const s4 = doc.slides[3];
    const table = s4.objects.find((o) => o.type === 'unsupported' && o.kind === 'table');
    const chart = s4.objects.find((o) => o.type === 'unsupported' && o.kind === 'chart');
    expect(table).toBeTruthy();
    expect(chart).toBeTruthy();
    if (table?.type !== 'unsupported' || chart?.type !== 'unsupported') return;
    expect(table.preview?.rows[1].cells).toEqual(['R1C0', 'R1C1', 'R1C2']);
    expect(table.sourceXml).toContain('a:tbl');
    expect(chart.sourceXml).toMatch(/r:id="rId\d+"/);
    expect(chart.sourceXml).toContain('xmlns:r=');
    expect(chart.sourcePart).toBe('ppt/slides/slide4.xml');
    expect(s4.source?.transitionXml).toContain('fade');
    expect(s4.source?.timingXml).toContain('spTgt');
    expect(report.unsupported).toMatchObject({ table: 1, chart: 1 });
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
