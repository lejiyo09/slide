/**
 * 수식 글꼴: STIX Two Math (SIL OFL 1.1, @fontsource/stix-two-math).
 * fontsource CSS는 라틴 글자 범위(unicode-range)만 지정하지만 파일에는 수학 기호 전체와 MATH 표가 들어 있어 범위 없이 등록한다.
 * 어느 컴퓨터에서나 같은 모양으로 보이도록 시스템 수학 글꼴(Cambria Math)보다 먼저 쓴다.
 */
import stixUrl from '@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2?url';

export const MATH_FONT_FAMILY = 'STIX Two Math';
export const MATH_FONT_URL = stixUrl;
export const MATH_FONT_STACK = `"${MATH_FONT_FAMILY}", "Cambria Math", "Latin Modern Math", math`;

let added = false;
export function ensureMathFont(doc: Document = document) {
  if (doc === document && added) return;
  if (doc === document) added = true;
  if (doc.getElementById('sl-math-font')) return;
  const style = doc.createElement('style');
  style.id = 'sl-math-font';
  style.textContent = `@font-face{font-family:"${MATH_FONT_FAMILY}";src:url("${new URL(stixUrl, location.href).href}") format("woff2");font-display:swap;}`;
  doc.head.appendChild(style);
}
