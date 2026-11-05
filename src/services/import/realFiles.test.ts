/**
 * 실제 PowerPoint 파일 호환성 테스트 (선택 실행)
 *   REAL_PPTX_DIR=/path/to/pptx-files npx vitest run src/services/import/realFiles.test.ts
 * 각 파일을 가져오기 → 내보내기(원본 보존) → 다시 가져오기 하여 텍스트·개체·보존 요소가 유지되는지 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importPptx } from './pptxImport';
import { exportPptxBytes } from '../export/pptxExport';
import type { SlideObject } from '../../types/model';

const dir = process.env.REAL_PPTX_DIR;
const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.pptx') && !f.includes('.roundtrip.')) : [];

const texts = (objs: SlideObject[]): string[] =>
  objs.flatMap((o) => (o.type === 'group' ? texts(o.children) : o.type === 'text' || o.type === 'shape' ? [o.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')] : []));
const count = (objs: SlideObject[]): number => objs.reduce((n, o) => n + (o.type === 'group' ? 1 + count(o.children) : 1), 0);

describe.skipIf(!dir)('실제 PowerPoint 파일', () => {
  for (const f of files) {
    it(f, async () => {
      const src = readFileSync(join(dir!, f));
      const first = await importPptx(src, f);
      expect(first.report.warnings).toEqual([]);
      const { bytes, warnings } = await exportPptxBytes(first.doc, { sourcePackage: src });
      mkdirSync('test-output/real', { recursive: true });
      writeFileSync(`test-output/real/${f.replace('.pptx', '.roundtrip.pptx')}`, bytes);
      const again = await importPptx(bytes, f);
      expect(again.doc.slides.length).toBe(first.doc.slides.length);
      first.doc.slides.forEach((s, i) => {
        const t = again.doc.slides[i];
        expect(texts(t.objects).filter(Boolean)).toEqual(texts(s.objects).filter(Boolean));
        expect(count(t.objects)).toBe(count(s.objects));
        expect(t.hidden ?? false).toBe(s.hidden ?? false);
      });
      expect(again.report.unsupported).toEqual(first.report.unsupported);
      console.log(`${f}: 슬라이드 ${first.doc.slides.length}, 개체 ${first.report.objects}, 보존 ${JSON.stringify(first.report.unsupported)}, 경고 ${warnings.length}`);
    });
  }
});
