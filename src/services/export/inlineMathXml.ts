/**
 * 문단 안 수식 → PPTX (PowerPoint가 글자와 수식이 섞인 텍스트 상자를 쓰는 방식):
 * mc:AlternateContent
 *   Choice Requires="a14": 같은 p:sp, 수식 자리에 a14:m › m:oMath (문단 a:p 안, a:r 사이)
 *   Fallback: 같은 p:sp, 수식 자리에 LaTeX 글자 (수식을 모르는 프로그램용)
 * pptxgenjs가 만든 텍스트 상자에서 자리 표시 글자([[SLM:n]])를 찾아 바꾼다.
 */
import type { InlineMath } from '../../types/model';
import { M_NS, mathmlToOmml } from '../math/omml';

export const inlineMathToken = (n: number) => `[[SLM:${n}]]`;
const RUN_RE = /<a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t>\[\[SLM:(\d+)\]\]<\/a:t><\/a:r>/g;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 수식의 OMML (m:oMath, 가져온 원본을 바꾸지 않았으면 원본) */
export function inlineOmml(m: InlineMath): string {
  let xml = m.sourceOmml && m.sourceOmml.latex === m.latex ? m.sourceOmml.xml : mathmlToOmml(m.mathml);
  // 문단 안 수식은 m:oMath (m:oMathPara는 따로 선 수식)
  const para = xml.match(/^<m:oMathPara\b[^>]*>[\s\S]*?(<m:oMath\b[\s\S]*<\/m:oMath>)[\s\S]*<\/m:oMathPara>$/);
  if (para) xml = para[1];
  if (!/^<m:oMath\b[^>]*xmlns:m=/.test(xml)) xml = xml.replace(/^<m:oMath\b/, `<m:oMath xmlns:m="${M_NS}"`);
  return xml;
}

/** 슬라이드 XML의 자리 표시 글자를 문단 안 수식으로 (해당 p:sp를 mc:AlternateContent로 감쌈) */
export function applyInlineMath(slideXml: string, maths: InlineMath[]): string {
  if (!slideXml.includes('[[SLM:')) return slideXml;
  return slideXml.replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<\/p:sp>/g, (sp) => {
    if (!sp.includes('[[SLM:')) return sp;
    const choice = sp.replace(RUN_RE, (_r, n: string) => (maths[+n] ? `<a14:m>${inlineOmml(maths[+n])}</a14:m>` : ''));
    const fallback = sp.replace(RUN_RE, (r: string, n: string) => r.replace(/<a:t>\[\[SLM:\d+\]\]<\/a:t>/, `<a:t>${esc(maths[+n]?.latex ?? '')}</a:t>`));
    return (
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
      `<mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${choice}</mc:Choice>` +
      `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`
    );
  });
}
