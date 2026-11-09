/**
 * 모핑 단어/문자 옵션: 슬라이드를 화면 밖에 그려 텍스트 개체마다 단어(또는 문자)의 화면 상자와 글자 서식을 잰다.
 * (그린 결과 그대로의 자리이므로 줄 바꿈·맞춤·글꼴이 실제 화면과 같다)
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Presentation, Slide } from '../../types/model';
import { SlideView } from '../rendering/SlideView';
import { cssColorToHex } from '../../utils/color';
import { segmentText, type MorphOption, type MorphToken } from './morph';

type Doc = Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>;

/** 글자를 단어 또는 그래핌으로 나눔 (morph.ts와 같은 규칙) */
export const segmentsOf = (text: string, option: MorphOption) => segmentText(text, option);

export async function measureMorphTokens(doc: Doc, slide: Slide, option: MorphOption, ids?: Set<string>): Promise<Map<string, MorphToken[]>> {
  const out = new Map<string, MorphToken[]>();
  if (option === 'byObject' || typeof document === 'undefined') return out;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${doc.size.width}px`, height: `${doc.size.height}px`, overflow: 'hidden', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => root.render(createElement(SlideView, { slide, doc, mode: 'show' })));
    const base = host.getBoundingClientRect();
    const range = document.createRange();
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('[data-obj-id]'))) {
      const id = el.dataset.objId!;
      if (ids && !ids.has(id)) continue;
      const tokens: MorphToken[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        if (!parent || parent.closest('.sl-math-inline')) continue;
        const cs = getComputedStyle(parent);
        const style = {
          fontFamily: cs.fontFamily,
          fontSize: parseFloat(cs.fontSize) || 16,
          fontWeight: cs.fontWeight,
          fontStyle: cs.fontStyle,
          color: cssColorToHex(cs.color) ?? '#000000',
          ...(cs.textDecorationLine && cs.textDecorationLine !== 'none' ? { textDecoration: cs.textDecorationLine } : {}),
          ...(cs.letterSpacing && cs.letterSpacing !== 'normal' ? { letterSpacing: cs.letterSpacing } : {}),
        };
        // 단어: Intl.Segmenter(단어) / 문자: Intl.Segmenter(그래핌 = 이모지·결합 문자도 한 글자). 공백은 건너뜀
        let i = 0;
        for (const seg of segmentsOf(node.data, option)) {
          const from = i;
          i += seg.length;
          if (/^\s+$/.test(seg)) continue;
          range.setStart(node, from);
          range.setEnd(node, from + seg.length);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
          if (!rects.length) continue;
          // 줄이 바뀌며 둘로 나뉜 단어는 첫 줄 부분의 상자를 씀
          const r = rects[0];
          tokens.push({ text: seg, x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height, style });
        }
      }
      out.set(id, tokens);
    }
    range.detach();
  } finally {
    root.unmount();
    host.remove();
  }
  return out;
}
