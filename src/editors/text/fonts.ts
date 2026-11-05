/** 글꼴 목록: 사용자의 시스템에 설치된 글꼴로 렌더링됨(웹폰트 내장은 향후 단계) */
export const FONT_FAMILIES = [
  'Malgun Gothic',
  '맑은 고딕',
  'Noto Sans KR',
  'Nanum Gothic',
  'Batang',
  'Gulim',
  'Dotum',
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Segoe UI',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Garamond',
  'Courier New',
  'Consolas',
  'Impact',
];

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

/** CSS font-family 스택: 한글 대체 글꼴 포함 */
export const cssFontStack = (family?: string) =>
  `"${family ?? 'Malgun Gothic'}", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
