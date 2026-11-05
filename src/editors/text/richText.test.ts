import { describe, expect, it } from 'vitest';
import { htmlToParagraphs, paragraphsToHtml, computeNumbers } from './richText';
import type { Paragraph } from '../../types/model';

describe('richText 왕복 변환', () => {
  it('문단/런 스타일 보존', () => {
    const paras: Paragraph[] = [
      { runs: [{ text: '굵은 ', bold: true, fontSize: 24, color: '#FF0000', fontFamily: 'Arial' }, { text: '보통', fontSize: 24, color: '#000000', fontFamily: 'Arial' }], align: 'center', lineSpacing: 1.5, bullet: 'none', level: 0 },
      { runs: [{ text: '항목', italic: true, underline: true, fontSize: 18, color: '#0000FF', fontFamily: 'Arial' }], align: 'left', lineSpacing: 1, bullet: 'bullet', level: 1 },
      { runs: [{ text: '', fontSize: 18, color: '#000000', fontFamily: 'Arial' }], align: 'left', lineSpacing: 1, bullet: 'none', level: 0 },
    ];
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = paragraphsToHtml(paras);
    const back = htmlToParagraphs(root);
    expect(back).toHaveLength(3);
    expect(back[0].align).toBe('center');
    expect(back[0].lineSpacing).toBe(1.5);
    expect(back[0].runs[0]).toMatchObject({ text: '굵은 ', bold: true, fontSize: 24, color: '#FF0000', fontFamily: 'Arial' });
    expect(back[0].runs[1]).toMatchObject({ text: '보통', bold: false });
    expect(back[1]).toMatchObject({ bullet: 'bullet', level: 1 });
    expect(back[1].runs[0]).toMatchObject({ italic: true, underline: true, color: '#0000FF' });
    expect(back[2].runs[0].text).toBe('');
  });
  it('번호 매기기 계산', () => {
    expect(computeNumbers([{ bullet: 'number', level: 0 }, { bullet: 'number', level: 0 }, { bullet: 'number', level: 1 }, { bullet: 'number', level: 0 }])).toEqual(['1.', '2.', '1.', '3.']);
  });
});
