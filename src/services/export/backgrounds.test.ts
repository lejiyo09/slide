import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { produce } from 'immer';
import { createPresentation, createShape } from '../../core/document/factory';
import { exportPptxBytes } from './pptxExport';

describe('배경/채우기 후처리', () => {
  it('그라데이션·무늬 배경과 무늬 도형 채우기를 실제 OOXML로 기록', async () => {
    const doc = produce(createPresentation(), (d) => {
      d.slides[0].background = { fill: { type: 'gradient', angle: 45, stops: [{ offset: 0, color: '@accent1' }, { offset: 1, color: '#FFFFFF' }] } };
      const sh = createShape('rect', 10, 10, 100, 100);
      sh.fill = { type: 'pattern', preset: 'smGrid', fg: '@accent2', bg: '#FFFFFF' };
      d.slides[0].objects.push(sh);
      d.slides.push({ ...d.slides[0], id: 'p2', objects: [], background: { fill: { type: 'pattern', preset: 'ltUpDiag', fg: '#112233', bg: '#FFFFFF' } } });
    });
    const { bytes } = await exportPptxBytes(doc);
    const zip = await JSZip.loadAsync(bytes);
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    const bg1 = s1.slice(s1.indexOf('<p:bg>'), s1.indexOf('</p:bg>'));
    expect(bg1).toContain('<a:gradFill');
    expect(bg1).toContain(`val="${doc.theme.colors.accent1.slice(1)}"`); // 토큰이 테마 색으로 해석됨
    expect(bg1).toContain('ang="2700000"');
    expect(s1).toContain('<a:pattFill prst="smGrid">');
    expect(s1).toContain(`<a:fgClr><a:srgbClr val="${doc.theme.colors.accent2.slice(1)}"/>`);
    expect(s2.slice(s2.indexOf('<p:bg>'), s2.indexOf('</p:bg>'))).toContain('<a:pattFill prst="ltUpDiag">');
  });
});
