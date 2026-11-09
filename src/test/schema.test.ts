/**
 * PPTX 스키마 검증 (Open XML SDK 정의): PowerPoint를 실행할 수 없는 환경에서 SlideLab이 쓰는 XML이
 * ECMA-376·Microsoft 확장 스키마의 요소 순서·필수 속성을 지키는지 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { validateXml } from './ooxmlSchema';
import { sampleDoc } from '../services/export/pptxExport.test';
import { exportPptxBytes } from '../services/export/pptxExport';
import { importPptx } from '../services/import/pptxImport';
import { addComment, replyToComment } from '../core/comments/comments';
import { latexToMathml } from '../services/math/equation';
import type { EquationObject } from '../types/model';

const PARTS = /^ppt\/(?!.*\/_rels\/).*\.xml$/;

async function issuesOf(bytes: Uint8Array | Buffer) {
  const z = await JSZip.loadAsync(bytes);
  const out: Record<string, string[]> = {};
  for (const n of Object.keys(z.files).filter((x) => PARTS.test(x)).sort()) out[n] = validateXml(await z.file(n)!.async('string')).map((i) => `${i.path} ${i.message}`);
  return out;
}

describe('스키마 검증기', () => {
  it('PowerPoint·LibreOffice가 만든 파일은 위반 없음 (검증기 자체 확인)', async () => {
    for (const f of ['src/services/fonts/__fixtures__/Boldonse.pptx', 'src/services/math/__fixtures__/lo-equations.pptx']) {
      const r = await issuesOf(readFileSync(f));
      expect(Object.entries(r).filter(([, v]) => v.length), f).toEqual([]);
    }
  });

  it('잘못된 XML은 찾아냄: 순서, 필수 속성, 알 수 없는 속성, OMML', () => {
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const ok = `<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
    expect(validateXml(ok)).toEqual([]);
    expect(validateXml(ok.replace('<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>', '<p:notesSz cx="6858000" cy="9144000"/><p:sldSz cx="9144000" cy="6858000"/>'))[0].message).toMatch(/순서/);
    expect(validateXml(ok.replace('<p:notesSz cx="6858000" cy="9144000"/>', '<p:notesSz cx="6858000"/>'))[0].message).toMatch(/필수 속성 cy/);
    expect(validateXml(ok.replace('<p:sldSz cx', '<p:sldSz bogus="1" cx'))[0].message).toMatch(/알 수 없는 속성 bogus/);
    const sp = (m: string) => `<p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${m}</m:oMath></a14:m></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    expect(validateXml(sp('<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>'))).toEqual([]);
    expect(validateXml(sp('<m:f><m:den><m:r><m:t>b</m:t></m:r></m:den><m:num><m:r><m:t>a</m:t></m:r></m:num></m:f>')).length).toBeGreaterThan(0);
  });
});

describe('SlideLab이 만든 PPTX', () => {
  it('도형·표·그림·전환·애니메이션·그룹·수식·메모: 모든 파트가 스키마를 지킴', async () => {
    const doc = produce(sampleDoc(), (d) => {
      const c = addComment(d, d.slides[0].id, { author: '김', initials: '김', text: '메모', x: 10, y: 20 });
      replyToComment(d, d.slides[0].id, c, { author: 'B', initials: 'B', text: '답글' });
      const latex = '\\sum_{i=1}^{n} \\frac{a_i}{\\sqrt{b}} + \\hat{x}';
      d.slides[0].objects.push({ id: 'eq', type: 'equation', name: '수식', x: 10, y: 10, width: 300, height: 80, rotation: 0, latex, mathml: latexToMathml(latex).mathml, fontSize: 24, color: '#1F4E79', align: 'center' } as EquationObject);
    });
    const r = await issuesOf((await exportPptxBytes(doc)).bytes);
    expect(Object.entries(r).filter(([, v]) => v.length)).toEqual([]);
    expect(Object.keys(r)).toContain('ppt/comments/comment1.xml');
  });

  it('가져와서 다시 저장(왕복): 새로 쓴 파트는 위반 없음, 보존한 원본 파트는 원본과 같은 상태', async () => {
    for (const f of ['sample', 'charts', 'libreoffice']) {
      const src = readFileSync(`src/services/import/__fixtures__/${f}.pptx`);
      const before = await issuesOf(src);
      const after = await issuesOf((await exportPptxBytes((await importPptx(new Uint8Array(src))).doc, { sourcePackage: src })).bytes);
      for (const [part, issues] of Object.entries(after)) {
        // 보존 복사본: ppt/charts/sl13_chart7.xml ← ppt/charts/chart7.xml
        const orig = part.replace(/\/sl\d+_/, '/');
        if (orig !== part) expect(issues.length, `${f} ${part}`).toBe(before[orig]?.length ?? 0);
        else expect(issues, `${f} ${part}`).toEqual([]);
      }
    }
  });
});
