import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { latexToMathml } from './equation';
import { mathmlToOmml, ommlToLatex, plainMathChar, sanitizeMathml, tidyLatex } from './omml';
import { importPptx } from '../import/pptxImport';
import { exportPptxBytes } from '../export/pptxExport';
import { createPresentation } from '../../core/document/factory';
import type { EquationObject } from '../../types/model';

const FORMULAS = [
  '\\frac{a+b}{c-d}',
  '\\sqrt{x^{2}+y^{2}}',
  '\\sqrt[3]{x}',
  '\\sum_{i=1}^{n} i^{2}',
  '\\int_{0}^{1} f(x)\\,dx',
  'x_{ij}',
  '\\left( \\frac{1}{2} \\right)',
  '\\left(\\begin{matrix}a & b\\\\ c & d\\end{matrix}\\right)',
  '\\hat{x}+\\bar{y}',
  '\\lim_{n\\to\\infty} a_{n}',
  '\\alpha\\beta\\le\\gamma',
  '\\sin\\theta',
];

const omml = (latex: string) => mathmlToOmml(latexToMathml(latex).mathml);
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml').documentElement;
/** 구조 서명: m: 요소 이름 + 글자 (속성·a:rPr 제외) */
function signature(xml: string): string {
  const walk = (e: Element): string => {
    if (e.namespaceURI !== 'http://schemas.openxmlformats.org/officeDocument/2006/math') return '';
    if (e.localName.endsWith('Pr')) return '';
    if (e.localName === 't') return [...(e.textContent ?? '')].map(plainMathChar).join('').replace(/[⁡-⁣]/g, '');
    return `${e.localName}(${Array.from(e.children).map(walk).join('')})`;
  };
  return walk(parse(xml));
}

describe('LaTeX → MathML → OMML', () => {
  it('구조별 OMML 요소', () => {
    const o = FORMULAS.map(omml);
    expect(o[0]).toMatch(/<m:f><m:num>.*a.*b.*<\/m:num><m:den>.*c.*d.*<\/m:den><\/m:f>/);
    expect(o[1]).toContain('<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>');
    expect(o[1]).toContain('<m:sSup>');
    expect(o[2]).toMatch(/<m:rad><m:deg>.*3.*<\/m:deg><m:e>.*x.*<\/m:e><\/m:rad>/);
    expect(o[3]).toMatch(/<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*i.*=.*1.*<\/m:sub><m:sup>.*n.*<\/m:sup><m:e><m:sSup>/);
    expect(o[4]).toContain('<m:chr m:val="∫"/>');
    expect(o[5]).toMatch(/<m:sSub><m:e>.*x.*<\/m:e><m:sub>.*i.*j.*<\/m:sub><\/m:sSub>/);
    expect(o[6]).toMatch(/<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/><\/m:dPr><m:e><m:f>/);
    expect(o[7]).toMatch(/<m:d>.*<m:m><m:mr><m:e>.*a.*<\/m:e><m:e>.*b.*<\/m:e><\/m:mr><m:mr>/);
    expect(o[8]).toContain('<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr>');
    expect(o[9]).toMatch(/<m:limLow><m:e>.*lim.*<\/m:e><m:lim>.*n.*→.*∞.*<\/m:lim><\/m:limLow>/);
    // 함수 이름은 똑바로(sty p), 한 글자 변수는 기울임
    expect(o[11]).toMatch(/<m:r><m:rPr><m:sty m:val="p"\/><\/m:rPr><m:t xml:space="preserve">sin<\/m:t><\/m:r>/);
    expect(o[11]).toMatch(/<m:r><m:t xml:space="preserve">θ<\/m:t><\/m:r>/);
    // OMML 스키마대로 m:r 안에는 a:rPr 없음
    for (const x of o) expect(x).not.toContain('a:rPr');
    // 모두 올바른 XML
    for (const x of o) expect(parse(x).localName).toBe('oMath');
  });

  it('OMML → LaTeX → OMML: 한 번 돌리면 구조가 같음 (고정점)', () => {
    for (const f of FORMULAS) {
      const first = omml(f);
      const latex = tidyLatex(ommlToLatex(parse(first)));
      expect(latexToMathml(latex).error, `${f} → ${latex}`).toBeNull();
      expect(signature(omml(latex)), `${f} → ${latex}`).toBe(signature(first));
    }
  });

  it('수학용 영숫자 → 보통 글자', () => {
    expect(['𝑎', '𝐀', '𝛼', 'ℎ', '𝟐', 'x'].map(plainMathChar).join('')).toBe('aAαh2x');
  });

  it('MathML 정화: MathML 요소·속성만', () => {
    const bad = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi onclick="alert(1)" href="javascript:alert(1)">x</mi><mtext><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/>t</mtext><mo style="background:url(javascript:alert(1))">+</mo></math>';
    const s = sanitizeMathml(bad);
    expect(s).toContain('<mi>x</mi>');
    expect(s).not.toMatch(/onclick|href|img|onerror|url\(/);
    expect(sanitizeMathml('<div>not math</div>')).toBe('');
    expect(sanitizeMathml('<math><mi>x</mi')).toBe('');
  });

  it('LaTeX 오류는 메시지와 함께 (표시는 됨)', () => {
    const r = latexToMathml('\\frac{a}{');
    expect(r.error).toBeTruthy();
    expect(r.mathml.startsWith('<math')).toBe(true);
  });
});

describe('PPTX 수식', () => {
  it('LibreOffice가 만든 수식(a14:m) 가져오기 → 편집 가능한 LaTeX', async () => {
    const r = await importPptx(new Uint8Array(readFileSync('src/services/math/__fixtures__/lo-equations.pptx')));
    const latex = r.doc.slides.map((s) => (s.objects[0] as EquationObject).latex);
    expect(r.doc.slides.every((s) => s.objects.length === 1 && s.objects[0].type === 'equation')).toBe(true);
    expect(latex).toEqual([
      '\\frac{a+b}{c-d}',
      '\\sqrt{{x}^{2}+{y}^{2}}',
      '\\sqrt[3]{x}',
      '\\sum_{i=1}^{n}{{i}^{2}}',
      // LibreOffice가 Temml MathML(∫ msubsup)을 읽을 때 적분 범위를 버림 → 파일 안에도 범위가 없음
      '\\int{f}\\left( x \\right)dx',
      '{x}_{ij}',
      '\\left( \\frac{1}{2} \\right)',
      '\\left( \\begin{matrix}a & b \\\\ c & d\\end{matrix} \\right)',
      '\\hat{x}+\\bar{y}',
      '\\lim_{n\\to \\infty}{}{a}_{n}',
      '\\alpha \\beta \\le \\gamma',
      '\\sin \\theta',
    ]);
    for (const l of latex) expect(latexToMathml(l).error, l).toBeNull();
    expect(r.report.warnings).toEqual([]);
  });

  it('내보내기: mc:AlternateContent(a14:m) + 대체 그림 → 다시 가져오기', async () => {
    const doc = produce(createPresentation('수식'), (d) => {
      const { mathml } = latexToMathml('x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}');
      d.slides[0].objects.push({ id: 'eq1', type: 'equation', name: '수식 1', x: 100, y: 200, width: 400, height: 120, rotation: 0, latex: 'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}', mathml, fontSize: 28, color: '#1F4E79', align: 'center' });
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { bytes } = await exportPptxBytes(doc, { renderEquationPng: async () => png });
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).toMatch(/<mc:AlternateContent[^>]*><mc:Choice[^>]*Requires="a14"[^>]*><p:sp>.*<a14:m><m:oMathPara[^>]*><m:oMathParaPr><m:jc m:val="centerGroup"\/><\/m:oMathParaPr><m:oMath[^>]*>.*<m:f>.*<\/a14:m>/s);
    expect(slide).toMatch(/<mc:Fallback><p:sp>.*<a:blipFill><a:blip r:embed="rIdSL\d+"\/>/s);
    expect(slide).toContain('<a:off x="952500" y="1905000"/><a:ext cx="3810000" cy="1143000"/>');
    expect(slide).toContain('sz="2800"');
    expect(slide).toContain('<a:srgbClr val="1F4E79"/>');
    // Choice와 Fallback 도형 ID 같음
    const ids = [...slide.matchAll(/<p:cNvPr id="(\d+)" name="수식 1"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).toMatch(/Type="[^"]*\/image" Target="\.\.\/media\/slGen\d+\.png"/);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toMatch(/Extension="png"/);
    const back = await importPptx(bytes);
    const eq = back.doc.slides[0].objects.find((o) => o.type === 'equation') as EquationObject;
    expect(eq).toBeTruthy();
    expect(latexToMathml(eq.latex).error).toBeNull();
    expect(signature(mathmlToOmml(eq.mathml))).toBe(signature(mathmlToOmml(doc.slides[0].objects.find((o) => o.type === 'equation')!.type === 'equation' ? (doc.slides[0].objects.find((o) => o.type === 'equation') as EquationObject).mathml : '')));
    expect(eq).toMatchObject({ fontSize: 28, color: '#1F4E79', align: 'center' });
    expect(Math.round(eq.x)).toBe(100);
  });

  it('수식 12개 PPTX (LibreOffice 검증용 파일: test-output/equations-export.pptx)', async () => {
    const doc = produce(createPresentation('수식 모음'), (d) => {
      const base = d.slides[0];
      d.slides = FORMULAS.map((f, i) => ({ ...JSON.parse(JSON.stringify(base)), id: `s${i}`, objects: [{ id: `e${i}`, type: 'equation', name: `수식 ${i + 1}`, x: 140, y: 260, width: 1000, height: 200, rotation: 0, latex: f, mathml: latexToMathml(f).mathml, fontSize: 40, color: '#000000', align: 'center' } as EquationObject] }));
    });
    const { bytes } = await exportPptxBytes(doc);
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/equations-export.pptx', bytes);
    expect((await JSZip.loadAsync(bytes)).file('ppt/slides/slide12.xml')).toBeTruthy();
  });

  it('가져온 수식을 바꾸지 않으면 원본 OMML을 그대로 저장, 바꾸면 새로 만듦', async () => {
    const r = await importPptx(new Uint8Array(readFileSync('src/services/math/__fixtures__/lo-equations.pptx')));
    const src = await JSZip.loadAsync(readFileSync('src/services/math/__fixtures__/lo-equations.pptx'));
    const orig = (await src.file('ppt/slides/slide10.xml')!.async('string')).match(/<m:oMath[ >].*<\/m:oMath>/s)![0];
    const { bytes } = await exportPptxBytes(r.doc);
    const out = await (await JSZip.loadAsync(bytes)).file('ppt/slides/slide10.xml')!.async('string');
    expect(signature(out.match(/<m:oMath[ >].*<\/m:oMath>/s)![0])).toBe(signature(orig));
    expect(out).toContain('<m:func>'); // LibreOffice가 쓴 구조 그대로
    const edited = produce(r.doc, (d) => {
      const e = d.slides[9].objects[0] as EquationObject;
      e.latex = '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1';
      e.mathml = latexToMathml(e.latex).mathml;
    });
    const out2 = await (await JSZip.loadAsync((await exportPptxBytes(edited)).bytes)).file('ppt/slides/slide10.xml')!.async('string');
    expect(out2).not.toContain('<m:func>');
    expect(out2).toMatch(/<m:limLow>.*<m:f>/s);
    // 그림을 만들 수 없는 환경: 대체 도형에 LaTeX 글자
    expect(out2).toMatch(/<mc:Fallback><p:sp>.*<a:t>\\lim_\{x\\to 0\}/s);
  });
});
