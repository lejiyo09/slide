import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { produce } from 'immer';
import { latexToMathml } from './equation';
import { importPptx } from '../import/pptxImport';
import { exportPptxBytes } from '../export/pptxExport';
import { applyInlineMath, inlineMathToken } from '../export/inlineMathXml';
import { createPresentation } from '../../core/document/factory';
import { MATH_RUN_TEXT, type TextObject, type TextRun } from '../../types/model';
import { validateXml } from '../../test/ooxmlSchema';

/** LibreOffice(soffice)가 있는지 */
const HAS_SOFFICE = spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status === 0;

const mathRun = (latex: string, extra: Partial<TextRun> = {}): TextRun => ({ text: MATH_RUN_TEXT, fontSize: 24, color: '#1F3864', ...extra, math: { latex, mathml: latexToMathml(latex).mathml } });

function deck() {
  return produce(createPresentation('문단 안 수식'), (d) => {
    const t = d.slides[0].objects[1] as TextObject;
    t.text.paragraphs = [
      { runs: [{ text: '원의 넓이는 ', fontSize: 24 }, mathRun('A=\\pi r^{2}'), { text: ' 입니다.', fontSize: 24 }] },
      { runs: [{ text: '근의 공식: ', fontSize: 24 }, mathRun('x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}')] },
    ];
  });
}

describe('문단 안 수식 (a14:m)', () => {
  it('자리 표시 글자 → a14:m (Choice) + LaTeX 글자 (Fallback)', () => {
    const sp = `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr/><a:t>앞 </a:t></a:r><a:r><a:rPr lang="ko-KR" sz="2400"/><a:t>${inlineMathToken(0)}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><a:t>다른</a:t></p:sp></p:spTree></p:cSld></p:sld>`;
    const out = applyInlineMath(sp, [{ latex: 'x^{2}', mathml: latexToMathml('x^{2}').mathml }]);
    expect(out).toMatch(/<mc:AlternateContent [^>]*><mc:Choice [^>]*Requires="a14"><p:sp>[\s\S]*<a:t>앞 <\/a:t><\/a:r><a14:m><m:oMath xmlns:m="[^"]+"><m:sSup>/);
    expect(out).toMatch(/<mc:Fallback><p:sp>[\s\S]*<a:t>x\^\{2\}<\/a:t>[\s\S]*<\/mc:Fallback><\/mc:AlternateContent><p:sp><a:t>다른/);
  });

  it('PPTX 내보내기: 스키마 통과, (LibreOffice가 있으면) 대체 글자, 다시 가져오면 같은 글자·수식', async () => {
    const { bytes } = await exportPptxBytes(deck());
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/inline-math.pptx', bytes);
    const z = await JSZip.loadAsync(bytes);
    const sx = await z.file('ppt/slides/slide1.xml')!.async('string');
    expect(sx).not.toContain('[[SLM:');
    expect((sx.match(/<a14:m>/g) ?? []).length).toBe(2);
    expect(validateXml(sx)).toEqual([]);
    // LibreOffice가 설치된 환경에서만 (CI 배포 서버에는 없음): 문단 안 a14:m을 읽지 않아 Fallback(LaTeX 글자)을 보여 줌
    if (HAS_SOFFICE) {
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', 'test-output', 'test-output/inline-math.pptx'], { stdio: 'ignore', timeout: 120000 });
      const txt = execFileSync('pdftotext', ['test-output/inline-math.pdf', '-'], { encoding: 'utf8' });
      expect(txt).toContain('원의 넓이는');
      expect(txt).not.toContain('SLM');
      expect(txt.replace(/\s/g, '')).toContain('A=\\pir^{2}');
    }
    // 다시 가져오기: 텍스트 상자(수식 개체 아님) + 수식 런
    const back = await importPptx(bytes);
    const t = back.doc.slides[0].objects.find((o) => (o.type === 'text' || o.type === 'shape') && o.text.paragraphs.some((p) => p.runs.some((r) => r.math))) as TextObject;
    expect(t).toBeTruthy();
    const p0 = t.text.paragraphs[0].runs;
    // OMML → LaTeX는 한 글자 묶음에 중괄호를 더할 수 있음 ({r}^{2} = r^{2}, 같은 수식)
    const norm = (l: string) => l.replace(/\{(\w)\}/g, '$1').replace(/\s+/g, '');
    expect(p0.map((r) => (r.math ? `$${norm(r.math.latex)}$` : r.text)).join('')).toBe(`원의 넓이는 $${norm('A=\\pi r^{2}')}$ 입니다.`);
    expect(norm(t.text.paragraphs[1].runs.find((r) => r.math)!.math!.latex)).toBe(norm('x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'));
    expect(p0.find((r) => r.math)!.math!.mathml).toContain('<msup>');
    // 그대로 다시 저장하면 가져온 OMML을 그대로 씀
    const again = await JSZip.loadAsync((await exportPptxBytes(back.doc)).bytes);
    const sx2 = await again.file('ppt/slides/slide1.xml')!.async('string');
    expect((sx2.match(/<a14:m>/g) ?? []).length).toBe(2);
    expect(validateXml(sx2)).toEqual([]);
  });
});
