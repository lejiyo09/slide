import { describe, expect, it } from 'vitest';
import { playingVideos, videoLayers, videoTime } from './videoExport';
import type { Slide, SlideObject } from '../../types/model';

const box = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };
const shape = (id: string) => ({ id, type: 'shape', name: id, shape: 'rect', ...box }) as unknown as SlideObject;
const video = (id: string, extra: object = {}) => ({ id, type: 'media', kind: 'video', name: id, assetId: 'a', autoPlay: true, ...box, ...extra }) as SlideObject;

describe('비디오 내보내기: 동영상 개체', () => {
  it('자동 재생 동영상만 재생 (클릭 재생·쇼 중 숨김·소리는 제외)', () => {
    const slide = { id: 's', objects: [video('v1'), video('v2', { autoPlay: false }), video('v3', { hideInShow: true }), { ...video('au'), kind: 'audio' }] } as unknown as Slide;
    expect(playingVideos(slide).map((o) => o.id)).toEqual(['v1']);
  });

  it('층 나누기: 동영상 아래 / 사이 / 위 (개체 순서 기준)', () => {
    const slide = { id: 's', objects: [shape('bg'), video('v1'), shape('a'), shape('b'), video('v2'), shape('top')] } as unknown as Slide;
    const vids = playingVideos(slide);
    expect(videoLayers(slide, vids).map((l) => l.map((o) => o.id))).toEqual([['bg'], ['a', 'b'], ['top']]);
    expect(videoLayers(slide, vids.slice(0, 1)).map((l) => l.map((o) => o.id))).toEqual([['bg'], ['a', 'b', 'v2', 'top']]);
  });

  it('동영상 시각: 끝나면 마지막 프레임에 멈춤, 반복이면 되감기', () => {
    expect(videoTime(1.5, 3, false)).toBe(1.5);
    expect(videoTime(5, 3, false)).toBeCloseTo(2.999);
    expect(videoTime(-1, 3, false)).toBe(0);
    expect(videoTime(7.5, 3, true)).toBeCloseTo(1.5);
    expect(videoTime(2, 0, true)).toBe(0);
  });
});
