/**
 * 슬라이드 쇼 (11단계: 발표 도구).
 * - 청중 화면: 전체 화면, 키보드/마우스 조작, 펜·형광펜·레이저, 확대, 모든 슬라이드 보기, 검은/흰 화면
 * - 발표자 보기(Alt+F5): 현재/다음 슬라이드, 노트, 타이머, 시계. 청중 화면은 별도 창(보조 모니터)에 표시
 * - 예행 연습 / 녹화: 슬라이드 시간과 내레이션 기록
 */
import { useCallback, useEffect, useRef } from 'react';
import { useEditor, type ShowRequest } from '../../core/store/editorStore';
import { useShowController, type ShowCtl } from './useShowController';
import { AudienceView, AudienceWindow, PresenterView } from './ShowViews';

/** 쇼를 시작할 때마다 새로 마운트해 첫 프레임부터 시작 슬라이드를 표시 */
export function SlideShow() {
  const show = useEditor((s) => s.slideshow);
  if (!show) return null;
  return <SlideShowRoot key={`${show.startIndex}-${showCounter(show)}`} req={show} />;
}

const seen = new WeakMap<object, number>();
let counter = 0;
const showCounter = (o: object) => {
  if (!seen.has(o)) seen.set(o, ++counter);
  return seen.get(o)!;
};

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

function SlideShowRoot({ req }: { req: ShowRequest }) {
  const ctl = useShowController(req);
  const ref = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<ShowCtl>(ctl);
  ctlRef.current = ctl;
  const browsed = ctl.settings.showType === 'browsed';

  // 전체 화면 + Esc 키 잠금(전체 화면에서도 Esc를 쇼가 직접 처리: 확대 해제·도구 해제·쇼 마침)
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    if (!browsed) {
      el?.requestFullscreen?.()
        .then(() => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.lock?.(['Escape']).catch(() => {}))
        .catch(() => {
          /* 전체 화면 거부 시 창 안에서 발표 */
        });
    }
    // 전체 화면 해제(청중 창을 열 때 브라우저가 자동으로 해제하는 경우 등)는 쇼를 끝내지 않음 — 쇼 마침은 Esc/메뉴로
    return () => {
      (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.unlock?.();
    };
  }, [browsed]);

  // 키보드: 포커스 위치(메뉴 클릭 후 등)와 관계없이 창 전체에서 받음
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => ctlRef.current.onKey(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 쇼가 끝나면 청중 창 닫기
  const win = ctl.audienceWin;
  useEffect(() => () => win?.close(), [win]);

  const openAudience = useCallback(async (secondScreen: boolean) => {
    const c = ctlRef.current;
    if (c.audienceWin && !c.audienceWin.closed && !secondScreen) {
      c.audienceWin.focus();
      return;
    }
    let features = 'popup=yes,width=960,height=540';
    if (secondScreen) {
      try {
        // Window Management API (Chromium): 다른 모니터 위치에 창 열기
        const sd = await (window as Window & { getScreenDetails?: () => Promise<{ screens: ScreenLike[]; currentScreen: ScreenLike }> }).getScreenDetails?.();
        const other = sd?.screens.find((s) => s !== sd.currentScreen);
        if (other) features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        else useEditor.getState().toast('다른 모니터를 찾지 못해 새 창으로 엽니다.', 'info');
      } catch {
        useEditor.getState().toast('화면 배치 권한이 없어 새 창으로 엽니다.', 'info');
      }
    }
    c.audienceWin?.close();
    const w = window.open('', 'slidelab-audience', features);
    if (!w) {
      useEditor.getState().toast('팝업이 차단되어 청중 화면 창을 열 수 없습니다. 브라우저에서 팝업을 허용하세요.', 'warning');
      return;
    }
    c.setAudienceWin(w);
  }, []);
  const onAudienceClosed = useCallback(() => ctlRef.current.setAudienceWin(null), []);

  return (
    <>
      <div ref={ref} className="show-root" tabIndex={-1}>
        {ctl.presenter ? <PresenterView ctl={ctl} onOpenAudience={(s) => void openAudience(s)} /> : <AudienceView ctl={ctl} muted={!!win} />}
      </div>
      {win && !win.closed && (
        <AudienceWindow win={win} onClosed={onAudienceClosed}>
          <AudienceView ctl={ctl} popup />
        </AudienceWindow>
      )}
    </>
  );
}

interface ScreenLike {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
