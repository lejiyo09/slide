import { useEffect, useState } from 'react';
import type { Asset } from '../types/model';
import { getBlob } from '../services/storage/db';

/** blobKey 자산의 object URL 캐시 (같은 자산을 여러 곳에서 렌더링해도 한 번만 읽음) */
const cache = new Map<string, Promise<string | null>>();

export function loadAssetUrl(asset: Asset): Promise<string | null> {
  if (!asset.blobKey) return Promise.resolve(asset.dataUrl || null);
  let p = cache.get(asset.blobKey);
  if (!p) {
    p = getBlob(asset.blobKey)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    cache.set(asset.blobKey, p);
  }
  return p;
}

/** 새로 저장한 Blob을 캐시에 등록 (IndexedDB 왕복 없이 즉시 표시) */
export function primeAssetUrl(blobKey: string, blob: Blob) {
  cache.set(blobKey, Promise.resolve(URL.createObjectURL(blob)));
}

export function useAssetUrl(asset: Asset | undefined): string | null {
  const [url, setUrl] = useState<string | null>(asset && !asset.blobKey ? asset.dataUrl : null);
  useEffect(() => {
    let alive = true;
    if (!asset) return setUrl(null);
    void loadAssetUrl(asset).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [asset]);
  return url;
}
