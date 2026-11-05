import type { Theme } from '../types/model';

/** 기본 제공 테마 (자체 디자인) */
export const THEMES: Theme[] = [
  {
    id: 'office-clean',
    name: '기본',
    colors: {
      dark1: '#000000', light1: '#FFFFFF', dark2: '#44546A', light2: '#E7E6E6',
      accent1: '#4472C4', accent2: '#ED7D31', accent3: '#A5A5A5', accent4: '#FFC000', accent5: '#5B9BD5', accent6: '#70AD47',
    },
    fonts: { heading: 'Malgun Gothic', body: 'Malgun Gothic' },
    background: { type: 'solid', color: '#FFFFFF' },
  },
  {
    id: 'slate',
    name: '슬레이트',
    colors: {
      dark1: '#FFFFFF', light1: '#1E293B', dark2: '#E2E8F0', light2: '#334155',
      accent1: '#38BDF8', accent2: '#F472B6', accent3: '#A3E635', accent4: '#FBBF24', accent5: '#818CF8', accent6: '#34D399',
    },
    fonts: { heading: 'Segoe UI', body: 'Segoe UI' },
    background: { type: 'solid', color: '#1E293B' },
  },
  {
    id: 'sunrise',
    name: '해돋이',
    colors: {
      dark1: '#3B1F0E', light1: '#FFF8F0', dark2: '#7C2D12', light2: '#FFEDD5',
      accent1: '#EA580C', accent2: '#DC2626', accent3: '#F59E0B', accent4: '#65A30D', accent5: '#0EA5E9', accent6: '#9333EA',
    },
    fonts: { heading: 'Georgia', body: 'Malgun Gothic' },
    background: { type: 'gradient', angle: 135, stops: [{ offset: 0, color: '#FFF8F0' }, { offset: 1, color: '#FFE4CC' }] },
  },
  {
    id: 'forest',
    name: '숲',
    colors: {
      dark1: '#14281D', light1: '#F4F7F2', dark2: '#355834', light2: '#DDE7D7',
      accent1: '#2F855A', accent2: '#B7791F', accent3: '#4A5568', accent4: '#C05621', accent5: '#2C7A7B', accent6: '#6B46C1',
    },
    fonts: { heading: 'Trebuchet MS', body: 'Malgun Gothic' },
    background: { type: 'solid', color: '#F4F7F2' },
  },
  {
    id: 'midnight',
    name: '자정',
    colors: {
      dark1: '#F8FAFC', light1: '#0B1020', dark2: '#C7D2FE', light2: '#1E1B4B',
      accent1: '#6366F1', accent2: '#EC4899', accent3: '#14B8A6', accent4: '#F59E0B', accent5: '#8B5CF6', accent6: '#22C55E',
    },
    fonts: { heading: 'Arial', body: 'Arial' },
    background: { type: 'gradient', angle: 160, stops: [{ offset: 0, color: '#0B1020' }, { offset: 1, color: '#1E1B4B' }] },
  },
];

export const DEFAULT_THEME = THEMES[0];

/** 테마 배경 밝기에 따라 기본 글자색 결정 */
export const themeTextColor = (t: Theme) => t.colors.dark1;
