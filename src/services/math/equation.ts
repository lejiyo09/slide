/** LaTeX → MathML (Temml, MIT). 오류가 있으면 오류 위치를 붉게 표시한 MathML과 메시지 */
import temml from 'temml';
import { sanitizeMathml } from './omml';

export function latexToMathml(latex: string, display = true): { mathml: string; error: string | null } {
  try {
    const mathml = temml.renderToString(latex, { displayMode: display, throwOnError: true, trust: false, xml: true });
    return { mathml: sanitizeMathml(mathml), error: null };
  } catch (e) {
    // 오류: 원문을 붉은 글자(merror)로 표시
    const safe = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const mathml = `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}><merror><mtext>${safe}</mtext></merror></math>`;
    return { mathml: sanitizeMathml(mathml), error: (e as Error).message.replace(/^ParseError: /, '') };
  }
}

/** 수식 갤러리 (PowerPoint 삽입 › 수식의 기본 제공 수식과 같은 내용) */
export const EQUATION_GALLERY: { name: string; latex: string }[] = [
  { name: '원의 넓이', latex: 'A=\\pi r^{2}' },
  { name: '이항 정리', latex: '(x+a)^{n}=\\sum_{k=0}^{n}\\binom{n}{k}x^{k}a^{n-k}' },
  { name: '근의 공식', latex: 'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}' },
  { name: '피타고라스 정리', latex: 'a^{2}+b^{2}=c^{2}' },
  { name: '푸리에 급수', latex: 'f(x)=a_{0}+\\sum_{n=1}^{\\infty}\\left(a_{n}\\cos\\frac{n\\pi x}{L}+b_{n}\\sin\\frac{n\\pi x}{L}\\right)' },
  { name: '테일러 전개', latex: 'e^{x}=1+\\frac{x}{1!}+\\frac{x^{2}}{2!}+\\frac{x^{3}}{3!}+\\cdots,\\quad -\\infty<x<\\infty' },
  { name: '삼각 함수 항등식', latex: '\\sin\\alpha\\pm\\sin\\beta=2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)' },
  { name: '적분', latex: '\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}' },
  { name: '극한', latex: '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}=e' },
  { name: '행렬', latex: '\\left(\\begin{matrix}a & b\\\\ c & d\\end{matrix}\\right)' },
];

/** 수식 구조 삽입 단추 (PowerPoint 수식 탭의 구조 그룹) */
export const EQUATION_STRUCTURES: { group: string; items: { label: string; latex: string }[] }[] = [
  { group: '분수', items: [{ label: 'a/b', latex: '\\frac{a}{b}' }, { label: '작은 분수', latex: '\\tfrac{a}{b}' }] },
  { group: '첨자', items: [{ label: 'xⁿ', latex: 'x^{n}' }, { label: 'xₙ', latex: 'x_{n}' }, { label: 'xₙᵐ', latex: 'x_{n}^{m}' }] },
  { group: '근호', items: [{ label: '√x', latex: '\\sqrt{x}' }, { label: 'ⁿ√x', latex: '\\sqrt[n]{x}' }] },
  { group: '적분', items: [{ label: '∫', latex: '\\int_{a}^{b} f(x)\\,dx' }, { label: '∬', latex: '\\iint_{D} f\\,dA' }, { label: '∮', latex: '\\oint_{C} F\\cdot dr' }] },
  { group: '큰 연산자', items: [{ label: '∑', latex: '\\sum_{i=1}^{n} a_{i}' }, { label: '∏', latex: '\\prod_{i=1}^{n} a_{i}' }, { label: '⋃', latex: '\\bigcup_{i} A_{i}' }] },
  { group: '괄호', items: [{ label: '( )', latex: '\\left( x \\right)' }, { label: '[ ]', latex: '\\left[ x \\right]' }, { label: '{ }', latex: '\\left\\{ x \\right\\}' }, { label: '| |', latex: '\\left| x \\right|' }] },
  { group: '함수', items: [{ label: 'sin', latex: '\\sin\\theta' }, { label: 'log', latex: '\\log_{a} x' }, { label: 'lim', latex: '\\lim_{x\\to 0} f(x)' }] },
  { group: '악센트', items: [{ label: 'â', latex: '\\hat{a}' }, { label: 'ā', latex: '\\bar{a}' }, { label: 'a⃗', latex: '\\vec{a}' }, { label: 'ȧ', latex: '\\dot{a}' }] },
  { group: '행렬', items: [{ label: '2×2', latex: '\\begin{matrix}a & b\\\\ c & d\\end{matrix}' }, { label: '(2×2)', latex: '\\left(\\begin{matrix}a & b\\\\ c & d\\end{matrix}\\right)' }] },
];

export const EQUATION_SYMBOLS = ['±', '∞', '=', '≠', '~', '×', '÷', '!', '∝', '<', '≪', '>', '≫', '≤', '≥', '∓', '≅', '≈', '≡', '∀', '∁', '∂', '√', '∪', '∩', '∅', '%', '°', '∈', '∋', '¬', '∴', '∵', 'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', '→', '⇒', '↔', '⋅', '…'];
