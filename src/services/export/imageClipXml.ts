/**
 * 도형 모양으로 자른 그림 → PPTX p:pic (a:custGeom). PowerPoint의 '그림과 도형 교차' 결과와 같은 구조:
 * blipFill(원본 그림 + srcRect 자르기) + spPr(xfrm + custGeom 경로). 경로는 그림 상자 기준 EMU.
 * PowerPoint는 뒤집기(flipH/V)를 모양에도 적용하므로, SlideLab(모양은 상자에 고정)과 같게 보이도록 미리 거꾸로 뒤집어 씀.
 */
import type { CustomGeometry, ImageObject } from '../../types/model';

const EMU = 9525;
export const CLIP_IMAGE_RID = '__SLIDELAB_CLIP_IMG__';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v));

export function custGeomXml(g: CustomGeometry, w: number, h: number, flipH = false, flipV = false): string {
  const W = Math.max(1, Math.round(w * EMU)), H = Math.max(1, Math.round(h * EMU));
  const X = (u: number) => n((flipH ? 1 - u : u) * W), Y = (v: number) => n((flipV ? 1 - v : v) * H);
  const paths = g.paths
    .filter((p) => p.fill)
    .map((p) => {
      const body = p.cmds
        .map((c) =>
          c.c === 'M'
            ? `<a:moveTo><a:pt x="${X(c.x)}" y="${Y(c.y)}"/></a:moveTo>`
            : c.c === 'L'
              ? `<a:lnTo><a:pt x="${X(c.x)}" y="${Y(c.y)}"/></a:lnTo>`
              : c.c === 'C'
                ? `<a:cubicBezTo><a:pt x="${X(c.x1)}" y="${Y(c.y1)}"/><a:pt x="${X(c.x2)}" y="${Y(c.y2)}"/><a:pt x="${X(c.x)}" y="${Y(c.y)}"/></a:cubicBezTo>`
                : '<a:close/>',
        )
        .join('');
      return `<a:path w="${W}" h="${H}">${body}</a:path>`;
    })
    .join('');
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`;
}

export function imageClipXml(o: ImageObject, opacity: number): string {
  const c = o.crop;
  const pct = (v: number) => n(v * 100000);
  const src = c.left || c.top || c.right || c.bottom ? `<a:srcRect l="${pct(c.left)}" t="${pct(c.top)}" r="${pct(c.right)}" b="${pct(c.bottom)}"/>` : '';
  const rot = o.rotation ? ` rot="${n(o.rotation * 60000)}"` : '';
  const flip = `${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}`;
  const alpha = opacity < 1 ? `<a:alphaModFix amt="${n(opacity * 100000)}"/>` : '';
  const ln = o.stroke ? `<a:ln w="${n(o.stroke.width * 12700)}"><a:solidFill><a:srgbClr val="${o.stroke.color.replace('#', '').toUpperCase()}"/></a:solidFill></a:ln>` : '';
  return (
    `<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:nvPicPr><p:cNvPr id="0" name="${esc(o.name || '그림')}" descr="${esc(o.name || '그림')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${CLIP_IMAGE_RID}">${alpha}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm${rot}${flip}><a:off x="${n(o.x * EMU)}" y="${n(o.y * EMU)}"/><a:ext cx="${n(Math.max(1, o.width * EMU))}" cy="${n(Math.max(1, o.height * EMU))}"/></a:xfrm>` +
    `${custGeomXml(o.clip!, o.width, o.height, !!o.flipH, !!o.flipV)}${ln}</p:spPr></p:pic>`
  );
}
