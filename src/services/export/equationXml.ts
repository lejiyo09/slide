/**
 * 수식 → PPTX 도형 XML (PowerPoint 2010+와 LibreOffice가 쓰는 형식):
 * mc:AlternateContent
 *   mc:Choice Requires="a14" → p:sp(텍스트 상자) 안 a:p 안 a14:m 안 m:oMathPara / m:oMath
 *   mc:Fallback → 같은 자리의 그림(수식 그림으로 채운 사각형) — 수식을 모르는 프로그램용
 */
import type { EquationObject } from '../../types/model';
import { M_NS, mathmlToOmml } from '../math/omml';

const EMU = 9525;
export const EQ_IMAGE_RID = '__SLIDELAB_EQ_IMG__';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** 수식의 OMML (가져온 원본을 바꾸지 않았으면 원본) */
export function equationOmml(o: EquationObject): string {
  if (o.sourceOmml && o.sourceOmml.latex === o.latex) return o.sourceOmml.xml;
  const omath = mathmlToOmml(o.mathml, { size: o.fontSize, color: o.color });
  const jc = o.align === 'left' ? 'left' : o.align === 'right' ? 'right' : 'centerGroup';
  return `<m:oMathPara xmlns:m="${M_NS}"><m:oMathParaPr><m:jc m:val="${jc}"/></m:oMathParaPr>${omath}</m:oMathPara>`;
}

export function equationShapeXml(o: EquationObject, opts: { id: number; withImage: boolean }): string {
  const rot = o.rotation ? ` rot="${Math.round(o.rotation * 60000)}"` : '';
  const xfrm = `<a:xfrm${rot}><a:off x="${Math.round(o.x * EMU)}" y="${Math.round(o.y * EMU)}"/><a:ext cx="${Math.max(1, Math.round(o.width * EMU))}" cy="${Math.max(1, Math.round(o.height * EMU))}"/></a:xfrm>`;
  const nv = `<p:nvSpPr><p:cNvPr id="${opts.id}" name="${esc(o.name || '수식')}" descr="${esc(o.latex)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`;
  const algn = o.align === 'left' ? 'l' : o.align === 'right' ? 'r' : 'ctr';
  const fill = `<a:solidFill><a:srgbClr val="${o.color.replace('#', '').toUpperCase()}"/></a:solidFill>`;
  const end = `<a:endParaRPr lang="en-US" sz="${Math.round(o.fontSize * 100)}" dirty="0">${fill}<a:latin typeface="Cambria Math"/></a:endParaRPr>`;
  // 수식 글자의 크기·색: 문단 기본 글자 서식(a:defRPr)
  const ppr = `<a:pPr algn="__ALGN__"><a:defRPr sz="${Math.round(o.fontSize * 100)}">${fill}<a:latin typeface="Cambria Math"/></a:defRPr></a:pPr>`;
  const choice =
    `<p:sp>${nv}<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p>${ppr.replace('__ALGN__', algn)}<a14:m>${equationOmml(o)}</a14:m>${end}</a:p></p:txBody></p:sp>`;
  const fallbackFill = opts.withImage ? `<a:blipFill><a:blip r:embed="${EQ_IMAGE_RID}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>` : '<a:noFill/>';
  // 그림이 없을 때(그림을 만들 수 없는 환경)는 LaTeX 글자로 대체
  const fallbackText = opts.withImage
    ? `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:noFill/></a:rPr><a:t> </a:t></a:r></a:p></p:txBody>`
    : `<p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="${algn}"/><a:r><a:rPr lang="en-US" sz="${Math.round(o.fontSize * 100)}"/><a:t>${esc(o.latex)}</a:t></a:r></a:p></p:txBody>`;
  const fallback = `<p:sp>${nv}<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fallbackFill}</p:spPr>${fallbackText}</p:sp>`;
  return (
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${choice}</mc:Choice>` +
    `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`
  );
}
