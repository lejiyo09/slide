/** 무늬 채우기 타일 (PPTX a:pattFill 프리셋 근사) */
import type { PatternPreset } from '../../types/model';

export const PATTERNS: { id: PatternPreset; name: string }[] = [
  { id: 'pct20', name: '점 20%' },
  { id: 'pct50', name: '점 50%' },
  { id: 'ltHorz', name: '가로선' },
  { id: 'ltVert', name: '세로선' },
  { id: 'ltUpDiag', name: '오른쪽 대각선' },
  { id: 'ltDnDiag', name: '왼쪽 대각선' },
  { id: 'smGrid', name: '작은 눈금' },
  { id: 'smCheck', name: '작은 바둑판' },
  { id: 'diagCross', name: '대각선 격자' },
  { id: 'dotGrid', name: '점선 눈금' },
  { id: 'wave', name: '물결' },
  { id: 'horzBrick', name: '벽돌' },
];

export function patternTile(preset: PatternPreset, fg: string, bg: string): { svg: string; size: number } {
  const s = 8;
  let body = '';
  switch (preset) {
    case 'pct20':
      body = `<rect x="1" y="1" width="1.6" height="1.6" fill="${fg}"/><rect x="5" y="5" width="1.6" height="1.6" fill="${fg}"/>`;
      break;
    case 'pct50':
      body = `<rect x="0" y="0" width="4" height="4" fill="${fg}"/><rect x="4" y="4" width="4" height="4" fill="${fg}"/>`;
      return wrap(body, s, bg, 4 * 2 / 2);
    case 'ltHorz':
      body = `<rect x="0" y="0" width="8" height="1.2" fill="${fg}"/><rect x="0" y="4" width="8" height="1.2" fill="${fg}"/>`;
      break;
    case 'ltVert':
      body = `<rect x="0" y="0" width="1.2" height="8" fill="${fg}"/><rect x="4" y="0" width="1.2" height="8" fill="${fg}"/>`;
      break;
    case 'ltUpDiag':
      body = `<path d="M-1,9 L9,-1 M-1,5 L5,-1 M3,9 L9,3" stroke="${fg}" stroke-width="1"/>`;
      break;
    case 'ltDnDiag':
      body = `<path d="M-1,-1 L9,9 M3,-1 L9,5 M-1,3 L5,9" stroke="${fg}" stroke-width="1"/>`;
      break;
    case 'smGrid':
      body = `<path d="M0,0.5 H8 M0.5,0 V8 M0,4.5 H8 M4.5,0 V8" stroke="${fg}" stroke-width="1"/>`;
      break;
    case 'smCheck':
      body = `<rect x="0" y="0" width="2" height="2" fill="${fg}"/><rect x="2" y="2" width="2" height="2" fill="${fg}"/><rect x="4" y="0" width="2" height="2" fill="${fg}"/><rect x="6" y="2" width="2" height="2" fill="${fg}"/><rect x="0" y="4" width="2" height="2" fill="${fg}"/><rect x="2" y="6" width="2" height="2" fill="${fg}"/><rect x="4" y="4" width="2" height="2" fill="${fg}"/><rect x="6" y="6" width="2" height="2" fill="${fg}"/>`;
      break;
    case 'diagCross':
      body = `<path d="M-1,-1 L9,9 M-1,9 L9,-1" stroke="${fg}" stroke-width="1"/>`;
      break;
    case 'dotGrid':
      body = `<rect x="0" y="0" width="1" height="1" fill="${fg}"/><rect x="2" y="0" width="1" height="1" fill="${fg}"/><rect x="4" y="0" width="1" height="1" fill="${fg}"/><rect x="6" y="0" width="1" height="1" fill="${fg}"/><rect x="0" y="4" width="1" height="1" fill="${fg}"/><rect x="0" y="2" width="1" height="1" fill="${fg}"/><rect x="0" y="6" width="1" height="1" fill="${fg}"/>`;
      break;
    case 'wave':
      body = `<path d="M0,3 Q2,1 4,3 T8,3" fill="none" stroke="${fg}" stroke-width="1"/>`;
      break;
    case 'horzBrick':
      body = `<path d="M0,0.5 H8 M0,4.5 H8 M0.5,0 V4 M4.5,4 V8" stroke="${fg}" stroke-width="1"/>`;
      break;
  }
  return wrap(body, s, bg, s);
}

function wrap(body: string, s: number, bg: string, _size: number) {
  void _size;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" fill="${bg}"/>${body}</svg>`, size: s };
}

export function patternDataUrl(preset: PatternPreset, fg: string, bg: string) {
  const { svg, size } = patternTile(preset, fg, bg);
  return { url: `data:image/svg+xml;base64,${btoa(svg)}`, size };
}
