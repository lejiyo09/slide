import '../../test/canvasStub';
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createPresentation, createShape } from '../../core/document/factory';
import type { ShapeObject, SlideObject } from '../../types/model';
import { mergeObjects } from '../../engines/geometry/shapeBoolean';
import { slideToSvg } from './svgExport';

describe('SVG 내보내기', () => {
  it('병합 도형(구멍)·채움 규칙·그라데이션·선(화살표)·자른 그림이 벡터 요소로, 올바른 XML', async () => {
    const m = mergeObjects('subtract', [{ ...createShape('ellipse', 300, 100, 400, 400), id: 'a' } as ShapeObject, { ...createShape('ellipse', 400, 200, 200, 200), id: 'b' } as ShapeObject]).shapes[0];
    const doc = produce(createPresentation('SVG'), (d) => {
      d.assets.img = { id: 'img', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
      d.slides[0].objects = [
        { ...createShape('custom', m.x, m.y, m.width, m.height), id: 'donut', geometry: { ...m.geometry, fillRule: 'evenodd' }, fill: { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '#FF0000' }, { offset: 1, color: '#0000FF' }] }, stroke: { color: '#000000', width: 2, dash: 'dash' }, opacity: 0.8 } as ShapeObject,
        { id: 'ln', type: 'line', name: '선', x: 10, y: 10, width: 100, height: 0, rotation: 0, stroke: { color: '#00AA00', width: 3, dash: 'solid' }, headStart: 'none', headEnd: 'triangle' } as SlideObject,
        { id: 'im', type: 'image', name: '그림', x: 50, y: 400, width: 200, height: 200, rotation: 30, assetId: 'img', crop: { left: 0.1, top: 0, right: 0, bottom: 0 }, stroke: null, naturalWidth: 10, naturalHeight: 10, clip: m.geometry } as SlideObject,
      ];
    });
    const svg = await slideToSvg(doc, doc.slides[0]);
    const x = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(x.querySelector('parsererror')).toBeNull();
    const donut = [...x.querySelectorAll('path')].find((p) => p.getAttribute('fill-rule') === 'evenodd')!;
    expect(donut.getAttribute('d')!.split('M').length - 1).toBe(2);
    expect(donut.getAttribute('fill')).toMatch(/^url\(#g\d+\)$/);
    expect(x.querySelector('linearGradient stop')?.getAttribute('stop-color')).toBe('#FF0000');
    expect(svg).toContain('stroke-dasharray=');
    expect(svg).toContain('opacity="0.8"');
    expect(x.querySelector('line')?.getAttribute('marker-end')).toMatch(/url\(#m\d+\)/);
    expect(x.querySelector('clipPath path')).not.toBeNull();
    expect(x.querySelector('image')?.getAttribute('href')).toContain('data:image/png');
    expect(svg).toContain('rotate(30,100,100)');
  });
});
