import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { importPptx } from '../import/pptxImport';
import { exportPptxBytes } from './pptxExport';
import { createPresentation, createShape, createSlide } from '../../core/document/factory';
import type { MediaObject, Presentation } from '../../types/model';
import { DEFAULT_SHOW_SETTINGS, strokeToShape } from '../../engines/show/showModel';
import { encodeWav } from '../../engines/show/wav';
import { buildShowPrXml, parseShowPr } from './showXml';

// 0.1초 무음 WAV
const wavDataUrl = async () => {
  const blob = encodeWav(new Float32Array(2205), 22050);
  return `data:audio/wav;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
};

async function makeDoc(): Promise<Presentation> {
  const d = createPresentation('쇼 설정');
  while (d.slides.length < 4) d.slides.push(createSlide('blank', d.size));
  d.slides[2].hidden = true;
  d.slides[0].objects.push(createShape('rect', 100, 100, 200, 100));
  // 잉크 → 자유형 도형
  d.slides[1].objects.push(strokeToShape({ id: 'k', tool: 'pen', color: '#FF0000', width: 3, points: [100, 100, 200, 160, 300, 120] }));
  d.slides[1].objects.push(strokeToShape({ id: 'h', tool: 'highlighter', color: '#FFFF00', width: 18, points: [100, 300, 500, 300] }));
  // 내레이션 (자동 재생 + 쇼 중 숨기기) + 예행 연습 시간
  d.assets.nar = { id: 'nar', mime: 'audio/wav', dataUrl: await wavDataUrl(), name: 'narration.wav' };
  const nar: MediaObject = { id: 'narObj', type: 'media', name: '내레이션', kind: 'audio', assetId: 'nar', x: 1220, y: 660, width: 48, height: 48, rotation: 0, autoPlay: true, hideInShow: true, narration: true };
  d.slides[1].objects.push(nar);
  d.slides[1].transition = { type: 'none', duration: 0, advanceOnClick: true, advanceAfter: 4200 };
  d.customShows = [
    { id: 'cs1', name: '요약 쇼', slideIds: [d.slides[3].id, d.slides[0].id] },
    { id: 'cs2', name: '두 번째', slideIds: [d.slides[1].id] },
  ];
  d.showSettings = { ...DEFAULT_SHOW_SETTINGS, showType: 'kiosk', loop: true, noAnimation: true, useTimings: true, range: { kind: 'custom', showId: 'cs1' }, penColor: '#00B050', laserColor: '#0070C0' };
  return d;
}

describe('발표 도구 PPTX', () => {
  it('showPr XML 생성/해석 (보기 형식, 범위, 펜·레이저 색)', () => {
    const xml = buildShowPrXml({ ...DEFAULT_SHOW_SETTINGS, showType: 'browsed', noNarration: true, useTimings: false, range: { kind: 'range', from: 2, to: 3 }, penColor: '#123456' });
    expect(xml).toContain('showNarration="0"');
    expect(xml).toContain('useTimings="0"');
    expect(xml).toContain('<p:browse/><p:sldRg st="2" end="3"/>');
    expect(xml).toContain('<a:srgbClr val="123456"/>');
    const el = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
    const st = parseShowPr(el, new Map(), 5)!;
    expect(st).toMatchObject({ showType: 'browsed', noNarration: true, useTimings: false, range: { kind: 'range', from: 2, to: 3 }, penColor: '#123456', laserColor: '#FF0000' });
  });

  it('내보내기 → 다시 가져오기: 쇼 설정, 재구성한 쇼, 잉크 도형, 내레이션 자동 재생, 슬라이드 시간', async () => {
    const doc = await makeDoc();
    const loadMedia = async (a: { dataUrl: string }) => a.dataUrl;
    const { bytes, warnings } = await exportPptxBytes(doc, { loadMedia });
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/show-roundtrip.pptx', bytes);
    const zip = await JSZip.loadAsync(bytes);
    const props = await zip.file('ppt/presProps.xml')!.async('string');
    expect(props).toMatch(/<p:showPr[^>]*loop="1"[^>]*showAnimation="0"/);
    expect(props).toContain('<p:kiosk/><p:custShow id="0"/>');
    expect(props).toContain('<p:penClr><a:srgbClr val="00B050"/></p:penClr>');
    expect(props).toContain('<a:srgbClr val="0070C0"/></p14:laserClr>');
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    expect(pres).toMatch(/<p:custShowLst><p:custShow name="요약 쇼" id="0"><p:sldLst><p:sld r:id="rId\d+"\/><p:sld r:id="rId\d+"\/><\/p:sldLst><\/p:custShow>/);
    // custShowLst는 notesSz 뒤, defaultTextStyle 앞 (스키마 순서)
    expect(pres.indexOf('custShowLst')).toBeGreaterThan(pres.indexOf('notesSz'));
    if (pres.includes('defaultTextStyle')) expect(pres.indexOf('custShowLst')).toBeLessThan(pres.indexOf('defaultTextStyle'));
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s2).toContain('presetClass="mediacall"');
    expect(s2).toContain('cmd="playFrom(0.0)"');
    expect(s2).toContain('showWhenStopped="0"');
    expect(s2).toContain('advTm="4200"');
    expect(s2).toContain('<a:custGeom>');
    // 타이밍이 참조하는 spid가 실제 도형
    for (const m of s2.matchAll(/spid="(\d+)"/g)) expect(s2).toContain(`<p:cNvPr id="${m[1]}"`);
    expect(warnings.filter((w) => w.includes('애니메이션'))).toEqual([]);

    const { doc: back } = await importPptx(bytes);
    expect(back.customShows?.map((c) => c.name)).toEqual(['요약 쇼', '두 번째']);
    expect(back.customShows![0].slideIds).toEqual([back.slides[3].id, back.slides[0].id]);
    expect(back.showSettings).toMatchObject({ showType: 'kiosk', loop: true, noAnimation: true, penColor: '#00B050', laserColor: '#0070C0', range: { kind: 'custom', showId: back.customShows![0].id } });
    expect(back.slides[2].hidden).toBe(true);
    const media = back.slides[1].objects.find((o) => o.type === 'media') as MediaObject;
    expect(media).toMatchObject({ kind: 'audio', autoPlay: true, hideInShow: true });
    expect(back.slides[1].transition?.advanceAfter).toBe(4200);
    const inks = back.slides[1].objects.filter((o) => o.type === 'shape' && o.shape === 'custom');
    expect(inks).toHaveLength(2);
    // 미디어 재생 설정을 바꾸지 않으면 원본 타이밍 그대로 다시 저장
    const { bytes: again } = await exportPptxBytes(back, { loadMedia, sourcePackage: bytes });
    const s2b = await (await JSZip.loadAsync(again)).file('ppt/slides/slide2.xml')!.async('string');
    expect(s2b).toContain('presetClass="mediacall"');
  });
});
