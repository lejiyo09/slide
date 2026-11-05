/** 슬라이드 쇼 탭 / 녹화 탭 동작: 쇼 시작, 잉크·예행 연습·녹화 결과 반영, 쇼 설정, 재구성한 쇼 */
import { useEditor, type ShowRequest } from '../store/editorStore';
import * as C from './commands';
import type { CustomShow, MediaObject, ShowSettings } from '../../types/model';
import { strokeToShape, showSettingsOf, type InkStroke } from '../../engines/show/showModel';
import { newId } from '../../utils/id';
import { saveBlob } from '../../services/storage/db';
import { primeAssetUrl } from '../../hooks/useAssetUrl';

const currentIndex = () => {
  const s = useEditor.getState();
  return Math.max(0, s.doc.slides.findIndex((x) => x.id === s.activeSlideId));
};

export function startShow(opts: { fromCurrent?: boolean } & Omit<ShowRequest, 'startIndex'> = {}) {
  const s = useEditor.getState();
  const { fromCurrent, ...rest } = opts;
  // PowerPoint처럼: '발표자 보기 사용'이 켜져 있고 모니터가 여러 대면(Window Management API의 screen.isExtended) F5도 발표자 보기로 시작
  if (rest.presenter === undefined && !rest.mode) rest.presenter = showSettingsOf(s.doc).presenterView && !!(window.screen as Screen & { isExtended?: boolean }).isExtended;
  s.set({ slideshow: { startIndex: fromCurrent ? currentIndex() : 0, fromStart: !fromCurrent, ...rest } });
}

export const NARRATION_SIZE = 48;

/**
 * 쇼가 끝난 뒤 결과 반영 (실행 취소 한 번으로 되돌릴 수 있게 하나의 변경으로):
 * - 잉크 주석 유지 → 자유형 도형
 * - 예행 연습/녹화 시간 → 슬라이드의 '다음 시간 후' + 쇼 설정 '설정된 시간 사용'
 * - 녹화한 내레이션 → 슬라이드 오른쪽 아래 오디오 개체 (쇼 중 숨김, 자동 재생)
 */
export async function commitShowResults(r: { ink: Record<string, InkStroke[]>; timings: Record<string, number>; narration: Record<string, Blob>; recorded: boolean }) {
  const st = useEditor.getState();
  const inkSlides = Object.entries(r.ink).filter(([, a]) => a.length);
  const timed = Object.entries(r.timings).filter(([, t]) => t > 0);
  const clips = Object.entries(r.narration);
  if (!inkSlides.length && !timed.length && !clips.length) return;
  // 내레이션 파일은 IndexedDB blobs에 먼저 저장
  const saved: { slideId: string; assetId: string; blobKey: string; blob: Blob }[] = [];
  for (const [slideId, blob] of clips) {
    const blobKey = newId();
    await saveBlob(blobKey, blob);
    primeAssetUrl(blobKey, blob);
    saved.push({ slideId, assetId: newId(), blobKey, blob });
  }
  const { width: W, height: H } = st.doc.size;
  const label = r.recorded ? '슬라이드 쇼 녹화' : timed.length && !inkSlides.length ? '예행 연습 시간 저장' : '잉크 주석 유지';
  st.commit(label, (d) => {
    for (const [slideId, strokes] of inkSlides) C.addObjects(d, slideId, strokes.map(strokeToShape));
    for (const [slideId, t] of timed) C.setTransition(d, [slideId], { advanceAfter: Math.round(t) });
    if (timed.length) d.showSettings = { ...showSettingsOf(d), useTimings: true };
    for (const c of saved) {
      const slide = d.slides.find((s) => s.id === c.slideId);
      if (!slide) continue;
      // 다시 녹화하면 이전 내레이션을 바꿈
      C.deleteObjects(d, slide.id, slide.objects.filter((o) => o.type === 'media' && o.narration).map((o) => o.id));
      const ext = c.blob.type.includes('wav') ? 'wav' : c.blob.type.includes('ogg') ? 'ogg' : 'webm';
      d.assets[c.assetId] = { id: c.assetId, mime: c.blob.type || 'audio/wav', dataUrl: '', blobKey: c.blobKey, name: `narration.${ext}`, size: c.blob.size };
      const obj: MediaObject = {
        id: newId(),
        type: 'media',
        name: '내레이션',
        kind: 'audio',
        assetId: c.assetId,
        x: W - NARRATION_SIZE - 12,
        y: H - NARRATION_SIZE - 12,
        width: NARRATION_SIZE,
        height: NARRATION_SIZE,
        rotation: 0,
        autoPlay: true,
        hideInShow: true,
        narration: true,
      };
      C.addObjects(d, slide.id, [obj]);
    }
  });
  const parts = [inkSlides.length && '잉크 주석을 도형으로 추가했습니다', timed.length && `${timed.length}개 슬라이드의 시간을 저장했습니다`, saved.length && `${saved.length}개 슬라이드에 내레이션을 넣었습니다`].filter(Boolean);
  if (parts.length) useEditor.getState().toast(`${parts.join(', ')}.`, 'success');
}

/** 녹화 지우기: 현재 슬라이드 / 모든 슬라이드의 시간 또는 내레이션 */
export function clearRecording(scope: 'current' | 'all', what: 'timings' | 'narration') {
  const st = useEditor.getState();
  const ids = scope === 'all' ? st.doc.slides.map((s) => s.id) : [st.activeSlideId];
  const label = `${scope === 'all' ? '모든 슬라이드의' : '현재 슬라이드의'} ${what === 'timings' ? '시간' : '내레이션'} 지우기`;
  st.commit(label, (d) => {
    for (const s of d.slides) {
      if (!ids.includes(s.id)) continue;
      if (what === 'timings') {
        if (s.transition?.advanceAfter !== undefined) delete s.transition.advanceAfter;
      } else C.deleteObjects(d, s.id, s.objects.filter((o) => o.type === 'media' && o.narration).map((o) => o.id));
    }
  });
}

export function updateShowSettings(patch: Partial<ShowSettings>) {
  useEditor.getState().commit('슬라이드 쇼 설정', (d) => {
    d.showSettings = { ...showSettingsOf(d), ...patch };
  });
}

/* ── 재구성한 쇼 ── */

export function saveCustomShow(show: CustomShow) {
  useEditor.getState().commit('재구성한 쇼', (d) => {
    const list = (d.customShows ??= []);
    const i = list.findIndex((c) => c.id === show.id);
    if (i >= 0) list[i] = show;
    else list.push(show);
  });
}

export function deleteCustomShow(id: string) {
  useEditor.getState().commit('재구성한 쇼 삭제', (d) => {
    d.customShows = (d.customShows ?? []).filter((c) => c.id !== id);
    if (d.showSettings?.range.kind === 'custom' && d.showSettings.range.showId === id) d.showSettings.range = { kind: 'all' };
  });
}
