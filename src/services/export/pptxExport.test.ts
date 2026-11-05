// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { createPresentation, createShape, createTextBox, createLine, createImage, paragraph } from '../../core/document/factory';
import { addSection, addSlide, groupObjects } from '../../core/commands/commands';
import { buildPptx } from './pptxExport';

// 1x1 빨간 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

export function sampleDoc() {
  let doc = createPresentation('PPTX 내보내기 테스트');
  doc = produce(doc, (d) => {
    const s1 = d.slides[0];
    const title = s1.objects[0];
    if (title.type === 'text') title.text.paragraphs = [paragraph('SlideLab 테스트', { fontSize: 54, bold: true, color: '#C43E1C', fontFamily: 'Arial' }, { align: 'center' })];
    const sub = s1.objects[1];
    if (sub.type === 'text') sub.text.paragraphs = [paragraph('한글 부제목', { fontSize: 24, italic: true, color: '#444444' }, { align: 'center' })];
    s1.notes = '발표자 노트 내용';

    const id2 = addSlide(d, s1.id, 'blank');
    const s2 = d.slides.find((s) => s.id === id2)!;
    const shape = createShape('roundRect', 100, 100, 300, 200);
    shape.text.paragraphs = [paragraph('도형 텍스트', { fontSize: 20, color: '#FFFFFF', underline: true }, { align: 'center' })];
    shape.rotation = 15;
    const star = createShape('star5', 500, 100, 150, 150);
    star.fill = { type: 'solid', color: '#FFC000', opacity: 0.5 };
    const tb = createTextBox({ x: 100, y: 400, width: 500, height: 120, text: '첫째 항목\n둘째 항목' });
    tb.text.paragraphs.forEach((p) => (p.bullet = 'bullet'));
    tb.text.paragraphs[1].runs[0].highlight = '#FFFF00';
    const line = createLine(700, 400, 300, 100, 'triangle');
    line.flipV = true;
    d.assets['img1'] = { id: 'img1', mime: 'image/png', dataUrl: PNG };
    const img = createImage('img1', 1, 1, d.size);
    img.width = 120; img.height = 120; img.x = 1000; img.y = 50; img.opacity = 0.6;
    s2.objects.push(shape, star, tb, line, img);
    s2.background = { fill: { type: 'solid', color: '#F0F4FF' } };

    const id3 = addSlide(d, id2, 'blank');
    const s3 = d.slides.find((s) => s.id === id3)!;
    const g1 = createShape('ellipse', 100, 100, 100, 100);
    const g2 = createShape('rect', 250, 150, 100, 100);
    s3.objects.push(g1, g2);
    groupObjects(d, id3, [g1.id, g2.id]);
    s3.background = { fill: { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#000000' }] } };
    s3.hidden = true;
    addSection(d, id2, '본론');
  });
  return doc;
}

describe('PPTX 내보내기', () => {
  it('유효한 PPTX(ZIP/OOXML) 생성', async () => {
    const doc = sampleDoc();
    const { pptx, warnings } = await buildPptx(doc);
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/export-sample.pptx', buf);

    const zip = await JSZip.loadAsync(buf);
    const files = Object.keys(zip.files);
    expect(files).toContain('[Content_Types].xml');
    expect(files).toContain('ppt/presentation.xml');
    expect(files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(3);
    expect(files.some((f) => f.startsWith('ppt/media/'))).toBe(true);

    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    expect(pres).toContain('cx="12192000"'); // 13.333in * 914400
    expect(pres).toContain('cy="6858000"');

    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(s1).toContain('SlideLab 테스트');
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s2).toContain('prst="roundRect"');
    expect(s2).toContain('prst="star5"');
    expect(s2).toContain('rot="900000"'); // 15도
    expect(s2).toContain('<a:buChar');
    expect(s2).toContain('tailEnd type="triangle"');
    const s3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
    expect(s3).toContain('show="0"');
    expect(warnings.some((w) => w.includes('그라데이션'))).toBe(true);
  });
});
