import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { importPptx } from '../import/pptxImport';
import { exportPptxBytes } from './pptxExport';

const SRC = readFileSync('src/services/import/__fixtures__/sample.pptx');

describe('PPTX 왕복 (가져오기 → 내보내기 → 다시 가져오기)', () => {
  it('표·차트 원본 보존 + 차트 파트·내장 통합 문서 복사 + 전환·애니메이션 유지', async () => {
    const { doc } = await importPptx(SRC, 'sample.pptx');
    const { bytes, warnings } = await exportPptxBytes(doc, { sourcePackage: SRC });
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/roundtrip.pptx', bytes);

    const zip = await JSZip.loadAsync(bytes);
    const s4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
    expect(s4).not.toContain('__SLIDELAB_KEEP__');
    expect(s4).toContain('<a:tbl>');
    expect(s4).toMatch(/<c:chart [^>]*r:id="rIdSL\d+"/);
    expect(s4).toContain('<p:transition');
    expect(s4).toContain('<p:timing');
    const rels = await zip.file('ppt/slides/_rels/slide4.xml.rels')!.async('string');
    const chartTarget = rels.match(/Target="([^"]*chart[^"]*)"/)?.[1];
    expect(chartTarget).toBeTruthy();
    const chartPath = new URL(chartTarget!, 'http://x/ppt/slides/').pathname.slice(1);
    expect(zip.file(chartPath)).toBeTruthy();
    const chartRels = await zip.file(chartPath.replace(/([^/]+)$/, '_rels/$1.rels'))!.async('string');
    expect(chartRels).toMatch(/embeddings\/sl\d+_[^"]+\.xlsx/);
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain(`PartName="/${chartPath}"`);
    expect(ct).toContain('drawingml.chart+xml');

    // 그라데이션 채우기 보존 (pptxgenjs 미지원 → 후처리)
    const s3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
    expect(s3).toContain('<a:gradFill');
    // 그룹 구조 복원 (pptxgenjs는 그룹 미지원 → 후처리로 p:grpSp 재구성)
    expect(s3).toMatch(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="MyGroup"\/>/);
    // 글머리 기호 문자
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s2).toContain('<a:buChar char="–"');
    // 애니메이션 대상 ID가 원래 값으로 복원되었는지
    const spid = s4.match(/spTgt spid="(\d+)"/)![1];
    expect(s4).toMatch(new RegExp(`<p:cNvPr id="${spid}" name="Animated"`));
    expect(warnings.some((w) => w.includes('애니메이션'))).toBe(false);

    // 다시 가져오기
    const again = await importPptx(bytes, 'roundtrip.pptx');
    expect(again.doc.slides).toHaveLength(5);
    expect(again.report.converted).toMatchObject({ table: 1, chart: 1 });
    const t = again.doc.slides[3].objects.find((o) => o.type === 'table');
    expect(t?.type === 'table' && t.rows[2].cells[2].text.paragraphs[0].runs[0].text).toBe('R2C2');
    expect(again.doc.slides[4].hidden).toBe(true);
    expect(again.doc.slides[0].notes).toBe('첫 슬라이드 노트');
    expect(again.doc.sections.map((s) => s.name)).toEqual(['도입', '본문']);
    const grp = again.doc.slides[2].objects.find((o) => o.name === 'MyGroup');
    expect(grp?.type === 'group' && grp.children.length).toBe(2);
    expect(grp!.x).toBeCloseTo(9 * 96, 0);
    const box = again.doc.slides[2].objects.find((o) => o.name === 'RoundBox');
    expect(box).toMatchObject({ type: 'shape', shape: 'roundRect', rotation: 30 });
  });

  it('이동한 표의 위치 반영, 애니메이션 대상 삭제 시 애니메이션 제외 + 경고', async () => {
    const { doc } = await importPptx(SRC, 'sample.pptx');
    const edited = produce(doc, (d) => {
      const s = d.slides[3];
      const t = s.objects.find((o) => o.type === 'table')!;
      t.x = 100;
      t.y = 500;
      s.objects = s.objects.filter((o) => o.name !== 'Animated');
    });
    const { bytes, warnings } = await exportPptxBytes(edited, { sourcePackage: SRC });
    const zip = await JSZip.loadAsync(bytes);
    const s4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
    const tbl = s4.slice(s4.indexOf('<p:graphicFrame'), s4.indexOf('<a:tbl>'));
    expect(tbl).toContain(`x="${100 * 9525}"`);
    expect(tbl).toContain(`y="${500 * 9525}"`);
    expect(s4).not.toContain('<p:timing');
    expect(s4).toContain('<p:transition');
    expect(warnings.some((w) => w.includes('애니메이션'))).toBe(true);
  });

  it('원본 패키지가 없으면 표·차트를 SlideLab 모델에서 새로 생성', async () => {
    const { doc } = await importPptx(SRC, 'sample.pptx');
    const { bytes } = await exportPptxBytes(doc, {});
    const zip = await JSZip.loadAsync(bytes);
    const s4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
    expect(s4).not.toContain('__SLIDELAB_KEEP__');
    expect(s4).toContain('<a:tbl>');
    expect(s4).toContain('R2C2');
    expect(s4).toMatch(/<c:chart [^>]*r:id=/);
  });

  it('내용을 바꾼 표·차트는 새로 생성 (병합 셀 포함), 바꾸지 않은 개체는 원본 복원', async () => {
    const { doc } = await importPptx(SRC, 'sample.pptx');
    const edited = produce(doc, (d) => {
      const s = d.slides[3];
      const t = s.objects.find((o) => o.type === 'table')!;
      if (t.type === 'table') {
        t.rows[1].cells[1].text.paragraphs[0].runs[0].text = '수정한 셀';
        t.rows[2].cells[0].colSpan = 2;
        t.rows[2].cells[1].merged = true;
      }
      const c = s.objects.find((o) => o.type === 'chart')!;
      if (c.type === 'chart') c.series[0].values = [1, 2, 3];
    });
    const { bytes, warnings } = await exportPptxBytes(edited, { sourcePackage: SRC });
    const zip = await JSZip.loadAsync(bytes);
    const s4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
    expect(s4).toContain('수정한 셀');
    expect(s4).toContain('gridSpan="2"');
    expect(s4).toContain('hMerge="1"');
    expect(warnings.some((w) => w.includes('새로 저장'))).toBe(true);
    const again = await importPptx(bytes, 'x.pptx');
    const c2 = again.doc.slides[3].objects.find((o) => o.type === 'chart');
    expect(c2?.type === 'chart' && c2.series[0].values).toEqual([1, 2, 3]);
    const t2 = again.doc.slides[3].objects.find((o) => o.type === 'table');
    expect(t2?.type === 'table' && t2.rows[2].cells[0].colSpan).toBe(2);
    expect(t2?.type === 'table' && t2.rows[2].cells[1].merged).toBe(true);
  });
});
