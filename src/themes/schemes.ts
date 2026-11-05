/** 색 조합 / 글꼴 조합 프리셋 (자체 구성) */
import type { ThemeColors } from '../types/model';
import { THEMES } from './themes';

export interface ColorScheme {
  id: string;
  name: string;
  colors: ThemeColors;
}

const c = (dark1: string, light1: string, dark2: string, light2: string, a: string[]): ThemeColors => ({
  dark1, light1, dark2, light2, accent1: a[0], accent2: a[1], accent3: a[2], accent4: a[3], accent5: a[4], accent6: a[5],
});

export const COLOR_SCHEMES: ColorScheme[] = [
  ...THEMES.map((t) => ({ id: `theme-${t.id}`, name: t.name, colors: t.colors })),
  { id: 'blue', name: '파랑', colors: c('#000000', '#FFFFFF', '#17406D', '#DBEFF9', ['#0F6FC6', '#009DD9', '#0BD0D9', '#10CF9B', '#7CCA62', '#A5C249']) },
  { id: 'blue-green', name: '청록', colors: c('#000000', '#FFFFFF', '#373545', '#DEF5FA', ['#3494BA', '#58B6C0', '#75BDA7', '#7A8C8E', '#84ACB6', '#2683C6']) },
  { id: 'green', name: '녹색', colors: c('#000000', '#FFFFFF', '#455F51', '#E3DED1', ['#549E39', '#8AB833', '#C0CF3A', '#029676', '#4AB5C4', '#0989B1']) },
  { id: 'yellow-orange', name: '노랑 주황', colors: c('#000000', '#FFFFFF', '#4E3B30', '#FBEEC9', ['#F0A22E', '#A5644E', '#B58B80', '#C3986D', '#A19574', '#C17529']) },
  { id: 'orange-red', name: '주황 빨강', colors: c('#000000', '#FFFFFF', '#505046', '#EEECE1', ['#E84C22', '#FFBD47', '#B64926', '#FF8427', '#CC9900', '#B22600']) },
  { id: 'red-violet', name: '빨강 보라', colors: c('#000000', '#FFFFFF', '#454551', '#D8D9DC', ['#E32D91', '#C830CC', '#4EA6DC', '#4775E7', '#8971E1', '#D54773']) },
  { id: 'violet', name: '보라', colors: c('#000000', '#FFFFFF', '#373545', '#DCD8DC', ['#AD84C6', '#8784C7', '#5D739A', '#6997AF', '#84ACB6', '#6F8183']) },
  { id: 'grayscale', name: '회색조', colors: c('#000000', '#FFFFFF', '#000000', '#F8F8F8', ['#DDDDDD', '#B2B2B2', '#969696', '#808080', '#5F5F5F', '#4D4D4D']) },
  { id: 'warm', name: '따뜻한 색', colors: c('#000000', '#FFFFFF', '#3F2731', '#F4E7ED', ['#FF6D4E', '#F7A84B', '#E2435D', '#C94F7C', '#9E5E9B', '#7B6FA6']) },
];

export interface FontScheme {
  id: string;
  name: string;
  heading: string;
  body: string;
}

export const FONT_SCHEMES: FontScheme[] = [
  { id: 'malgun', name: '맑은 고딕', heading: 'Malgun Gothic', body: 'Malgun Gothic' },
  { id: 'noto', name: 'Noto Sans KR', heading: 'Noto Sans KR', body: 'Noto Sans KR' },
  { id: 'nanum', name: '나눔고딕', heading: 'Nanum Gothic', body: 'Nanum Gothic' },
  { id: 'serif', name: '명조 계열', heading: 'Batang', body: 'Malgun Gothic' },
  { id: 'segoe', name: 'Segoe UI', heading: 'Segoe UI', body: 'Segoe UI' },
  { id: 'calibri', name: 'Calibri Light / Calibri', heading: 'Calibri Light', body: 'Calibri' },
  { id: 'arial', name: 'Arial', heading: 'Arial', body: 'Arial' },
  { id: 'georgia', name: 'Georgia / Verdana', heading: 'Georgia', body: 'Verdana' },
  { id: 'trebuchet', name: 'Trebuchet MS', heading: 'Trebuchet MS', body: 'Trebuchet MS' },
  { id: 'times', name: 'Times New Roman / Arial', heading: 'Times New Roman', body: 'Arial' },
];
