/**
 * 디자인 템플릿 (자체 디자인): 테마 + 마스터 디자인 개체 + 레이아웃 배경/장식.
 * 모든 색은 테마 토큰으로 지정해 색 조합을 바꾸면 템플릿 장식도 함께 바뀐다.
 */
import type { Fill, PlaceholderType, ShapeKind, SlideObject, SlideSize, TextRunStyle, Theme } from '../types/model';
import { createShape } from '../core/document/factory';
import { THEMES } from './themes';

export interface TemplateDesign {
  master: SlideObject[];
  masterBackground?: Fill;
  placeholderStyle?: Partial<Record<PlaceholderType, Partial<TextRunStyle>>>;
  layouts?: Record<string, { objects?: SlideObject[]; background?: Fill; hideMaster?: boolean; placeholderStyle?: Partial<Record<PlaceholderType, Partial<TextRunStyle>>> }>;
}

export interface DesignTemplate {
  id: string;
  name: string;
  theme: Theme;
  build: (size: SlideSize) => TemplateDesign;
}

function deco(kind: ShapeKind, x: number, y: number, w: number, h: number, color: string, opacity?: number): SlideObject {
  const s = createShape(kind, x, y, w, h);
  s.name = '디자인 요소';
  s.fill = { type: 'solid', color, ...(opacity !== undefined ? { opacity } : {}) };
  s.stroke = null;
  s.locked = true;
  return s;
}

const theme = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export const TEMPLATES: DesignTemplate[] = [
  {
    id: 'plain',
    name: '기본',
    theme: theme('office-clean'),
    build: () => ({ master: [] }),
  },
  {
    id: 'accent-bar',
    name: '강조 막대',
    theme: theme('office-clean'),
    build: ({ width: W, height: H }) => ({
      master: [deco('rect', 0, 0, W, 10, '@accent1'), deco('rect', W * 0.07, H * 0.225, W * 0.12, 4, '@accent2')],
      layouts: {
        title: {
          hideMaster: true,
          objects: [deco('rect', 0, H * 0.62, W, H * 0.38, '@accent1'), deco('rect', 0, H * 0.6, W, 8, '@accent2')],
          placeholderStyle: { subTitle: { color: '@light1' } },
        },
        sectionHeader: { hideMaster: true, background: { type: 'solid', color: '@accent1' }, placeholderStyle: { title: { color: '@light1' }, body: { color: '@light1^0.0' } } },
      },
    }),
  },
  {
    id: 'side-band',
    name: '사이드 밴드',
    theme: theme('forest'),
    build: ({ width: W, height: H }) => ({
      master: [deco('rect', 0, 0, W * 0.025, H, '@accent1'), deco('rect', W * 0.025, 0, 4, H, '@accent2')],
      placeholderStyle: { title: { color: '@accent1~0.75' } },
      layouts: {
        title: {
          hideMaster: true,
          objects: [deco('rect', 0, 0, W * 0.38, H, '@accent1'), deco('ellipse', W * 0.28, H * 0.62, H * 0.34, H * 0.34, '@accent2', 0.85)],
          background: { type: 'solid', color: '@light2' },
        },
      },
    }),
  },
  {
    id: 'geometric',
    name: '기하학',
    theme: theme('sunrise'),
    build: ({ width: W, height: H }) => ({
      master: [deco('ellipse', W - H * 0.22, -H * 0.1, H * 0.32, H * 0.32, '@accent1', 0.18), deco('ellipse', W - H * 0.12, H * 0.08, H * 0.16, H * 0.16, '@accent3', 0.35), deco('triangle', -H * 0.05, H * 0.86, H * 0.2, H * 0.18, '@accent2', 0.3)],
      layouts: {
        title: {
          objects: [deco('ellipse', -H * 0.25, -H * 0.25, H * 0.7, H * 0.7, '@accent1', 0.15), deco('ellipse', W - H * 0.4, H * 0.55, H * 0.6, H * 0.6, '@accent2', 0.18)],
        },
      },
    }),
  },
  {
    id: 'soft-gradient',
    name: '부드러운 그라데이션',
    theme: theme('office-clean'),
    build: ({ width: W, height: H }) => ({
      master: [deco('rect', 0, H - 6, W, 6, '@accent5')],
      masterBackground: { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '@light1' }, { offset: 1, color: '@accent5^0.85' }] },
      placeholderStyle: { title: { color: '@accent1~0.5' } },
      layouts: {
        title: { background: { type: 'gradient', angle: 135, stops: [{ offset: 0, color: '@accent1~0.5' }, { offset: 1, color: '@accent5' }] }, hideMaster: true, placeholderStyle: { ctrTitle: { color: '@light1' }, subTitle: { color: '@light1' } } },
      },
    }),
  },
  {
    id: 'dark-stage',
    name: '어두운 무대',
    theme: theme('midnight'),
    build: ({ width: W, height: H }) => ({
      master: [deco('rect', W * 0.07, H * 0.215, W * 0.08, 5, '@accent1'), deco('rect', 0, H - 4, W, 4, '@accent2')],
      layouts: {
        title: { objects: [deco('chevron', W * 0.07, H * 0.2, H * 0.08, H * 0.08, '@accent1'), deco('rect', 0, H * 0.72, W, 3, '@accent2', 0.6)] },
      },
    }),
  },
];
