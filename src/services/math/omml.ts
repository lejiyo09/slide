/**
 * 수식 변환
 *  - MathML(Temml이 LaTeX에서 만든 것) → OMML(Office Math, PPTX의 a14:m 안)
 *  - OMML → LaTeX (PPTX에서 가져온 수식을 편집할 수 있게)
 *  - MathML 정화 (문서에 저장된 MathML을 화면에 넣기 전에 MathML 요소·속성만 남김)
 * OMML 구조는 ECMA-376 Part 1 §22.1 (m:f, m:rad, m:nary, m:d, m:sSup …), PowerPoint는 이를 mc:AlternateContent의 a14:m 안에 둔다.
 */

export const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kids = (e: Element) => Array.from(e.children);

/* ───────────── MathML → OMML ───────────── */

export interface OmmlRunStyle {
  /** 글자 크기 (pt) */
  size?: number;
  /** 글자 색 (#RRGGBB) */
  color?: string;
}

const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰', '⋃', '⋂', '⋁', '⋀', '⨁', '⨂', '⨀']);
const ACCENTS: Record<string, string> = {
  '^': '̂', 'ˆ': '̂', '̂': '̂',
  '~': '̃', '˜': '̃', '̃': '̃',
  '¯': '̅', '‾': '̅', '̄': '̄', '̅': '̅',
  '˙': '̇', '̇': '̇',
  '¨': '̈', '̈': '̈',
  '→': '⃗', '⃗': '⃗',
  'ˇ': '̌', '̌': '̌',
  '´': '́', '́': '́',
  '`': '̀', '̀': '̀',
  '˘': '̆', '̆': '̆',
};

export function mathmlToOmml(mathml: string | Element, style: OmmlRunStyle = {}): string {
  const root = typeof mathml === 'string' ? parseXml(mathml) : mathml;
  // 글자 크기·색은 m:r 안이 아니라 문단(a:pPr/a:defRPr, a:endParaRPr)에 둔다: OMML 스키마의 m:r에는 a:rPr 자리가 없음
  void style;
  const run = (text: string, sty?: 'p' | 'b' | 'bi' | 'nor') => {
    if (!text) return '';
    const rPr = sty === 'nor' ? '<m:rPr><m:nor/></m:rPr>' : sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : '';
    return `<m:r>${rPr}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
  };
  const text = (e: Element) => (e.textContent ?? '').replace(/⁡|⁢|⁣/g, ''); // 보이지 않는 함수 적용/곱하기 기호 제거
  const isNaryBase = (e: Element | undefined): string | null => {
    if (!e) return null;
    if (e.localName === 'mo' && NARY.has(text(e).trim())) return text(e).trim();
    if (['msubsup', 'msub', 'msup', 'munderover', 'munder', 'mover'].includes(e.localName)) return isNaryBase(kids(e)[0]);
    return null;
  };

  const seq = (raw: Element[]): string => {
    // 표시 모드에서 Temml은 큰 연산자를 mrow 하나로 감쌈 → 풀어서 다음 형제를 피연산자로
    const list = raw.map((c) => (c.localName === 'mrow' && c.children.length === 1 && isNaryBase(c.children[0]) ? c.children[0] : c));
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      // 함수 이름 뒤 자동 간격(⁡ 다음 mspace)은 OMML이 알아서 넣으므로 버림
      const prev = list[i - 1];
      if (c.localName === 'mspace' && prev?.localName === 'mo' && text(prev) === '' && (prev.textContent ?? '').includes('\u2061')) continue;
      const op = isNaryBase(c);
      if (op) {
        const k = kids(c);
        const isScript = c.localName !== 'mo';
        const under = c.localName === 'munderover' || c.localName === 'munder';
        const sub = isScript && (c.localName === 'msubsup' || c.localName === 'msub' || under) ? k[1] : undefined;
        const sup = isScript && (c.localName === 'msubsup' || c.localName === 'munderover') ? k[2] : isScript && (c.localName === 'msup' || c.localName === 'mover') ? k[1] : undefined;
        const operand = list[i + 1];
        if (operand) i++;
        out +=
          `<m:nary><m:naryPr><m:chr m:val="${esc(op)}"/><m:limLoc m:val="${under || (!isScript && op !== '∫') ? 'undOvr' : 'subSup'}"/>` +
          `${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>` +
          `<m:sub>${sub ? conv(sub) : ''}</m:sub><m:sup>${sup ? conv(sup) : ''}</m:sup><m:e>${operand ? conv(operand) : ''}</m:e></m:nary>`;
        continue;
      }
      out += conv(c);
    }
    return out;
  };

  const rowWithFences = (e: Element): string => {
    const k = kids(e);
    const first = k[0], last = k[k.length - 1];
    const isFence = (x: Element | undefined, form: string) => !!x && x.localName === 'mo' && (x.getAttribute('fence') === 'true' || x.getAttribute('stretchy') === 'true') && (x.getAttribute('form') ?? form) === form;
    if (k.length >= 2 && isFence(first, 'prefix') && isFence(last, 'postfix')) {
      const beg = text(first), end = text(last);
      return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr><m:e>${seq(k.slice(1, -1))}</m:e></m:d>`;
    }
    return seq(k);
  };

  function conv(e: Element): string {
    const k = kids(e);
    switch (e.localName) {
      case 'math':
      case 'mrow':
      case 'mstyle':
      case 'mpadded':
      case 'merror':
      case 'none':
        return rowWithFences(e);
      case 'semantics':
        return k[0] ? conv(k[0]) : '';
      case 'annotation':
      case 'annotation-xml':
      case 'mprescripts':
        return '';
      case 'mphantom':
        return `<m:phant><m:e>${seq(k)}</m:e></m:phant>`;
      case 'mi': {
        const t = text(e);
        const v = e.getAttribute('mathvariant');
        if (v === 'bold') return run(t, 'b');
        if (v === 'bold-italic') return run(t, 'bi');
        return run(t, v === 'normal' || [...t].length > 1 ? 'p' : undefined);
      }
      case 'mn':
      case 'mo':
        return run(text(e), 'p');
      case 'mtext':
      case 'ms':
        return run(text(e), 'nor');
      case 'mspace': {
        const w = parseFloat(e.getAttribute('width') ?? '0');
        return w > 0 ? run(w >= 0.5 ? ' ' : ' ', 'p') : '';
      }
      case 'mfrac': {
        const noBar = e.getAttribute('linethickness') === '0' || e.getAttribute('linethickness') === '0px';
        return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${k[0] ? conv(k[0]) : ''}</m:num><m:den>${k[1] ? conv(k[1]) : ''}</m:den></m:f>`;
      }
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${seq(k)}</m:e></m:rad>`;
      case 'mroot':
        return `<m:rad><m:deg>${k[1] ? conv(k[1]) : ''}</m:deg><m:e>${k[0] ? conv(k[0]) : ''}</m:e></m:rad>`;
      case 'msup':
        return `<m:sSup><m:e>${conv(k[0])}</m:e><m:sup>${k[1] ? conv(k[1]) : ''}</m:sup></m:sSup>`;
      case 'msub':
        return `<m:sSub><m:e>${conv(k[0])}</m:e><m:sub>${k[1] ? conv(k[1]) : ''}</m:sub></m:sSub>`;
      case 'msubsup':
        return `<m:sSubSup><m:e>${conv(k[0])}</m:e><m:sub>${k[1] ? conv(k[1]) : ''}</m:sub><m:sup>${k[2] ? conv(k[2]) : ''}</m:sup></m:sSubSup>`;
      case 'mmultiscripts': {
        // 앞 첨자: base mprescripts sub sup
        const pre = k.findIndex((x) => x.localName === 'mprescripts');
        if (pre > 0) return `<m:sPre><m:sub>${k[pre + 1] ? conv(k[pre + 1]) : ''}</m:sub><m:sup>${k[pre + 2] ? conv(k[pre + 2]) : ''}</m:sup><m:e>${conv(k[0])}</m:e></m:sPre>`;
        return `<m:sSubSup><m:e>${conv(k[0])}</m:e><m:sub>${k[1] ? conv(k[1]) : ''}</m:sub><m:sup>${k[2] ? conv(k[2]) : ''}</m:sup></m:sSubSup>`;
      }
      case 'mover':
      case 'munder':
      case 'munderover': {
        const over = e.localName !== 'munder';
        const script = e.localName === 'munderover' ? k[2] : k[1];
        const st = script ? text(script).trim() : '';
        if (e.localName === 'mover' && script?.localName === 'mo' && ACCENTS[st] && (e.getAttribute('accent') === 'true' || script.getAttribute('stretchy') === 'false' || st.length === 1)) {
          if ((st === '‾' || st === '¯') && script.getAttribute('stretchy') !== 'false') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${conv(k[0])}</m:e></m:bar>`;
          return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[st]}"/></m:accPr><m:e>${conv(k[0])}</m:e></m:acc>`;
        }
        if (e.localName === 'munder' && script?.localName === 'mo' && (st === '_' || st === '̲' || st === '‾')) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${conv(k[0])}</m:e></m:bar>`;
        if (script?.localName === 'mo' && (st === '⏟' || st === '⏞')) return `<m:groupChr><m:groupChrPr><m:chr m:val="${st}"/><m:pos m:val="${st === '⏞' ? 'top' : 'bot'}"/></m:groupChrPr><m:e>${conv(k[0])}</m:e></m:groupChr>`;
        if (e.localName === 'munderover') return `<m:limUpp><m:e><m:limLow><m:e>${conv(k[0])}</m:e><m:lim>${conv(k[1])}</m:lim></m:limLow></m:e><m:lim>${k[2] ? conv(k[2]) : ''}</m:lim></m:limUpp>`;
        return over ? `<m:limUpp><m:e>${conv(k[0])}</m:e><m:lim>${script ? conv(script) : ''}</m:lim></m:limUpp>` : `<m:limLow><m:e>${conv(k[0])}</m:e><m:lim>${script ? conv(script) : ''}</m:lim></m:limLow>`;
      }
      case 'mtable':
        return `<m:m>${k.map((tr) => `<m:mr>${kids(tr).map((td) => `<m:e>${td.localName === 'mtd' ? seq(kids(td)) : conv(td)}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
      case 'menclose':
        return (e.getAttribute('notation') ?? '').includes('box') ? `<m:borderBox><m:e>${seq(k)}</m:e></m:borderBox>` : seq(k);
      case 'mfenced': {
        const open = e.getAttribute('open') ?? '(', close = e.getAttribute('close') ?? ')';
        return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr>${k.map((x) => `<m:e>${conv(x)}</m:e>`).join('')}</m:d>`;
      }
      default:
        return seq(k);
    }
  }
  const body = conv(root);
  return `<m:oMath xmlns:m="${M_NS}">${body}</m:oMath>`;
}

function parseXml(s: string): Element {
  const d = new DOMParser().parseFromString(s, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('수식(MathML)을 해석하지 못했습니다.');
  return d.documentElement;
}

/* ───────────── OMML → LaTeX ───────────── */

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ϵ: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ϑ: 'vartheta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ϖ: 'varpi', ρ: 'rho', ϱ: 'varrho', σ: 'sigma', ς: 'varsigma', τ: 'tau', υ: 'upsilon', φ: 'phi', ϕ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Υ: 'Upsilon', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
};
const SYMBOLS: Record<string, string> = {
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ', '∞': '\\infty ', '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '↔': '\\leftrightarrow ',
  '⋅': '\\cdot ', '·': '\\cdot ', '…': '\\ldots ', '⋯': '\\cdots ', '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∪': '\\cup ', '∩': '\\cap ', '∂': '\\partial ', '∇': '\\nabla ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ', '∀': '\\forall ', '∃': '\\exists ', '¬': '\\neg ', '∧': '\\wedge ', '∨': '\\vee ', '∅': '\\emptyset ', '°': '^\\circ ', '′': "'", '−': '-', '∗': '*', '∣': '\\mid ', '⁡': '', '⁢': '', '⁣': '',
  ' ': '\\,', ' ': '\\:', ' ': '\\quad ', ' ': '~',
};
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'gcd', 'deg', 'arg', 'ker', 'Pr']);
const NARY_TEX: Record<string, string> = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge', '⨁': '\\bigoplus', '⨂': '\\bigotimes', '⨀': '\\bigodot' };
const ACC_TEX: Record<string, string> = { '̂': '\\hat', '̃': '\\tilde', '̄': '\\bar', '̅': '\\bar', '̇': '\\dot', '̈': '\\ddot', '⃗': '\\vec', '⃑': '\\vec', '̌': '\\check', '́': '\\acute', '̀': '\\grave', '̆': '\\breve' };
const LIM_ACCENT: Record<string, string> = { '^': '\\hat', 'ˆ': '\\hat', '\u0302': '\\hat', '‾': '\\bar', '¯': '\\bar', '~': '\\tilde', '˜': '\\tilde', '˙': '\\dot', '¨': '\\ddot', '→': '\\vec', 'ˇ': '\\check', '´': '\\acute', '`': '\\grave', '˘': '\\breve' };
const DELIM: Record<string, string> = { '': '.', '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor' };

/** 수학용 영숫자(𝑎, 𝐀, 𝛼 …) → 보통 글자 */
export function plainMathChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x1d400 || cp > 0x1d7ff) return ch === 'ℎ' ? 'h' : ch;
  if (cp >= 0x1d7ce) return String.fromCharCode(48 + ((cp - 0x1d7ce) % 10)); // 숫자
  if (cp >= 0x1d6a8) {
    // 그리스 문자 (굵게/기울임 등 5벌 × 58)
    const off = (cp - 0x1d6a8) % 58;
    const greek = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ';
    return [...greek][off] ?? ch;
  }
  const off = (cp - 0x1d400) % 52;
  return String.fromCharCode(off < 26 ? 65 + off : 97 + off - 26);
}

const texEscape = (s: string) => s.replace(/[\\{}#%&$_^~]/g, (c) => (c === '\\' ? '\\backslash ' : c === '~' ? '\\sim ' : c === '^' ? '\\hat{}' : `\\${c}`));

function textToTex(raw: string, sty: string | null, nor: boolean): string {
  const s = [...raw].map(plainMathChar).join('');
  if (nor) return `\\text{${s.replace(/[\\{}]/g, (c) => `\\${c}`)}}`;
  if (FUNCS.has(s.trim())) return `\\${s.trim()} `;
  if (sty === 'p' && /^[A-Za-z]{2,}$/.test(s)) return `\\mathrm{${s}}`;
  let out = '';
  for (const ch of s) {
    if (GREEK[ch]) out += `\\${GREEK[ch]} `;
    else if (ch in SYMBOLS) out += SYMBOLS[ch];
    else if (NARY_TEX[ch]) out += `${NARY_TEX[ch]} `;
    else out += texEscape(ch);
  }
  if (sty === 'b') return `\\mathbf{${out}}`;
  if (sty === 'p' && /^[A-Za-z]$/.test(s)) return `\\mathrm{${out}}`;
  return out;
}

const mkid = (e: Element | null | undefined, name: string) => (e ? kids(e).find((c) => c.localName === name) : undefined);
const mval = (e: Element | undefined) => e?.getAttributeNS(M_NS, 'val') ?? e?.getAttribute('m:val') ?? null;

export function ommlToLatex(e: Element): string {
  const g = (x: Element | undefined) => (x ? `{${ommlToLatex(x)}}` : '{}');
  const all = () => kids(e).map(ommlToLatex).join('');
  switch (e.localName) {
    case 'oMathPara':
      return kids(e)
        .filter((c) => c.localName === 'oMath')
        .map(ommlToLatex)
        .join(' \\\\ ');
    case 'r': {
      const rPr = mkid(e, 'rPr');
      const sty = mval(mkid(rPr, 'sty'));
      const nor = !!mkid(rPr, 'nor');
      return kids(e)
        .filter((c) => c.localName === 't')
        .map((t) => textToTex(t.textContent ?? '', sty, nor))
        .join('');
    }
    case 'f': {
      const type = mval(mkid(mkid(e, 'fPr'), 'type'));
      const num = ommlToLatex(mkid(e, 'num')!), den = ommlToLatex(mkid(e, 'den')!);
      if (type === 'lin') return `${num}/${den}`;
      if (type === 'noBar') return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case 'sSup':
      return `${g(mkid(e, 'e'))}^${g(mkid(e, 'sup'))}`;
    case 'sSub':
      return `${g(mkid(e, 'e'))}_${g(mkid(e, 'sub'))}`;
    case 'sSubSup':
      return `${g(mkid(e, 'e'))}_${g(mkid(e, 'sub'))}^${g(mkid(e, 'sup'))}`;
    case 'sPre':
      return `{}_${g(mkid(e, 'sub'))}^${g(mkid(e, 'sup'))}${g(mkid(e, 'e'))}`;
    case 'rad': {
      const hide = mval(mkid(mkid(e, 'radPr'), 'degHide'));
      const deg = mkid(e, 'deg');
      const d = deg ? ommlToLatex(deg) : '';
      return hide === '1' || hide === 'on' || hide === 'true' || !d ? `\\sqrt{${ommlToLatex(mkid(e, 'e')!)}}` : `\\sqrt[${d}]{${ommlToLatex(mkid(e, 'e')!)}}`;
    }
    case 'nary': {
      const pr = mkid(e, 'naryPr');
      const chr = mval(mkid(pr, 'chr')) ?? '∫';
      const op = NARY_TEX[chr] ?? texEscape(chr);
      const loc = mval(mkid(pr, 'limLoc'));
      const isOn = (n: string) => ['1', 'on', 'true'].includes(mval(mkid(pr, n)) ?? '');
      const sub = isOn('subHide') ? '' : ommlToLatex(mkid(e, 'sub') ?? e.ownerDocument.createElement('x'));
      const sup = isOn('supHide') ? '' : ommlToLatex(mkid(e, 'sup') ?? e.ownerDocument.createElement('x'));
      const limits = loc === 'undOvr' && chr.match(/[∫∬∭∮]/) ? '\\limits' : loc === 'subSup' && !chr.match(/[∫∬∭∮]/) ? '\\nolimits' : '';
      return `${op}${limits}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}${g(mkid(e, 'e'))}`;
    }
    case 'd': {
      const pr = mkid(e, 'dPr');
      const beg = mval(mkid(pr, 'begChr')) ?? '(';
      const end = mval(mkid(pr, 'endChr')) ?? ')';
      const sep = mval(mkid(pr, 'sepChr')) ?? '|';
      const parts = kids(e).filter((c) => c.localName === 'e').map(ommlToLatex);
      return `\\left${DELIM[beg] ?? texEscape(beg)} ${parts.join(` ${DELIM[sep] === '|' ? '\\middle|' : texEscape(sep)} `)} \\right${DELIM[end] ?? texEscape(end)}`;
    }
    case 'acc': {
      const chr = mval(mkid(mkid(e, 'accPr'), 'chr')) ?? '̂';
      return `${ACC_TEX[chr] ?? '\\hat'}${g(mkid(e, 'e'))}`;
    }
    case 'bar': {
      const pos = mval(mkid(mkid(e, 'barPr'), 'pos')) ?? 'bot';
      return `${pos === 'top' ? '\\overline' : '\\underline'}${g(mkid(e, 'e'))}`;
    }
    case 'groupChr': {
      const pr = mkid(e, 'groupChrPr');
      const chr = mval(mkid(pr, 'chr')) ?? '⏟';
      const pos = mval(mkid(pr, 'pos')) ?? 'bot';
      if (chr === '⏞' || (pos === 'top' && chr === '⏟')) return `\\overbrace${g(mkid(e, 'e'))}`;
      if (chr === '⏟') return `\\underbrace${g(mkid(e, 'e'))}`;
      return pos === 'top' ? `\\overset{${texEscape(chr)}}${g(mkid(e, 'e'))}` : `\\underset{${texEscape(chr)}}${g(mkid(e, 'e'))}`;
    }
    case 'limLow': {
      const base = ommlToLatex(mkid(e, 'e')!);
      const lim = ommlToLatex(mkid(e, 'lim')!);
      return /^\\(lim|max|min|sup|inf) ?$/.test(base.trim()) ? `${base.trim()}_{${lim}}` : `\\underset{${lim}}{${base}}`;
    }
    case 'limUpp': {
      // LibreOffice는 악센트(^ ‾ ~ …)를 위첨자 한계(limUpp)로 씀 → \hat 등으로
      const limText = [...(mkid(e, 'lim')?.textContent ?? '')].map(plainMathChar).join('').trim();
      const acc = LIM_ACCENT[limText];
      if (acc) return `${acc}${g(mkid(e, 'e'))}`;
      return `\\overset{${ommlToLatex(mkid(e, 'lim')!)}}{${ommlToLatex(mkid(e, 'e')!)}}`;
    }
    case 'func':
      return `${ommlToLatex(mkid(e, 'fName')!)}${g(mkid(e, 'e'))}`;
    case 'm': {
      const rows = kids(e)
        .filter((c) => c.localName === 'mr')
        .map((mr) => kids(mr).filter((c) => c.localName === 'e').map(ommlToLatex).join(' & '));
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`;
    }
    case 'eqArr':
      return `\\begin{gathered}${kids(e)
        .filter((c) => c.localName === 'e')
        .map(ommlToLatex)
        .join(' \\\\ ')}\\end{gathered}`;
    case 'borderBox':
      return `\\boxed${g(mkid(e, 'e'))}`;
    case 'phant':
      return `\\phantom${g(mkid(e, 'e'))}`;
    case 'box':
      return ommlToLatex(mkid(e, 'e')!);
    default:
      // oMath, e, num, den, sub, sup, deg, lim, fName …: 자식만
      if (e.localName.endsWith('Pr') || e.localName === 'ctrlPr') return '';
      return all();
  }
}

/** 마지막 정리: 연속 공백 */
export const tidyLatex = (s: string) => s.replace(/\s+/g, ' ').replace(/ ([}^_)\]])/g, '$1').trim();

/* ───────────── MathML 정화 ───────────── */

const MATHML_ELEMENTS = new Set('math semantics annotation mrow mi mn mo ms mtext mspace mfrac msqrt mroot msup msub msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr mstyle mpadded mphantom menclose merror mfenced maction'.split(' '));
const MATHML_ATTRS = new Set('display mathvariant mathsize mathcolor mathbackground displaystyle scriptlevel fence form stretchy symmetric largeop movablelimits accent accentunder lspace rspace minsize maxsize linethickness width height depth columnalign rowalign columnspacing rowspacing columnlines rowlines frame notation encoding class style dir separator voffset'.split(' '));

/** 문서에 저장된 MathML 문자열을 화면에 넣어도 안전한 MathML로 (MathML 요소·속성만, style은 url()/expression 제외) */
export function sanitizeMathml(src: string): string {
  let d: Document;
  try {
    d = new DOMParser().parseFromString(src, 'application/xml');
  } catch {
    return '';
  }
  if (d.getElementsByTagName('parsererror').length) return '';
  const clean = (e: Element, out: Document): Element | null => {
    if (!MATHML_ELEMENTS.has(e.localName)) return null;
    const n = out.createElementNS(MATHML_NS, e.localName);
    for (const a of Array.from(e.attributes)) {
      const name = a.localName;
      if (!MATHML_ATTRS.has(name)) continue;
      if (name === 'style' && /url\(|expression|@import|javascript:/i.test(a.value)) continue;
      n.setAttribute(name, a.value);
    }
    for (const c of Array.from(e.childNodes)) {
      if (c.nodeType === 3) n.appendChild(out.createTextNode(c.textContent ?? ''));
      else if (c.nodeType === 1) {
        const k = clean(c as Element, out);
        if (k) n.appendChild(k);
      }
    }
    return n;
  };
  const out = document.implementation.createDocument(MATHML_NS, 'math', null);
  const root = clean(d.documentElement, out);
  if (!root || root.localName !== 'math') return '';
  return new XMLSerializer().serializeToString(root);
}
