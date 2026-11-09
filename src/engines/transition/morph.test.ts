import { describe, expect, it } from 'vitest';
import { createShape, createTextBox } from '../../core/document/factory';
import type { ShapeObject, SlideObject, TextObject } from '../../types/model';
import { lerpAngle, lerpColor, matchMorph, morphEase, morphScene, morphTokens, splitTokens, type MorphToken } from './morph';

const shape = (id: string, kind: ShapeObject['shape'], x: number, y: number, w = 100, h = 100, extra: Partial<ShapeObject> = {}) => ({ ...createShape(kind, x, y, w, h), id, ...extra }) as ShapeObject;
const text = (id: string, t: string, x: number, y: number) => {
  const o = createTextBox({ x, y, width: 300, height: 60 });
  o.id = id;
  o.text.paragraphs = [{ runs: [{ text: t, fontSize: 24, color: '#000000' }] }] as TextObject['text']['paragraphs'];
  return o;
};

describe('모핑: 짝짓기', () => {
  it('같은 모양·같은 글자끼리, 다른 종류는 짝 없음', () => {
    const from: SlideObject[] = [shape('c', 'ellipse', 0, 0), text('t', '제목', 0, 300), shape('r', 'rect', 500, 0)];
    const to: SlideObject[] = [text('t2', '제목', 600, 50), shape('c2', 'ellipse', 400, 400, 200, 200), shape('s', 'star5', 10, 10)];
    const m = matchMorph(from, to);
    expect(m.pairs.map(([a, b]) => `${a.id}→${b.id}`).sort()).toEqual(['c→c2', 't→t2']);
    expect(m.gone.map((o) => o.id)).toEqual(['r']);
    expect(m.added.map((o) => o.id)).toEqual(['s']);
  });

  it("'!!' 이름은 같은 이름끼리만 (모양이 달라도)", () => {
    const from = [shape('a', 'ellipse', 0, 0, 100, 100, { name: '!!공' }), shape('b', 'ellipse', 0, 0, 100, 100, { name: '타원' })];
    const to = [shape('x', 'rect', 300, 0, 100, 100, { name: '!!공' }), shape('y', 'ellipse', 500, 0, 100, 100, { name: '타원' })];
    expect(matchMorph(from, to).pairs.map(([p, q]) => `${p.id}→${q.id}`).sort()).toEqual(['a→x', 'b→y']);
    // '!!' 이름이 다르면 다른 개체와 짝짓지 않음
    expect(matchMorph([shape('a', 'ellipse', 0, 0, 100, 100, { name: '!!공' })], [shape('y', 'ellipse', 0, 0)]).pairs).toEqual([]);
  });
});

describe('모핑: 사이값', () => {
  it('위치·크기·회전(가까운 쪽)·색', () => {
    const a = shape('c', 'ellipse', 0, 0, 100, 100, { rotation: 350, fill: { type: 'solid', color: '#FF0000' } });
    const b = shape('c2', 'ellipse', 400, 200, 300, 100, { rotation: 10, fill: { type: 'solid', color: '#0000FF' } });
    const sc = morphScene({ from: [a], to: [b], p: 0.5 });
    expect(sc.objects).toHaveLength(1);
    const o = sc.objects[0] as ShapeObject;
    expect([o.x, o.y, o.width, o.height]).toEqual([200, 100, 200, 100]); // 가감속 곡선의 중간 = 0.5
    expect(((o.rotation % 360) + 360) % 360).toBeCloseTo(0);
    expect(o.fill).toMatchObject({ type: 'solid', color: '#800080' });
    expect(sc.frames.get(o.id)).toEqual({ opacity: 1 });
    expect(lerpAngle(350, 10, 0.25)).toBeCloseTo(355);
    expect(lerpColor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(morphEase(0.25)).toBeCloseTo(0.125);
  });

  it('처음·끝: 앞 슬라이드 그대로 / 다음 슬라이드 그대로, 짝 없는 개체는 사라짐·나타남', () => {
    const a = shape('c', 'ellipse', 0, 0), gone = shape('g', 'rect', 600, 0), b = shape('c2', 'ellipse', 400, 0), added = shape('n', 'star5', 0, 400);
    const s0 = morphScene({ from: [a, gone], to: [b, added], p: 0 });
    expect(s0.objects.map((o) => [o.id, o.x, s0.frames.get(o.id)!.opacity])).toEqual([
      ['mo:g', 600, 1],
      ['mp:c2', 0, 1],
    ]);
    const s1 = morphScene({ from: [a, gone], to: [b, added], p: 1 });
    expect(s1.objects.map((o) => [o.id, o.x, s1.frames.get(o.id)!.opacity])).toEqual([
      ['mp:c2', 400, 1],
      ['mn:n', 0, 1],
    ]);
    const half = morphScene({ from: [a, gone], to: [b, added], p: 0.5 });
    expect(half.frames.get('mo:g')!.opacity).toBeCloseTo(0.5);
    expect(half.frames.get('mn:n')!.opacity).toBeCloseTo(0.5);
  });

  it('같은 글자: 한 개체로 글자 크기도 사이값, 다른 글자: 사이 자리에서 바뀜(개체 옵션)', () => {
    const a = text('t', '제목', 0, 0), b = text('t2', '제목', 200, 0);
    (b.text.paragraphs[0].runs[0] as { fontSize: number }).fontSize = 48;
    const s = morphScene({ from: [a], to: [b], p: 0.5 });
    expect(s.objects).toHaveLength(1);
    expect((s.objects[0] as TextObject).text.paragraphs[0].runs[0].fontSize).toBe(36);
    const c = text('t3', '제목입니다', 200, 0);
    const s2 = morphScene({ from: [a], to: [c], p: 0.5 });
    expect(s2.objects.map((o) => [o.id, o.x, s2.frames.get(o.id)!.opacity])).toEqual([
      ['mx:t', 100, 0.5],
      ['mp:t3', 100, 0.5],
    ]);
  });
});

describe('모핑: 단어·문자', () => {
  const tok = (text: string, x: number): MorphToken => ({ text, x, y: 0, width: 40, height: 30, style: { fontFamily: 'A', fontSize: 30, fontWeight: '400', fontStyle: 'normal', color: '#000000' } });
  it('같은 단어는 앞 자리 → 새 자리, 없어진·새 단어는 사라짐·나타남', () => {
    const sp = morphTokens([tok('분기', 0), tok('실적', 50)], [tok('실적', 0), tok('보고', 50)], 0.5, 'k');
    expect(sp.map((s) => [s.text, s.x, s.opacity])).toEqual([
      ['실적', 25, 1],
      ['보고', 50, 0.5],
      ['분기', 0, 0.5],
    ]);
    expect(splitTokens('분기 실적  보고', 'byWord')).toEqual(['분기', '실적', '보고']);
    expect(splitTokens('가 나', 'byChar')).toEqual(['가', '나']);
  });

  it('단어 옵션 + 잰 글자 묶음: 상자는 글자 없이, 글자는 묶음 단위로', () => {
    const a = text('t', '분기 실적', 0, 0), b = text('t2', '실적 보고', 100, 0);
    const tokens = new Map([
      ['t', [tok('분기', 0), tok('실적', 50)]],
      ['t2', [tok('실적', 100), tok('보고', 150)]],
    ]);
    const s = morphScene({ from: [a], to: [b], p: 1, option: 'byWord', tokens });
    expect(s.objects.map((o) => o.id)).toEqual(['mp:t2']);
    expect((s.objects[0] as TextObject).text.paragraphs[0].runs[0].text).toBe('');
    expect(s.tokens.filter((x) => x.opacity > 0).map((x) => [x.text, x.x])).toEqual([
      ['실적', 100],
      ['보고', 150],
    ]);
    // 잰 글자 묶음이 없으면 개체 단위로
    expect(morphScene({ from: [a], to: [b], p: 0.5, option: 'byWord' }).tokens).toEqual([]);
  });
});

describe('모핑: PPTX', () => {
  it('p159:morph(옵션) + 대체 페이드로 저장, 다시 가져오면 모핑·옵션·시간 그대로', async () => {
    const { produce } = await import('immer');
    const JSZip = (await import('jszip')).default;
    const { createPresentation } = await import('../../core/document/factory');
    const { addSlide } = await import('../../core/commands/commands');
    const { exportPptxBytes } = await import('../../services/export/pptxExport');
    const { importPptx } = await import('../../services/import/pptxImport');
    const { validateXml } = await import('../../test/ooxmlSchema');
    const doc = produce(createPresentation('모핑'), (d) => {
      addSlide(d, d.slides[0].id, 'blank');
      d.slides[1].transition = { type: 'morph', duration: 2000, morphOption: 'byWord', advanceOnClick: true };
    });
    const z = await JSZip.loadAsync((await exportPptxBytes(doc)).bytes);
    const x = await z.file('ppt/slides/slide2.xml')!.async('string');
    expect(x).toMatch(/<mc:Choice xmlns:p159="http:\/\/schemas.microsoft.com\/office\/powerpoint\/2015\/09\/main" Requires="p159"><p:transition spd="slow" p14:dur="2000"><p159:morph option="byWord"\/><\/p:transition><\/mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade\/><\/p:transition><\/mc:Fallback>/);
    // p159 스키마는 Open XML SDK에 없음 → Fallback 쪽과 나머지 부분만 검증됨
    expect(validateXml(x)).toEqual([]);
    const back = await importPptx(await z.generateAsync({ type: 'uint8array' }));
    expect(back.doc.slides[1].transition).toMatchObject({ type: 'morph', duration: 2000, morphOption: 'byWord' });
  });
});
