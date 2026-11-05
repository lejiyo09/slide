import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { importPptx } from '../import/pptxImport';
import { exportPptxBytes } from './pptxExport';
import { createPresentation, createShape, createTextBox } from '../../core/document/factory';
import type { Animation, SlideTransition } from '../../types/model';
import { PATH_PRESETS } from '../../engines/animation/effects';

const SRC = readFileSync('src/services/import/__fixtures__/sample.pptx');
const pick = (a: Animation) => ({ effect: a.effect, category: a.category, start: a.start, duration: a.duration, delay: a.delay, repeat: a.repeat, direction: a.direction });

describe('전환·애니메이션 PPTX', () => {
  it('가져오기: 페이드 전환과 페이드 나타내기 애니메이션을 모델로', async () => {
    const { doc } = await importPptx(SRC);
    const s4 = doc.slides[3];
    expect(s4.transition).toMatchObject({ type: 'fade', advanceOnClick: true });
    expect(s4.animations).toHaveLength(1);
    const a = s4.animations![0];
    expect(a).toMatchObject({ effect: 'fade', category: 'entrance', start: 'onClick', duration: 500 });
    expect(s4.objects.find((o) => o.id === a.targetId)?.name).toBe('Animated');
  });

  it('바꾸지 않으면 원본 XML, 바꾸면 모델에서 생성 → 다시 가져와도 같은 효과', async () => {
    const { doc } = await importPptx(SRC);
    const edited = produce(doc, (d) => {
      const s = d.slides[3];
      const a = s.animations![0];
      a.effect = 'flyIn';
      a.direction = 'left';
      a.duration = 800;
      s.animations!.push({ id: 'x2', targetId: a.targetId, category: 'emphasis', effect: 'spin', start: 'afterPrevious', duration: 1500, delay: 250, repeat: 2 });
      s.transition = { type: 'push', duration: 1200, direction: 'up', advanceOnClick: true };
    });
    const { bytes } = await exportPptxBytes(edited, { sourcePackage: SRC });
    const x = await (await JSZip.loadAsync(bytes)).file('ppt/slides/slide4.xml')!.async('string');
    expect(x).toContain('<p:push dir="u"/>');
    expect(x).toContain('p14:dur="1200"');
    expect(x).toContain('presetClass="entr" presetSubtype="8"');
    expect(x).toContain('<p:attrName>ppt_x</p:attrName>');
    expect(x).toContain('<p:animRot by="21600000">');
    expect(x).toContain('repeatCount="2000"');
    // 대상 spid가 실제 도형 ID와 일치
    const spid = x.match(/<p:spTgt spid="(\d+)"\/>/)![1];
    expect(x).toMatch(new RegExp(`<p:cNvPr id="${spid}" name="Animated"`));
    const again = await importPptx(bytes);
    const s4 = again.doc.slides[3];
    expect(s4.transition).toMatchObject({ type: 'push', duration: 1200, direction: 'up' });
    expect(s4.animations!.map(pick)).toEqual(edited.slides[3].animations!.map(pick));
  });

  it('새 문서: 모든 효과·이동 경로·트리거·반복·자동 넘김 왕복', async () => {
    let target = '';
    let trig = '';
    const doc = produce(createPresentation(), (d) => {
      const sh = createShape('rect', 100, 100, 200, 120);
      const tb = createTextBox({ x: 500, y: 300, text: '버튼' });
      const pic = createShape('ellipse', 800, 100, 100, 100);
      target = sh.id;
      trig = tb.id;
      d.slides[0].objects.push(sh, tb, pic);
      const effects = ['appear', 'fade', 'flyIn', 'floatIn', 'wipe', 'split', 'zoom', 'pulse', 'spin', 'growShrink', 'teeter', 'transparency', 'disappear', 'fadeOut', 'flyOut', 'floatOut', 'wipeOut', 'splitOut', 'zoomOut'];
      const cat = (e: string): Animation['category'] => (['pulse', 'spin', 'growShrink', 'teeter', 'transparency'].includes(e) ? 'emphasis' : ['disappear', 'fadeOut', 'flyOut', 'floatOut', 'wipeOut', 'splitOut', 'zoomOut'].includes(e) ? 'exit' : 'entrance');
      d.slides[0].animations = effects.map((e, i) => ({
        id: `a${i}`, targetId: sh.id, category: cat(e), effect: e,
        start: (['onClick', 'withPrevious', 'afterPrevious'] as const)[i % 3],
        duration: e === 'appear' || e === 'disappear' ? 0 : 500 + i * 10, delay: i % 2 ? 100 : 0, repeat: 1,
        ...(e.startsWith('fly') || e.startsWith('wipe') ? { direction: 'right' as const } : {}),
      }));
      d.slides[0].animations.push({ id: 'p', targetId: pic.id, category: 'path', effect: 'path', start: 'onClick', duration: 2000, delay: 0, repeat: 0, path: PATH_PRESETS[0].build(0, 0) });
      d.slides[0].animations.push({ id: 't', targetId: pic.id, category: 'emphasis', effect: 'pulse', start: 'onClick', duration: 500, delay: 0, repeat: 1, triggerId: tb.id });
      d.slides[0].transition = { type: 'split', duration: 900, direction: 'horizontalIn', advanceOnClick: false, advanceAfter: 3000 } as SlideTransition;
    });
    const { bytes } = await exportPptxBytes(doc);
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/anim-roundtrip.pptx', bytes);
    const again = await importPptx(bytes);
    const s = again.doc.slides[0];
    expect(s.transition).toMatchObject({ type: 'split', duration: 900, direction: 'horizontalIn', advanceOnClick: false, advanceAfter: 3000 });
    const orig = doc.slides[0].animations!;
    expect(s.animations).toHaveLength(orig.length);
    expect(s.animations!.filter((a) => !a.triggerId && a.category !== 'path').map(pick)).toEqual(orig.filter((a) => !a.triggerId && a.category !== 'path').map(pick));
    const path = s.animations!.find((a) => a.category === 'path')!;
    expect(path.repeat).toBe(0);
    expect(path.path!.at(-1)!.x).toBeCloseTo(240, 0);
    const t = s.animations!.find((a) => a.triggerId)!;
    const nameOf = (id: string) => s.objects.find((o) => o.id === id)?.name;
    expect(nameOf(t.triggerId!)).toBe('텍스트 상자');
    expect(nameOf(t.targetId)).toBe('타원');
    expect(s.animations![0].targetId).toBe(s.objects.find((o) => o.name === '사각형')!.id);
    void target;
    void trig;
  });
});
