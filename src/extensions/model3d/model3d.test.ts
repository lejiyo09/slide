import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import * as THREE from 'three';
import { DEFAULT_VIEW, parseModel, viewOf } from './scene';
import { createPresentation } from '../../core/document/factory';
import { exportPptxBytes } from '../../services/export/pptxExport';
import { importPptx } from '../../services/import/pptxImport';
import type { ExtensionObject } from '../../types/model';

const glb = readFileSync('src/extensions/model3d/__fixtures__/cube.glb');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** PowerPoint 3D 모델 구조(MS-ODRAWXML am3d, Open XML SDK 정의)를 따른 PPTX */
async function pptxWith3D(): Promise<Uint8Array> {
  const base = await exportPptxBytes(produce(createPresentation('3D'), (d) => void (d.slides[0].objects = [])));
  const zip = await JSZip.loadAsync(base.bytes);
  zip.file('ppt/media/model3d1.glb', glb);
  zip.file('ppt/media/poster1.png', Buffer.from(PNG, 'base64'));
  const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
  const rels = zip.file(relsPath) ? await zip.file(relsPath)!.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(
    relsPath,
    rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdM3d" Type="http://schemas.microsoft.com/office/2017/06/relationships/model3d" Target="../media/model3d1.glb"/><Relationship Id="rIdPoster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/poster1.png"/></Relationships>',
    ),
  );
  const alt =
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d" Requires="am3d">' +
    '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="3D 모델 6" descr="큐브"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1" noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="1905000" y="952500"/><a:ext cx="2857500" cy="2857500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2017/model3d">' +
    '<am3d:model3d r:embed="rIdM3d"><am3d:spPr><a:xfrm><a:off x="1905000" y="952500"/><a:ext cx="2857500" cy="2857500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></am3d:spPr>' +
    '<am3d:camera><am3d:pos x="0" y="0" z="60000000"/><am3d:up dx="0" dy="36000000" dz="0"/><am3d:lookAt x="0" y="0" z="0"/><am3d:perspective fov="2700000"/></am3d:camera>' +
    '<am3d:trans><am3d:meterPerModelUnit n="1" d="1"/><am3d:preTrans dx="0" dy="0" dz="0"/><am3d:scale><am3d:sx n="1" d="1"/><am3d:sy n="1" d="1"/><am3d:sz n="1" d="1"/></am3d:scale><am3d:rot ax="900000" ay="-1800000" az="0"/><am3d:postTrans dx="0" dy="0" dz="0"/></am3d:trans>' +
    '<am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="rIdPoster"/></am3d:raster><am3d:objViewport viewportSz="1000000"/><am3d:ambientLight><am3d:clr><a:scrgbClr r="50000" g="50000" b="50000"/></am3d:clr><am3d:illuminance n="500000" d="1000000"/></am3d:ambientLight></am3d:model3d>' +
    '</a:graphicData></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="7" name="3D 모델 6" descr="큐브"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rIdPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1905000" y="952500"/><a:ext cx="2857500" cy="2857500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback></mc:AlternateContent>';
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  zip.file('ppt/slides/slide1.xml', slide.replace('</p:spTree>', `${alt}</p:spTree>`));
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', ct.replace('<Default Extension="xml"', '<Default Extension="glb" ContentType="model/gltf-binary"/><Default Extension="xml"'));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('3D 모델', () => {
  it('GLB 해석: 가운데로 옮기고 크기 1로 맞춤', async () => {
    // 테스트 환경(jsdom)의 ArrayBuffer로 복사 (GLTFLoader가 instanceof ArrayBuffer로 판별)
    const ab = new ArrayBuffer(glb.length);
    new Uint8Array(ab).set(glb);
    const m = await parseModel(ab);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1, 5);
    expect(box.getCenter(new THREE.Vector3()).length()).toBeCloseTo(0, 5);
    await expect(parseModel(new TextEncoder().encode('not a model').buffer as ArrayBuffer)).rejects.toThrow();
  });

  it('보기 설정 기본값·범위', () => {
    expect(viewOf({})).toEqual(DEFAULT_VIEW);
    expect(viewOf({ rotX: 30, zoom: 99 })).toEqual({ ...DEFAULT_VIEW, rotX: 30, zoom: 10 });
  });

  it('PowerPoint 3D 모델 가져오기 → GLB·대체 그림, 그대로 저장하면 원본 XML·GLB 유지, 옮기면 위치만 반영', async () => {
    const src = await pptxWith3D();
    const r = await importPptx(src);
    const m = r.doc.slides[0].objects.find((o) => o.type === 'extension') as ExtensionObject;
    expect(m).toMatchObject({ kind: 'model3d', name: '3D 모델 6', x: 200, y: 100, width: 300, height: 300 });
    expect(m.data.usePoster).toBe(true);
    const asset = r.doc.assets[m.assetId!];
    expect(asset.blobKey && r.blobs.find((b) => b.key === asset.blobKey)!.data.length).toBe(glb.length);
    expect(r.doc.assets[m.posterId!].dataUrl.startsWith('data:image/png')).toBe(true);

    // 그대로 저장 (원본 패키지 있음)
    const moved = produce(r.doc, (d) => void ((d.slides[0].objects[0] as ExtensionObject).x = 300));
    const out = await JSZip.loadAsync((await exportPptxBytes(moved, { sourcePackage: src })).bytes);
    const sx = await out.file('ppt/slides/slide1.xml')!.async('string');
    expect(sx).toMatch(/<mc:AlternateContent[^>]*><mc:Choice[^>]*Requires="am3d"[^>]*><p:graphicFrame>[\s\S]*<am3d:model3d r:embed="(rIdSL\d+)"/);
    // 위치: Choice(p:xfrm, am3d:spPr는 원본 유지)와 Fallback 모두 x=300px=2857500 EMU
    expect((sx.match(/<a:off x="2857500" y="952500"\/>/g) ?? []).length).toBe(2);
    // 같은 ID
    expect([...sx.matchAll(/<p:cNvPr id="(\d+)" name="3D 모델 6"/g)].map((x) => x[1]).filter((v, i, a) => a.indexOf(v) === i)).toHaveLength(1);
    const rels = await out.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    const glbTarget = rels.match(/Type="http:\/\/schemas.microsoft.com\/office\/2017\/06\/relationships\/model3d" Target="\.\.\/media\/([^"]+)"/)![1];
    expect((await out.file(`ppt/media/${glbTarget}`)!.async('uint8array')).length).toBe(glb.length);
  });

  it('회전을 바꾼 3D 모델·새 3D 모델은 대체 그림으로 저장', async () => {
    const r = await importPptx(await pptxWith3D());
    const edited = produce(r.doc, (d) => {
      const m = d.slides[0].objects[0] as ExtensionObject;
      m.data = { ...m.data, rotY: 45, usePoster: false };
    });
    const { bytes, warnings } = await exportPptxBytes(edited, { sourcePackage: await pptxWith3D() });
    const sx = await (await JSZip.loadAsync(bytes)).file('ppt/slides/slide1.xml')!.async('string');
    expect(sx).not.toContain('am3d:model3d');
    expect(sx).toMatch(/<p:pic>[\s\S]*<a:blip r:embed=/);
    expect(warnings.join(' ')).toContain('그림으로 저장');
  });
});
