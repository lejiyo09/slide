/**
 * 텍스트 모델(Paragraph/TextRun) ↔ HTML(DOM) 변환.
 * 정적 렌더링과 contentEditable 편집기가 같은 DOM 구조를 사용해 화면이 일치하도록 한다.
 *
 *   <div class="sl-p" data-bullet="bullet|number|none" data-level="0" data-num="1." style="text-align;line-height;font-size">
 *     <span style="...">텍스트</span>
 *   </div>
 */
import type { HAlign, Paragraph, TextRun, TextRunStyle, BulletType } from '../../types/model';
import { cssColorToHex } from '../../utils/color';
import { ptToPx, pxToPt, round } from '../../utils/units';
import { cssFontStack } from './fonts';

export const LINE_HEIGHT_FACTOR = 1.2;
export const INDENT_PX = 36;
export const BULLET_INDENT_PX = 27;

export function runCss(r: TextRunStyle): Record<string, string> {
  const css: Record<string, string> = {};
  css['font-family'] = cssFontStack(r.fontFamily);
  css['font-size'] = `${round(ptToPx(r.fontSize ?? 18), 3)}px`;
  // 기본값(보통/없음)은 출력하지 않아 contentEditable의 execCommand 토글과 충돌하지 않게 한다
  if (r.bold) css['font-weight'] = '700';
  if (r.italic) css['font-style'] = 'italic';
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) css['text-decoration'] = deco;
  css['color'] = r.color ?? '#000000';
  if (r.highlight) css['background-color'] = r.highlight;
  return css;
}

export function paragraphCss(p: Paragraph): Record<string, string> {
  const first = p.runs[0] ?? {};
  const level = p.level ?? 0;
  const bullet = p.bullet ?? 'none';
  const css: Record<string, string> = {
    'text-align': p.align ?? 'left',
    'line-height': String(round((p.lineSpacing ?? 1) * LINE_HEIGHT_FACTOR, 3)),
    'font-size': `${round(ptToPx(first.fontSize ?? 18), 3)}px`,
    'font-family': cssFontStack(first.fontFamily),
    color: first.color ?? '#000000',
    'padding-left': `${level * INDENT_PX + (bullet !== 'none' ? BULLET_INDENT_PX : 0)}px`,
  };
  if (p.spaceBefore) css['margin-top'] = `${round(ptToPx(p.spaceBefore), 2)}px`;
  if (p.spaceAfter) css['margin-bottom'] = `${round(ptToPx(p.spaceAfter), 2)}px`;
  return css;
}

/** 번호 매기기 계산: 같은 수준의 연속된 번호 문단에 1., 2., ... */
export function computeNumbers(paragraphs: Pick<Paragraph, 'bullet' | 'level'>[]): (string | null)[] {
  const counters: number[] = [];
  return paragraphs.map((p) => {
    const lvl = p.level ?? 0;
    if (p.bullet === 'number') {
      counters.length = lvl + 1;
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      return `${counters[lvl]}.`;
    }
    counters.length = Math.min(counters.length, lvl);
    return null;
  });
}

const styleAttr = (css: Record<string, string>) =>
  Object.entries(css)
    .map(([k, v]) => `${k}:${v.replace(/"/g, "'")}`)
    .join(';');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function paragraphsToHtml(paragraphs: Paragraph[]): string {
  const nums = computeNumbers(paragraphs);
  return paragraphs
    .map((p, i) => {
      const runs = p.runs.filter((r) => r.text.length > 0);
      const inner = runs.length
        ? runs.map((r) => `<span style="${styleAttr(runCss(r))}">${escapeHtml(r.text)}</span>`).join('')
        : `<span style="${styleAttr(runCss(p.runs[0] ?? {}))}"><br></span>`;
      const attrs = [
        'class="sl-p"',
        `data-bullet="${p.bullet ?? 'none'}"`,
        `data-level="${p.level ?? 0}"`,
        nums[i] ? `data-num="${nums[i]}"` : '',
        `style="${styleAttr(paragraphCss(p))}"`,
      ]
        .filter(Boolean)
        .join(' ');
      return `<div ${attrs}>${inner}</div>`;
    })
    .join('');
}

/* ───────────── DOM → 모델 ───────────── */

function firstFamily(stack: string): string {
  const f = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return f || 'Malgun Gothic';
}

function decorationsFor(node: Node, stopAt: Element) {
  let underline = false, strike = false;
  let highlight: string | undefined;
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && el !== stopAt) {
    const tag = el.tagName;
    if (tag === 'U' || tag === 'INS') underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') strike = true;
    const st = (el as HTMLElement).style;
    if (st) {
      const d = `${st.textDecoration} ${st.textDecorationLine}`;
      if (d.includes('underline')) underline = true;
      if (d.includes('line-through')) strike = true;
      if (!highlight && st.backgroundColor) {
        const h = cssColorToHex(st.backgroundColor);
        if (h) highlight = h;
      }
    }
    el = el.parentElement;
  }
  return { underline, strike, highlight };
}

function styleOfTextNode(node: Node, paraEl: Element): TextRunStyle {
  const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement;
  const cs = getComputedStyle(el);
  const deco = decorationsFor(node, paraEl);
  const size = parseFloat(cs.fontSize);
  const style: TextRunStyle = {
    fontFamily: firstFamily(cs.fontFamily),
    fontSize: Number.isFinite(size) ? round(pxToPt(size), 1) : 18,
    bold: parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold',
    italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    underline: deco.underline,
    strike: deco.strike,
    color: cssColorToHex(cs.color) ?? '#000000',
  };
  if (deco.highlight) style.highlight = deco.highlight;
  return style;
}

const sameStyle = (a: TextRunStyle, b: TextRunStyle) =>
  a.fontFamily === b.fontFamily &&
  a.fontSize === b.fontSize &&
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.strike === !!b.strike &&
  a.color === b.color &&
  a.highlight === b.highlight;

function paragraphFromNodes(nodes: Node[], el: HTMLElement, fallback: TextRunStyle): Paragraph {
  const runs: TextRun[] = [];
  const push = (text: string, style: TextRunStyle) => {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else runs.push({ text, ...style });
  };
  let emptyStyle: TextRunStyle | null = null;
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').replace(/​/g, '').replace(/\n/g, ' ');
      if (t) push(t, styleOfTextNode(n, el));
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    if (e.tagName === 'BR') {
      if (!emptyStyle) emptyStyle = styleOfTextNode(e, el);
      return;
    }
    e.childNodes.forEach(walk);
  };
  nodes.forEach(walk);

  const align = (el.style?.textAlign || getComputedStyle(el).textAlign) as string;
  const lh = parseFloat(el.style?.lineHeight ?? '');
  const p: Paragraph = {
    runs: runs.length ? runs : [{ text: '', ...(emptyStyle ?? styleOfTextNode(el, el) ?? fallback) }],
    align: (['left', 'center', 'right', 'justify'].includes(align) ? align : align === 'start' ? 'left' : align === 'end' ? 'right' : 'left') as HAlign,
    lineSpacing: Number.isFinite(lh) && lh > 0 ? round(lh / LINE_HEIGHT_FACTOR, 2) : 1,
    bullet: (el.dataset?.bullet as BulletType) ?? 'none',
    level: Number(el.dataset?.level ?? 0) || 0,
  };
  const mt = parseFloat(el.style?.marginTop ?? '');
  if (mt) p.spaceBefore = round(pxToPt(mt), 1);
  const mb = parseFloat(el.style?.marginBottom ?? '');
  if (mb) p.spaceAfter = round(pxToPt(mb), 1);
  return p;
}

/** contentEditable 루트에서 문단 목록 추출 */
export function htmlToParagraphs(root: HTMLElement, fallback: TextRunStyle = {}): Paragraph[] {
  const result: Paragraph[] = [];
  let inline: Node[] = [];
  const BLOCKS = ['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3'];
  const flushInline = () => {
    if (!inline.length) return;
    // 루트에 직접 들어간 텍스트(전체 삭제 후 입력 등): DOM을 변경하지 않고 하나의 문단으로 해석
    result.push(paragraphFromNodes(inline, root, fallback));
    inline = [];
  };
  Array.from(root.childNodes).forEach((n) => {
    const isBlock = n.nodeType === Node.ELEMENT_NODE && BLOCKS.includes((n as Element).tagName);
    if (isBlock) {
      flushInline();
      const el = n as HTMLElement;
      // 중첩 블록(붙여넣기 등)은 평탄화
      const nested = Array.from(el.children).filter((c) => BLOCKS.includes(c.tagName));
      if (nested.length && nested.length === el.children.length) {
        nested.forEach((c) => result.push(paragraphFromNodes(Array.from(c.childNodes), c as HTMLElement, fallback)));
      } else result.push(paragraphFromNodes(Array.from(el.childNodes), el, fallback));
    } else inline.push(n);
  });
  flushInline();
  if (!result.length) result.push({ runs: [{ text: '', ...fallback }], align: 'left', lineSpacing: 1, bullet: 'none', level: 0 });
  return result;
}

/** 편집 중 번호 매기기 갱신 */
export function renumberDom(root: HTMLElement) {
  const paras = Array.from(root.querySelectorAll<HTMLElement>(':scope > .sl-p, :scope > div'));
  const nums = computeNumbers(paras.map((d) => ({ bullet: (d.dataset.bullet as BulletType) ?? 'none', level: Number(d.dataset.level ?? 0) })));
  paras.forEach((d, i) => {
    if (nums[i]) d.dataset.num = nums[i]!;
    else delete d.dataset.num;
  });
}

export const cssObjectToReact = (css: Record<string, string>): React.CSSProperties => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(css)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out as React.CSSProperties;
};
