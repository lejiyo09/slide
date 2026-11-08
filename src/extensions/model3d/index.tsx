/**
 * 3D 모델 확장 (PowerPoint: 삽입 › 3D 모델). GLB / glTF(데이터 포함 한 파일)를 넣고 회전·확대를 조절한다.
 * 슬라이드 썸네일·인쇄·PDF·비디오·PPTX 대체 그림은 회전 설정으로 그린 대체 그림(PNG)을 쓴다.
 */
import { lazy, useState } from 'react';
import { Box } from 'lucide-react';
import { registerExtension, type ExtensionInsertResult } from '../registry';
import type { Asset, ExtensionObject, Presentation } from '../../types/model';
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import { newId } from '../../utils/id';
import { loadAssetUrl, primeAssetUrl } from '../../hooks/useAssetUrl';

const MAX_BYTES = 50 * 1024 * 1024;

async function sceneModule() {
  return import('./scene');
}

async function modelBytes(doc: Pick<Presentation, 'assets'>, o: ExtensionObject): Promise<ArrayBuffer> {
  const a = o.assetId ? doc.assets[o.assetId] : undefined;
  const url = a ? await loadAssetUrl(a) : null;
  if (!url) throw new Error('3D 모델 파일을 찾을 수 없습니다.');
  return (await fetch(url)).arrayBuffer();
}

/** 파일 → 3D 모델 개체 (GLB는 IndexedDB에, 대체 그림은 문서에) */
export async function createModelObject(file: File, slideSize: { width: number; height: number }): Promise<ExtensionInsertResult> {
  if (file.size > MAX_BYTES) throw new Error('50MB보다 큰 3D 모델은 넣을 수 없습니다.');
  const buf = await file.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
  if (head !== 'glTF' && !/\.gltf$/i.test(file.name)) throw new Error('GLB 또는 glTF 파일만 넣을 수 있습니다.');
  const S = await sceneModule();
  const model = await S.parseModel(buf); // 잘못된 파일이면 여기서 오류
  const blobKey = newId();
  const { saveBlob } = await import('../../services/storage/db');
  const blob = new Blob([buf], { type: head === 'glTF' ? 'model/gltf-binary' : 'model/gltf+json' });
  await saveBlob(blobKey, blob);
  primeAssetUrl(blobKey, blob);
  const w = Math.round(slideSize.width * 0.4), h = Math.round(slideSize.width * 0.4);
  const view = S.DEFAULT_VIEW;
  const modelAsset: Asset = { id: newId(), mime: blob.type, dataUrl: '', blobKey, name: file.name, size: file.size };
  const poster: Asset = { id: newId(), mime: 'image/png', dataUrl: S.webglAvailable() ? S.posterOf(model, view, w, h) : '', name: `${file.name}.png` };
  const obj: ExtensionObject = {
    id: newId(),
    type: 'extension',
    kind: 'model3d',
    name: file.name.replace(/\.(glb|gltf)$/i, '') || '3D 모델',
    x: (slideSize.width - w) / 2,
    y: (slideSize.height - h) / 2,
    width: w,
    height: h,
    rotation: 0,
    data: { ...view },
    assetId: modelAsset.id,
    posterId: poster.id,
  };
  return { obj, assets: [modelAsset, poster] };
}

async function refreshPoster(o: ExtensionObject, doc: Pick<Presentation, 'assets'>): Promise<string | null> {
  const S = await sceneModule();
  if (!S.webglAvailable() || !o.assetId) return null;
  const a = doc.assets[o.assetId];
  const model = await S.loadModel(a?.blobKey ?? o.assetId, () => modelBytes(doc, o));
  return S.posterOf(model, S.viewOf(o.data), o.width, o.height);
}

/** 서식 창: 회전 X/Y/Z, 확대, 보기 다시 설정 */
function Model3DProperties({ obj }: { obj: ExtensionObject }) {
  const [busy, setBusy] = useState(false);
  const data = obj.data as Record<string, number>;
  const st = () => useEditor.getState();
  const update = (patch: Record<string, number>) => {
    const s = st();
    if (!s.gestureBase) s.beginGesture('3D 회전');
    s.updateGesture((d) => C.updateObjects(d, getActiveSlide().id, [obj.id], (o) => o.type === 'extension' && void (o.data = { ...o.data, ...patch, usePoster: false })));
  };
  /** 끝: 대체 그림을 새로 그려 같은 실행 취소 단계에 넣음 */
  const finish = async () => {
    const s = st();
    if (!s.gestureBase) return;
    setBusy(true);
    try {
      const cur = getActiveSlide().objects.find((o) => o.id === obj.id);
      const png = cur?.type === 'extension' ? await refreshPoster(cur, s.doc) : null;
      if (png && cur?.type === 'extension' && cur.posterId) {
        const pid = cur.posterId;
        st().updateGesture((d) => void (d.assets[pid] = { ...d.assets[pid], dataUrl: png }));
      }
    } finally {
      st().endGesture();
      setBusy(false);
    }
  };
  const slider = (key: string, label: string, min: number, max: number, step = 1) => (
    <label className="m3d-row" key={key}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={data[key] ?? 0} onChange={(e) => update({ [key]: Number(e.target.value) })} onPointerUp={() => void finish()} onKeyUp={() => void finish()} aria-label={label} data-m3d={key} />
      <output>{key === 'zoom' ? `${Math.round((data[key] ?? 1) * 100)}%` : `${Math.round(data[key] ?? 0)}°`}</output>
    </label>
  );
  return (
    <div className="m3d-props" data-m3d-props="">
      {slider('rotX', 'X 회전', -180, 180)}
      {slider('rotY', 'Y 회전', -180, 180)}
      {slider('rotZ', 'Z 회전', -180, 180)}
      {slider('zoom', '확대', 0.3, 3, 0.05)}
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          const { DEFAULT_VIEW } = await sceneModule();
          update({ ...DEFAULT_VIEW });
          await finish();
        }}
        data-m3d-reset=""
      >
        3D 모델 보기 다시 설정
      </button>
      <p className="pp-hint">슬라이드 축소판·인쇄·PDF·비디오와 PowerPoint 파일에는 이 각도로 그린 그림이 들어갑니다.</p>
    </div>
  );
}

registerExtension({
  kind: 'model3d',
  name: '3D 모델',
  View: lazy(() => import('./Model3DView')),
  Properties: Model3DProperties,
  refreshPoster,
  describe: (o) => `3D 모델 ${o.name}`,
  ribbon: { label: '3D 모델', title: '3D 모델 삽입 (GLB, glTF)', icon: Box },
  insert: async (doc) => {
    const { pickFiles } = await import('../../services/storage/files');
    const [file] = await pickFiles('.glb,.gltf,model/gltf-binary,model/gltf+json', false);
    if (!file) return null;
    return createModelObject(file, doc.size);
  },
});

