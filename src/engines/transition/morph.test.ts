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
    expect(m.pairs.map(({ from: a, to: b }) => `${a.id}→${b.id}`).sort()).toEqual(['c→c2', 't→t2']);
    expect(m.gone.map((o) => o.id)).toEqual(['r']);
    expect(m.added.map((o) => o.id)).toEqual(['s']);
  });

  it("'!!' 이름은 같은 이름끼리만 (모양이 달라도)", () => {
    const from = [shape('a', 'ellipse', 0, 0, 100, 100, { name: '!!공' }), shape('b', 'ellipse', 0, 0, 100, 100, { name: '타원' })];
    const to = [shape('x', 'rect', 300, 0, 100, 100, { name: '!!공' }), shape('y', 'ellipse', 500, 0, 100, 100, { name: '타원' })];
    expect(matchMorph(from, to).pairs.map(({ from: p, to: q }) => `${p.id}→${q.id}`).sort()).toEqual(['a→x', 'b→y']);
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

/* ───────────── 명세 테스트 1~11 (+ 매칭 규칙·이징·경로) ───────────── */
import { buildMorphPlan, cubicBezier, easingOf, matchTokens, morphFrame } from './morph';
import { flattenPath, preparePathMorph, signedArea } from './pathMorph';
import { cloneObject, cloneSlide, createImage, createSlide } from '../../core/document/factory';
import type { ImageObject } from '../../types/model';

const at = (from: SlideObject[], to: SlideObject[], p: number, extra: Record<string, unknown> = {}) => morphFrame(buildMorphPlan({ from, to, easing: { easing: 'linear' }, ...extra }), p);
const img = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ImageObject> = {}) => ({ ...createImage('asset1', 800, 600, { width: 1280, height: 720, preset: 'wide' } as never), id, x, y, width: w, height: h, ...extra }) as ImageObject;

describe('명세 테스트', () => {
  it('1. 원의 좌우 이동: 중간에는 중간 자리', () => {
    const s = at([shape('a', 'ellipse', 0, 300)], [shape('b', 'ellipse', 1000, 300)], 0.5);
    expect(s.objects.map((o) => [o.x, o.y])).toEqual([[500, 300]]);
  });
  it('2. 크기: 작은 원 → 큰 원', () => {
    const s = at([shape('a', 'ellipse', 0, 0, 100, 100)], [shape('b', 'ellipse', 0, 0, 300, 300)], 0.25);
    expect([s.objects[0].width, s.objects[0].height]).toEqual([150, 150]);
  });
  it('3. 색: 파랑 → 빨강 (점진)', () => {
    const c = (p: number) => ((at([shape('a', 'ellipse', 0, 0, 100, 100, { fill: { type: 'solid', color: '#0000FF' } })], [shape('b', 'ellipse', 0, 0, 100, 100, { fill: { type: 'solid', color: '#FF0000' } })], p).objects[0] as ShapeObject).fill as { color: string }).color;
    expect([c(0), c(0.25), c(0.5), c(1)]).toEqual(['#0000FF', '#4000BF', '#800080', '#FF0000']);
  });
  it('4. 복합: 이동 + 확대 + 회전 + 색이 동시에', () => {
    const s = at([shape('a', 'rect', 0, 0, 100, 100, { rotation: 0, fill: { type: 'solid', color: '#000000' } })], [shape('b', 'rect', 200, 100, 300, 200, { rotation: 90, fill: { type: 'solid', color: '#FFFFFF' } })], 0.5);
    const o = s.objects[0] as ShapeObject;
    expect([o.x, o.y, o.width, o.height, o.rotation, (o.fill as { color: string }).color]).toEqual([100, 50, 200, 150, 45, '#808080']);
  });
  it("5. 도형 변형: 원 → 사각형('!!' 이름으로 연결)은 경로 모핑 (중간은 둘 사이 모양)", () => {
    const A = () => shape('a', 'ellipse', 0, 0, 100, 100, { name: '!!도형' }), B = () => shape('b', 'rect', 0, 0, 100, 100, { name: '!!도형' });
    const s0 = at([A()], [B()], 0);
    const s1 = at([A()], [B()], 1);
    const s5 = at([A()], [B()], 0.5);
    const pts = (s: ReturnType<typeof at>) => ((s.objects[0] as ShapeObject).geometry!.paths[0].cmds.filter((c) => c.c !== 'Z') as { x: number; y: number }[]).map((c) => [c.x - 0.5, c.y - 0.5]);
    expect(s5.objects).toHaveLength(1);
    expect((s5.objects[0] as ShapeObject).shape).toBe('custom');
    // 처음: 모든 점이 원 위 (반지름 0.5), 끝: 사각형 둘레 (max(|x|,|y|) = 0.5), 중간: 원과 사각형 사이
    expect(pts(s0).every(([x, y]) => Math.abs(Math.hypot(x, y) - 0.5) < 0.01)).toBe(true);
    expect(pts(s1).every(([x, y]) => Math.abs(Math.max(Math.abs(x), Math.abs(y)) - 0.5) < 0.01)).toBe(true);
    const corner = Math.max(...pts(s5).map(([x, y]) => Math.hypot(x, y)));
    expect(corner).toBeGreaterThan(0.55);
    expect(corner).toBeLessThan(0.7);
    // 원 → 별, 삼각형 → 오각형, 사각형 → 둥근 사각형도 경로 모핑
    for (const [k1, k2] of [['ellipse', 'star5'], ['triangle', 'pentagon'], ['rect', 'roundRect']] as const) expect((at([shape('a', k1, 0, 0, 100, 100, { name: '!!s' })], [shape('b', k2, 0, 0, 100, 100, { name: '!!s' })], 0.5).objects[0] as ShapeObject).shape).toBe('custom');
    // 이름이 없으면 모양이 다른 도형은 자동으로 짝짓지 않음 (PowerPoint와 같음)
    expect(at([shape('a', 'ellipse', 0, 0)], [shape('b', 'rect', 0, 0)], 0.5).objects.map((o) => o.id)).toEqual(['mo:a', 'mn:b']);
  });
  it('5-1. 윤곽 수가 다르면 무리하지 않고 교차 전환', () => {
    const ring = { type: 'shape', shape: 'custom', geometry: { paths: [{ cmds: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'L', x: 0, y: 1 }, { c: 'Z' }, { c: 'M', x: 0.3, y: 0.3 }, { c: 'L', x: 0.3, y: 0.7 }, { c: 'L', x: 0.7, y: 0.7 }, { c: 'L', x: 0.7, y: 0.3 }, { c: 'Z' }], fill: true, stroke: true }] } };
    const s = at([shape('a', 'ellipse', 0, 0, 100, 100, { name: '!!r' })], [shape('b', 'custom', 0, 0, 100, 100, { ...(ring as Partial<ShapeObject>), name: '!!r' })], 0.5);
    expect(s.objects.map((o) => o.id)).toEqual(['mx:a', 'mp:b']);
  });
  it('6·7. 등장·퇴장: 새 그림은 나타나고 지운 그림은 사라짐', () => {
    const s = at([img('old', 0, 0, 100, 100, { assetId: 'x' })], [img('new', 500, 0, 100, 100, { assetId: 'y' })], 0.3);
    // 다른 그림이고 이름도 다르면 짝 없음
    expect(s.objects.map((o) => [o.id, +s.frames.get(o.id)!.opacity!.toFixed(2)])).toEqual([
      ['mo:old', 0.7],
      ['mn:new', 0.3],
    ]);
  });
  it('8. 그림 확대·자르기: 자르기 영역도 사이값', () => {
    const a = img('a', 0, 0, 1280, 720, { crop: { left: 0, top: 0, right: 0, bottom: 0 } });
    const b = img('b', 0, 0, 1280, 720, { crop: { left: 0.2, top: 0.1, right: 0.2, bottom: 0.3 } });
    const o = at([a], [b], 0.5).objects[0] as ImageObject;
    expect(o.crop).toEqual({ left: 0.1, top: 0.05, right: 0.1, bottom: 0.15 });
    // 같은 morphKey의 다른 그림: 틀은 이어지고 내용은 교차 전환
    const c = img('c', 100, 0, 200, 200, { assetId: 'other', morphKey: 'k' }), d = img('d', 300, 0, 200, 200, { assetId: 'another', morphKey: 'k' });
    expect(at([c], [d], 0.5).objects.map((x) => [x.id, x.x])).toEqual([
      ['mx:c', 200],
      ['mp:d', 200],
    ]);
  });
  it('9. 텍스트: 단어 순서 바꾸기·문자 이동 (LCS + 이동), 같은 단어 여러 번, 이모지·한국어', () => {
    expect(matchTokens(['HELLO', 'WORLD'], ['WORLD', 'HELLO'])).toEqual([1, 0]);
    expect(matchTokens([...'ABCDE'], [...'EDCBA'])).toEqual([4, 3, 2, 1, 0]);
    // 같은 단어가 여러 번이면 순서대로
    expect(matchTokens(['a', 'b', 'a'], ['a', 'a', 'c'])).toEqual([0, 2, -1]);
    expect(splitTokens('👨‍👩‍👧 가나', 'byChar')).toEqual(['👨‍👩‍👧', '가', '나']);
    expect(splitTokens('분기 실적, 2026년!', 'byWord')).toEqual(['분기', '실적', ',', '2026년', '!']);
  });
  it('10. 복제 슬라이드: 개체 ID는 새로, morphKey는 유지 → 옮겨도 자동 짝 / 같은 슬라이드 복제는 새 키', () => {
    const s = createSlide('blank', { width: 1280, height: 720, preset: 'wide' } as never);
    s.objects = [shape('o1', 'ellipse', 0, 0), shape('o2', 'ellipse', 600, 0)];
    const dup = cloneSlide(s);
    expect(dup.objects.map((o) => o.id)).not.toEqual(['o1', 'o2']);
    expect(dup.objects.map((o) => o.morphKey)).toEqual(['o1', 'o2']);
    // 복제본에서 두 원의 자리를 맞바꿔도 내용이 아니라 식별자로 짝
    dup.objects[0].x = 600;
    dup.objects[1].x = 0;
    const m = matchMorph(s.objects, dup.objects);
    expect(m.pairs.map((p) => [p.from.id, p.to.x, p.reason])).toEqual([
      ['o1', 600, 'morphKey'],
      ['o2', 0, 'morphKey'],
    ]);
    const same = cloneObject(s.objects[0], 20);
    expect(same.morphKey).toBeUndefined();
    expect(cloneObject(dup.objects[0], 0, true).morphKey).toBe('o1');
  });
  it('11. 회전 350° → 10°는 20°만, 명시한 여러 바퀴(0° → 720°)는 그대로', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0);
    expect(lerpAngle(0, 720, 0.5)).toBe(360);
  });
});

describe('매칭 규칙·경고·이징·뒤집기·경로', () => {
  it("우선순위: morphKey > '!!' 이름 > 자동, !! 중복 경고, 연결 안 함", () => {
    const a1 = shape('a1', 'ellipse', 0, 0, 100, 100, { name: '!!X' }), a2 = shape('a2', 'ellipse', 0, 0, 100, 100, { name: '!!X' });
    const b1 = shape('b1', 'rect', 0, 0, 100, 100, { name: '!!X' });
    const m = matchMorph([a1, a2], [b1]);
    expect(m.pairs.map((p) => [p.from.id, p.reason])).toEqual([['a1', 'name']]);
    expect(m.warnings[0]).toContain("'!!X' 이름이 2개");
    // morphKey가 이름보다 먼저
    const k = matchMorph([a1, a2], [{ ...b1, morphKey: 'a2' }]);
    expect(k.pairs.map((p) => [p.from.id, p.reason])).toEqual([['a2', 'morphKey']]);
    // 연결 안 함
    const x = matchMorph([shape('c', 'ellipse', 0, 0)], [shape('d', 'ellipse', 0, 0, 100, 100, { morphExclude: true })]);
    expect([x.pairs.length, x.added.length]).toEqual([0, 1]);
  });
  it('자동 짝이 모호하면 표시', () => {
    const m = matchMorph([shape('a', 'ellipse', 0, 0), shape('b', 'ellipse', 300, 0)], [shape('c', 'ellipse', 600, 0)]);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].ambiguous).toBe(true);
    expect(m.pairs[0].reason).toBe('auto');
  });
  it('이징: linear·ease-in·ease-out·ease-in-out·cubic-bezier', () => {
    expect(easingOf({ easing: 'linear' })(0.3)).toBeCloseTo(0.3);
    expect(easingOf({ easing: 'easeIn' })(0.5)).toBeLessThan(0.5);
    expect(easingOf({ easing: 'easeOut' })(0.5)).toBeGreaterThan(0.5);
    expect(easingOf()(0.5)).toBeCloseTo(0.5);
    expect(cubicBezier(0.42, 0, 1, 1)(0.5)).toBeCloseTo(0.3153, 3); // CSS ease-in
    expect(easingOf({ easing: 'cubicBezier', bezier: [0, 0, 1, 1] })(0.37)).toBeCloseTo(0.37, 4);
  });
  it('뒤집기: 가로 배율이 -1 → 1로 지나감', () => {
    const s = at([shape('a', 'rightArrow', 0, 0, 100, 50)], [shape('b', 'rightArrow', 0, 0, 100, 50, { flipH: true })], 0.25);
    expect(s.frames.get(s.objects[0].id)!.sx).toBeCloseTo(-0.5);
  });
  it('경로: 호(A)·곡선 평탄화, 방향·넓이', () => {
    const [ring] = flattenPath('M0,50 A50,50 0 1 1 100,50 A50,50 0 1 1 0,50 Z');
    expect(ring.closed).toBe(true);
    expect(ring.pts.every(([x, y]) => Math.abs(Math.hypot(x - 50, y - 50) - 50) < 0.01)).toBe(true);
    expect(Math.abs(signedArea(ring.pts))).toBeGreaterThan(7700);
    expect(preparePathMorph('M0,0 L1,0 L1,1 Z', 'M0,0 L1,0 L1,1 L0,1 Z')!.rings[0][0]).toHaveLength(128);
    expect(preparePathMorph('M0,0 L1,0', 'M0,0 L1,0 L1,1 Z')).toBeNull();
  });
});
