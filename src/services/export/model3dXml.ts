/**
 * 3D 모델 → PowerPoint 3D 모델 XML (MS-ODRAWXML am3d, Office 2019+).
 * mc:AlternateContent
 *   Choice Requires="am3d": p:graphicFrame › a:graphicData(uri=model3d) › am3d:model3d r:embed(GLB 파트)
 *     spPr / camera / trans / raster(대체 그림) / objViewport / ambientLight / dirLight
 *   Fallback: 같은 자리의 그림 (3D를 모르는 프로그램)
 * 요소 순서·필수 속성은 Open XML SDK 스키마로 검증한다(src/test/schema.test.ts).
 * 값의 뜻(좌표 단위)은 PowerPoint 없이는 확인할 수 없어 다음처럼 정한다:
 *   모델 좌표(glTF 미터)를 preTrans로 중심에 옮기고 scale로 가장 긴 변 = viewportSz(EMU)가 되게 맞춘 뒤 rot로 SlideLab의 회전을 적용,
 *   카메라는 SlideLab 화면과 같은 시야각(30°)과 거리(경계 구가 상자에 들어가는 거리)로 원점을 봄.
 */
import type { ExtensionObject } from '../../types/model';

const EMU = 9525;
const M_TO_EMU = 36000000;
export const M3D_GLB_RID = '__SLIDELAB_M3D_GLB__';
export const M3D_POSTER_RID = '__SLIDELAB_M3D_POSTER__';
export const REL_MODEL3D = 'http://schemas.microsoft.com/office/2017/06/relationships/model3d';
export const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const int = (n: number) => String(Math.round(n));

export interface ModelBox {
  cx: number;
  cy: number;
  cz: number;
  size: number;
}

export function model3dXml(o: ExtensionObject, box: ModelBox): string {
  const d = o.data as Record<string, number>;
  const rotX = d.rotX ?? 15, rotY = d.rotY ?? -30, rotZ = d.rotZ ?? 0, zoom = Math.max(0.1, d.zoom ?? 1);
  const cx = Math.max(1, Math.round(o.width * EMU)), cy = Math.max(1, Math.round(o.height * EMU));
  const viewport = Math.max(cx, cy);
  const off = `<a:off x="${int(o.x * EMU)}" y="${int(o.y * EMU)}"/><a:ext cx="${cx}" cy="${cy}"/>`;
  const rot = o.rotation ? ` rot="${int(o.rotation * 60000)}"` : '';
  // 카메라 거리: SlideLab 화면(scene.renderModel)과 같은 식 — 크기 1 모델의 경계 구 반지름 √3/2, 세로 시야각 30°
  const fov = 30;
  const aspect = o.width / o.height;
  const vfov = (fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dist = ((Math.sqrt(3) / 2 / Math.sin(Math.min(vfov, hfov) / 2)) * 1.04 * viewport) / zoom;
  const size = box.size > 0 ? box.size : 1;
  const scaleN = viewport, scaleD = Math.max(1, Math.round(size * M_TO_EMU));
  const ratio = `<am3d:sx n="${scaleN}" d="${scaleD}"/><am3d:sy n="${scaleN}" d="${scaleD}"/><am3d:sz n="${scaleN}" d="${scaleD}"/>`;
  const nv = `<p:cNvPr id="0" name="${esc(o.name || '3D 모델')}" descr="${esc(o.name || '3D 모델')}"/>`;
  const choice =
    `<p:graphicFrame><p:nvGraphicFramePr>${nv}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1" noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm${rot}>${off}</p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2017/model3d">` +
    `<am3d:model3d r:embed="${M3D_GLB_RID}">` +
    `<am3d:spPr><a:xfrm>${off}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></am3d:spPr>` +
    `<am3d:camera><am3d:pos x="0" y="0" z="${int(dist)}"/><am3d:up dx="0" dy="${M_TO_EMU}" dz="0"/><am3d:lookAt x="0" y="0" z="0"/><am3d:perspective fov="${fov * 60000}"/></am3d:camera>` +
    `<am3d:trans><am3d:meterPerModelUnit n="1" d="1"/><am3d:preTrans dx="${int(-box.cx * M_TO_EMU)}" dy="${int(-box.cy * M_TO_EMU)}" dz="${int(-box.cz * M_TO_EMU)}"/>` +
    `<am3d:scale>${ratio}</am3d:scale><am3d:rot ax="${int(rotX * 60000)}" ay="${int(rotY * 60000)}" az="${int(rotZ * 60000)}"/><am3d:postTrans dx="0" dy="0" dz="0"/></am3d:trans>` +
    `<am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="${M3D_POSTER_RID}"/></am3d:raster>` +
    `<am3d:objViewport viewportSz="${viewport}"/>` +
    `<am3d:ambientLight><am3d:clr><a:scrgbClr r="50000" g="50000" b="50000"/></am3d:clr><am3d:illuminance n="500000" d="1000000"/></am3d:ambientLight>` +
    `<am3d:dirLight angularRad="0"><am3d:clr><a:scrgbClr r="100000" g="100000" b="100000"/></am3d:clr><am3d:illuminance n="1" d="1"/><am3d:pos x="${2 * M_TO_EMU}" y="${3 * M_TO_EMU}" z="${4 * M_TO_EMU}"/><am3d:lookAt x="0" y="0" z="0"/></am3d:dirLight>` +
    `</am3d:model3d></a:graphicData></a:graphic></p:graphicFrame>`;
  const fallback =
    `<p:pic><p:nvPicPr>${nv}<p:cNvPicPr><a:picLocks noGrp="1" noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${M3D_POSTER_RID}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm${rot}>${off}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  return (
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<mc:Choice xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d" Requires="am3d">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`
  );
}
