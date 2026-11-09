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
import type { MorphOption, MorphToken } from './morph';

type Doc = Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>;

/** React가 렌더하는 중에는 flushSync를 쓸 수 없으므로 다음 작업 차례에 그려서 잰다 */
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
        };
        let cur: MorphToken | null = null;
        const flush = () => {
          if (cur) tokens.push(cur);
          cur = null;
        };
        let i = 0;
        for (const ch of node.data) {
          range.setStart(node, i);
          range.setEnd(node, i + ch.length);
          i += ch.length;
          if (/\s/.test(ch)) {
            flush();
            continue;
          }
          const rects = range.getClientRects();
          const r = rects[rects.length - 1];
          if (!r || r.width <= 0) continue;
          const box = { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
          // 단어: 같은 줄에서 이어지는 글자를 묶음 / 문자: 글자마다
          const c = cur as MorphToken | null;
          if (option === 'byWord' && c && Math.abs(box.y - c.y) < box.height / 2) {
            c.text += ch;
            c.width = box.x + box.width - c.x;
            continue;
          }
          flush();
          cur = { text: ch, ...box, style };
        }
        flush();
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
