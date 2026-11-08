/** 3D 모델 보기 (편집 화면·슬라이드 쇼). 공유 렌더러의 결과를 이 개체의 캔버스에 그린다. */
import { useEffect, useRef, useState } from 'react';
import type { ExtensionViewProps } from '../registry';
import { loadAssetUrl } from '../../hooks/useAssetUrl';
import { loadModel, renderModel, viewOf, webglAvailable } from './scene';

export default function Model3DView({ obj, assets, fallback }: ExtensionViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const asset = obj.assetId ? assets[obj.assetId] : undefined;
  const view = viewOf(obj.data);
  useEffect(() => {
    let alive = true;
    if (!asset || !webglAvailable()) {
      setState('error');
      return;
    }
    void loadModel(asset.blobKey ?? asset.id, async () => {
      const url = await loadAssetUrl(asset);
      if (!url) throw new Error('3D 모델 파일을 찾을 수 없습니다.');
      return (await fetch(url)).arrayBuffer();
    })
      .then((model) => {
        if (!alive || !ref.current) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        renderModel(model, view, obj.width * dpr, obj.height * dpr, ref.current);
        setState('ready');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
    // 보기 설정·크기가 바뀌면 다시 그림
  }, [asset, view.rotX, view.rotY, view.rotZ, view.zoom, obj.width, obj.height]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sl-model3d" data-model3d={state}>
      {state !== 'ready' && fallback}
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: state === 'ready' ? 'block' : 'none' }} />
    </div>
  );
}
