/** 오디오/비디오 삽입: 큰 바이너리는 IndexedDB(blobs)에 저장하고 문서에는 참조만 둔다 */
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import type { MediaObject } from '../../types/model';
import { newId } from '../../utils/id';
import { pickFiles } from '../../services/storage/files';
import { saveBlob } from '../../services/storage/db';
import { primeAssetUrl } from '../../hooks/useAssetUrl';

const MAX_MB = 200;

/** 동영상 크기와 표지 이미지(중간 프레임) */
function videoInfo(url: string): Promise<{ w: number; h: number; poster: string | null }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let settled = false;
    const done = (poster: string | null) => {
      if (settled) return;
      settled = true;
      resolve({ w: v.videoWidth || 640, h: v.videoHeight || 360, poster });
    };
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d')!.drawImage(v, 0, 0);
        done(c.toDataURL('image/jpeg', 0.8));
      } catch {
        done(null);
      }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

export async function insertMediaFile(file: File) {
  const s = useEditor.getState();
  const kind = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : null;
  if (!kind) return s.toast('오디오 또는 비디오 파일만 삽입할 수 있습니다.', 'warning');
  if (file.size > MAX_MB * 1024 * 1024) return s.toast(`${MAX_MB}MB 이하의 파일만 삽입할 수 있습니다.`, 'warning');
  const blobKey = newId();
  await saveBlob(blobKey, file);
  primeAssetUrl(blobKey, file);
  const assetId = newId();
  const { width: W, height: H } = s.doc.size;
  let w = 96, h = 96, posterId: string | undefined;
  const posterAsset: { id: string; mime: string; dataUrl: string }[] = [];
  if (kind === 'video') {
    const info = await videoInfo(URL.createObjectURL(file));
    const scale = Math.min((W * 0.6) / info.w, (H * 0.6) / info.h, 1.5);
    w = info.w * scale;
    h = info.h * scale;
    if (info.poster) {
      posterId = newId();
      posterAsset.push({ id: posterId, mime: 'image/jpeg', dataUrl: info.poster });
    }
  }
  const obj: MediaObject = {
    id: newId(),
    type: 'media',
    name: file.name.replace(/\.[^.]+$/, ''),
    kind,
    assetId,
    ...(posterId ? { posterId } : {}),
    x: (W - w) / 2,
    y: (H - h) / 2,
    width: w,
    height: h,
    rotation: 0,
  };
  s.commit(kind === 'video' ? '비디오 삽입' : '오디오 삽입', (d) => {
    d.assets[assetId] = { id: assetId, mime: file.type, dataUrl: '', blobKey, name: file.name, size: file.size };
    for (const p of posterAsset) d.assets[p.id] = p;
    C.addObjects(d, getActiveSlide().id, [obj]);
  });
  useEditor.getState().select([obj.id]);
}

export async function pickAndInsertMedia(kind: 'video' | 'audio') {
  const [f] = await pickFiles(kind === 'video' ? 'video/mp4,video/webm,video/ogg,.mp4,.webm,.m4v,.mov' : 'audio/*,.mp3,.m4a,.wav,.ogg');
  if (f) await insertMediaFile(f);
}
