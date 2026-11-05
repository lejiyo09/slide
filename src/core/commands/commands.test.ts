import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createPresentation, createShape, createTextBox } from '../document/factory';
import * as C from './commands';

const base = () => {
  const doc = createPresentation('t');
  return produce(doc, (d) => {
    C.addSlide(d, d.slides[0].id, 'blank');
    C.addSlide(d, d.slides[1].id, 'blank');
  });
};

describe('슬라이드 명령', () => {
  it('추가/복제/삭제', () => {
    let doc = base();
    expect(doc.slides).toHaveLength(3);
    doc = produce(doc, (d) => void C.duplicateSlides(d, [d.slides[0].id]));
    expect(doc.slides).toHaveLength(4);
    expect(doc.slides[1].layout).toBe(doc.slides[0].layout);
    expect(doc.slides[1].id).not.toBe(doc.slides[0].id);
    doc = produce(doc, (d) => void C.deleteSlides(d, [d.slides[0].id, d.slides[1].id]));
    expect(doc.slides).toHaveLength(2);
  });
  it('모두 삭제해도 1장 유지', () => {
    let doc = base();
    doc = produce(doc, (d) => void C.deleteSlides(d, d.slides.map((s) => s.id)));
    expect(doc.slides).toHaveLength(1);
  });
  it('순서 이동', () => {
    let doc = base();
    const [a, b, c] = doc.slides.map((s) => s.id);
    doc = produce(doc, (d) => C.moveSlides(d, [a], 3));
    expect(doc.slides.map((s) => s.id)).toEqual([b, c, a]);
    doc = produce(doc, (d) => C.moveSlidesBy(d, [a], -1));
    expect(doc.slides.map((s) => s.id)).toEqual([b, a, c]);
    doc = produce(doc, (d) => C.moveSlides(d, [c, b], 0));
    expect(doc.slides.map((s) => s.id)).toEqual([b, c, a]);
  });
  it('섹션 추가 시 기본 구역 자동 생성, 시작 슬라이드 삭제 시 이동', () => {
    let doc = base();
    const [, b, c] = doc.slides.map((s) => s.id);
    doc = produce(doc, (d) => void C.addSection(d, b, '본론'));
    expect(doc.sections.map((s) => s.name)).toEqual(['기본 구역', '본론']);
    doc = produce(doc, (d) => void C.deleteSlides(d, [b]));
    expect(doc.sections.find((s) => s.name === '본론')?.startSlideId).toBe(c);
  });
});

describe('객체 명령', () => {
  const withObjs = () => {
    const doc = createPresentation();
    const sid = doc.slides[0].id;
    const a = createShape('rect', 100, 100, 100, 100);
    const b = createShape('ellipse', 300, 200, 50, 50);
    const t = createTextBox({ x: 10, y: 10, text: '안녕' });
    return { sid, a, b, t, doc: produce(doc, (d) => { d.slides[0].objects = [a, b, t]; }) };
  };
  it('레이어 순서', () => {
    const { sid, a, b, t, doc } = withObjs();
    const d1 = produce(doc, (d) => C.reorderObjects(d, sid, [a.id], 'front'));
    expect(d1.slides[0].objects.map((o) => o.id)).toEqual([b.id, t.id, a.id]);
    const d2 = produce(doc, (d) => C.reorderObjects(d, sid, [t.id], 'backward'));
    expect(d2.slides[0].objects.map((o) => o.id)).toEqual([a.id, t.id, b.id]);
  });
  it('정렬', () => {
    const { sid, a, b, doc } = withObjs();
    const d1 = produce(doc, (d) => C.alignObjects(d, sid, [a.id, b.id], 'left'));
    expect(d1.slides[0].objects[1].x).toBe(100);
    const d2 = produce(doc, (d) => C.alignObjects(d, sid, [a.id], 'center'));
    expect(d2.slides[0].objects[0].x).toBe((1280 - 100) / 2);
  });
  it('그룹화/해제 시 좌표 보존', () => {
    const { sid, a, b, doc } = withObjs();
    let gid = '';
    const g = produce(doc, (d) => void (gid = C.groupObjects(d, sid, [a.id, b.id])!));
    const group = g.slides[0].objects.find((o) => o.id === gid)!;
    expect(group.type).toBe('group');
    expect(group.x).toBe(100);
    expect(group.width).toBe(250);
    const u = produce(g, (d) => void C.ungroupObjects(d, sid, [gid]));
    const xs = u.slides[0].objects.filter((o) => o.type === 'shape').map((o) => [o.x, o.y]);
    expect(xs).toEqual(expect.arrayContaining([[100, 100], [300, 200]]));
  });
  it('굵게 토글', () => {
    const { sid, t, doc } = withObjs();
    const d1 = produce(doc, (d) => C.updateObjects(d, sid, [t.id], (o) => void C.toggleRunFlag(o, 'bold')));
    const o1 = d1.slides[0].objects[2];
    expect(o1.type === 'text' && o1.text.paragraphs[0].runs[0].bold).toBe(true);
    const d2 = produce(d1, (d) => C.updateObjects(d, sid, [t.id], (o) => void C.toggleRunFlag(o, 'bold')));
    const o2 = d2.slides[0].objects[2];
    expect(o2.type === 'text' && o2.text.paragraphs[0].runs[0].bold).toBe(false);
  });
  it('선 끝점 설정/조회 왕복', () => {
    const { doc } = withObjs();
    const line = produce(doc.slides[0].objects[0], (o) => C.setLineEndpoints(o, 300, 50, 100, 250));
    expect(C.lineEndpoints(line)).toEqual({ x1: 300, y1: 50, x2: 100, y2: 250 });
  });
});
