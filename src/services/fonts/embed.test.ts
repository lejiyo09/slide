import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { createPresentation, paragraph } from '../../core/document/factory';
import { exportPptxBytes } from '../export/pptxExport';
import { importPptx } from '../import/pptxImport';
import { embeddingAllowed, planEmbeddedFonts, slotOf } from './embed';
import { readEot } from './eot';

const fx = (name: string) => new Uint8Array(readFileSync(`src/services/fonts/__fixtures__/${name}`));
const SERIF = 'SlideLab Test Serif';

function docWithFont() {
  return produce(createPresentation('글꼴 포함'), (d) => {
    const t = d.slides[0].objects[0];
    if (t.type === 'text') t.text.paragraphs = [paragraph('Embedded fonts', { fontFamily: SERIF, fontSize: 40 }), paragraph('Bold Italic', { fontFamily: SERIF, bold: true, italic: true })];
  });
}

const sources = [
  { family: SERIF, aliases: ['슬라이드랩 테스트 명조'], weight: 400, italic: false, data: fx('TestSerif-Regular.woff2') },
  { family: SERIF, aliases: ['슬라이드랩 테스트 명조'], weight: 700, italic: true, data: fx('TestSerif-BoldItalic.ttf') },
];

describe('PPTX 포함 글꼴', () => {
  it('스타일 칸과 포함 권한', () => {
    expect([slotOf(400, false), slotOf(700, false), slotOf(300, true), slotOf(800, true)]).toEqual(['regular', 'bold', 'italic', 'boldItalic']);
    const ttf = fx('TestSerif-Regular.ttf');
    expect(embeddingAllowed(ttf)).toBe(true);
    const restricted = ttf.slice();
    // OS/2 fsType = 2 (제한)
    const v = new DataView(restricted.buffer);
    for (let i = 0; i < v.getUint16(4); i++) {
      const o = 12 + i * 16;
      if (String.fromCharCode(...restricted.subarray(o, o + 4)) === 'OS/2') v.setUint16(v.getUint32(o + 8) + 8, 2);
    }
    expect(embeddingAllowed(restricted)).toBe(false);
  });

  it('내보내기: fntdata(EOT) + embeddedFontLst + 관계 + 콘텐츠 형식 → 다시 가져오기', async () => {
    const plan = await planEmbeddedFonts([SERIF, 'Arial'], sources);
    expect(plan.fonts).toHaveLength(1);
    expect(Object.keys(plan.fonts[0].faces).sort()).toEqual(['boldItalic', 'regular']);
    const { bytes } = await exportPptxBytes(docWithFont(), { embeddedFonts: plan.fonts });
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/embedded-fonts.pptx', bytes);
    const zip = await JSZip.loadAsync(bytes);
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    expect(pres).toContain('embedTrueTypeFonts="1"');
    expect(pres).toMatch(/<p:embeddedFontLst><p:embeddedFont><p:font typeface="SlideLab Test Serif"\/><p:regular r:id="(rIdFont\d+)"\/><p:boldItalic r:id="rIdFont\d+"\/><\/p:embeddedFont><\/p:embeddedFontLst>/);
    // 스키마 순서: notesSz 다음
    expect(pres.indexOf('<p:embeddedFontLst')).toBeGreaterThan(pres.indexOf('<p:notesSz'));
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
    expect(rels).toMatch(/Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/font" Target="fonts\/font1.fntdata"/);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('<Default Extension="fntdata" ContentType="application/x-fontdata"/>');
    const eot = readEot(await zip.file('ppt/fonts/font1.fntdata')!.async('uint8array'));
    expect(eot).toMatchObject({ familyName: SERIF, styleName: 'Regular', compressed: false });

    const back = await importPptx(bytes, 'embedded-fonts.pptx');
    expect(back.fonts.map((f) => [f.family, f.weight, f.italic])).toEqual([
      [SERIF, 400, false],
      [SERIF, 700, true],
    ]);
    expect(back.fonts[1].ttf).toEqual(fx('TestSerif-BoldItalic.ttf'));
    expect(back.doc.embedFonts).toBe(true);
    expect(back.report.embeddedFonts).toEqual([SERIF]);
  });

  it('PowerPoint가 만든 MTX 압축 포함 글꼴(Boldonse) 가져오기', async () => {
    const r = await importPptx(fx('Boldonse.pptx'), 'Boldonse.pptx');
    expect(r.fonts).toHaveLength(1);
    expect(r.fonts[0]).toMatchObject({ family: 'Boldonse', weight: 400, italic: false });
    expect(r.fonts[0].ttf.length).toBeGreaterThan(70000);
    expect(r.report.embeddedFonts).toEqual(['Boldonse']);
  });

  it('포함 글꼴이 없는 문서는 그대로', async () => {
    const plan = await planEmbeddedFonts(['Arial'], sources);
    expect(plan.fonts).toEqual([]);
    const { bytes } = await exportPptxBytes(docWithFont(), { embeddedFonts: plan.fonts });
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('ppt/presentation.xml')!.async('string')).not.toContain('embeddedFontLst');
    expect(Object.keys(zip.files).some((f) => f.endsWith('.fntdata'))).toBe(false);
  });
});
