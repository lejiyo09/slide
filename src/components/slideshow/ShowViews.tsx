/** 청중 화면, 발표자 보기, 예행 연습/녹화 도구 모음, 별도 청중 창 */
import { ensureMathFont } from '../../engines/rendering/mathFont';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Minus, Plus, MonitorUp, Mic, MicOff, Circle, Square, ArrowRight, X } from 'lucide-react';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { formatDuration } from '../../engines/show/showModel';
import { ShowStage } from './ShowStage';
import { ShowGrid, ShowHelp, ShowMenu, ShowPrompt, ShowToolbar, contextItems } from './ShowControls';
import type { ShowCtl } from './useShowController';

/** 요소 크기 (요소가 다른 창(청중 창)에 있어도 그 창의 ResizeObserver 사용) */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const win = (el.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new win.ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** 슬라이드 클릭: 링크 → 트리거 → 다음 */
function onShowClick(ctl: ShowCtl, e: React.MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('video, audio, .show-menu, .show-controls, .pv-tools, .rec-bar')) return;
  if (ctl.endPrompt) return;
  const link = t.closest('[data-link]')?.getAttribute('data-link');
  if (link) {
    window.open(link, '_blank', 'noopener');
    return;
  }
  const objId = (t.closest('[data-obj-id]') as HTMLElement | null)?.dataset.objId;
  if (objId && !ctl.trans && ctl.player.trigger(objId)) return;
  ctl.next(true);
}

/* ───────────── 청중 화면 ───────────── */

export function AudienceView({ ctl, popup, muted }: { ctl: ShowCtl; popup?: boolean; muted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(ref);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [fsHint, setFsHint] = useState(!!popup);
  const W = ctl.doc.size.width;
  const H = ctl.doc.size.height;
  const browsed = ctl.settings.showType === 'browsed' && !popup;
  const scale = w && h ? Math.min(w / W, h / H) : 0;
  // 발표자 보기를 쓰는 동안 청중 창은 슬라이드만 표시 (조작은 발표자 보기에서)
  const controls = !(popup && ctl.presenter);

  useEffect(() => {
    if (!cursorVisible || ctl.pointerMode !== 'auto') return;
    const t = setTimeout(() => setCursorVisible(false), 3000);
    return () => clearTimeout(t);
  }, [cursorVisible, ctl.pointerMode]);
  useEffect(() => {
    if (!popup) return;
    ref.current?.focus();
    // 청중 창의 키보드도 같은 컨트롤러로
    const win = ref.current?.ownerDocument.defaultView;
    const onKey = (e: KeyboardEvent) => ctlRef.current.onKey(e);
    win?.addEventListener('keydown', onKey);
    return () => win?.removeEventListener('keydown', onKey);
  }, [popup]);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  const hideCursor = ctl.tool === 'arrow' && (ctl.pointerMode === 'hidden' || (ctl.pointerMode === 'auto' && !cursorVisible));
  return (
    <div
      ref={ref}
      className={`slideshow ${hideCursor ? 'hide-cursor' : ''} ${browsed ? 'show-browsed' : ''}`}
      data-view={popup ? 'audience-window' : 'audience'}
      tabIndex={-1}
      onClick={(e) => {
        if (menu) return setMenu(null);
        if (!controls) return ctl.next(true);
        onShowClick(ctl, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!controls || ctl.kiosk) return;
        const r = ref.current!.getBoundingClientRect();
        setMenu({ x: Math.min(e.clientX - r.left, r.width - 260), y: Math.min(e.clientY - r.top, Math.max(0, r.height - 520)) });
      }}
      onMouseMove={() => setCursorVisible(true)}
      role="presentation"
    >
      {browsed && (
        <div className="show-browsed-title" onClick={(e) => e.stopPropagation()}>
          <span>{ctl.doc.title}</span>
          <button type="button" className="icon-btn" title="쇼 마침 (Esc)" onClick={ctl.requestExit}>
            <X size={16} />
          </button>
        </div>
      )}
      {scale > 0 && ctl.slide && !ctl.ended && <ShowStage ctl={ctl} scale={browsed ? Math.min(w / W, (h - 72) / H) : scale} muted={muted} interactive={controls} />}
      {(ctl.ended || !ctl.slide) && <div className="show-end">슬라이드 쇼 끝. 클릭하여 나갑니다.</div>}
      {ctl.blank && <div className={`show-blank ${ctl.blank}`} />}
      {ctl.autoPaused && controls && <div className="show-paused">자동 진행 중지됨 (S로 다시 시작)</div>}
      {controls && !ctl.kiosk && !browsed && <ShowToolbar ctl={ctl} visible={cursorVisible} onHelp={() => setHelp(true)} />}
      {browsed && (
        <div className="show-browsed-bar" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="이전" onClick={ctl.prev}>
            <ChevronLeft size={16} />
          </button>
          <span>
            슬라이드 {ctl.slide ? ctl.doc.slides.indexOf(ctl.slide) + 1 : 0} / {ctl.doc.slides.length}
          </span>
          <button type="button" title="다음" onClick={() => ctl.next()}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {controls && !ctl.presenter && ctl.mode && <RecordBar ctl={ctl} />}
      {controls && !ctl.presenter && ctl.grid && <ShowGrid ctl={ctl} />}
      {menu && <ShowMenu items={contextItems(ctl, () => setHelp(true))} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {help && <ShowHelp onClose={() => setHelp(false)} />}
      {controls && !ctl.presenter && <ShowPrompt ctl={ctl} />}
      {popup && fsHint && (
        <button
          type="button"
          className="show-fs-hint"
          onClick={(e) => {
            e.stopPropagation();
            setFsHint(false);
            void ref.current?.requestFullscreen?.().catch(() => {});
          }}
        >
          클릭하여 이 창을 전체 화면으로 표시
        </button>
      )}
    </div>
  );
}

/* ───────────── 예행 연습 / 녹화 도구 모음 ───────────── */

export function RecordBar({ ctl }: { ctl: ShowCtl }) {
  useTick(250);
  const rec = ctl.mode === 'record';
  return (
    <div className="rec-bar" role="toolbar" aria-label={rec ? '녹화' : '예행 연습'} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {rec ? (
        <>
          {ctl.recording === 'recording' ? (
            <button type="button" title="일시 중지" data-rec="pause" onClick={ctl.pauseRecording}>
              <Pause size={15} />
            </button>
          ) : (
            <button type="button" className="rec-dot" title={ctl.recording === 'paused' ? '녹화 계속' : '녹화 시작'} data-rec="start" onClick={() => void ctl.startRecording()}>
              <Circle size={15} fill="currentColor" />
            </button>
          )}
          <button type="button" title="녹화 중지 (쇼 마침)" data-rec="stop" onClick={ctl.requestExit}>
            <Square size={14} fill="currentColor" />
          </button>
          <button type="button" title={ctl.micOn ? '마이크 끄기' : '마이크 켜기'} data-rec="mic" aria-pressed={!ctl.micOn} onClick={ctl.toggleMic}>
            {ctl.micOn ? <Mic size={15} /> : <MicOff size={15} />}
          </button>
          <span className="rec-state">{ctl.recording === 'recording' ? '● 녹화 중' : ctl.recording === 'paused' ? '일시 중지됨' : '녹화 대기'}</span>
        </>
      ) : (
        <>
          <button type="button" title="다음" data-rec="next" onClick={() => ctl.next()}>
            <ArrowRight size={15} />
          </button>
          <button type="button" title={ctl.clockRunning ? '녹화 일시 중지' : '녹화 계속'} data-rec="pause" onClick={ctl.toggleClock}>
            {ctl.clockRunning ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </>
      )}
      <span className="rec-time" data-rec="slide-time" title="슬라이드 시간">
        {formatDuration(ctl.slideTime())}
      </span>
      {!rec && (
        <button type="button" title="반복 (이 슬라이드 시간 다시 기록)" data-rec="repeat" onClick={ctl.repeatSlide}>
          <RotateCcw size={14} />
        </button>
      )}
      <span className="rec-time rec-total" data-rec="total" title="총 시간">
        {formatDuration(ctl.totalTime())}
      </span>
    </div>
  );
}

/* ───────────── 발표자 보기 ───────────── */

const NOTES_KEY = 'slidelab.presenterNotesSize';
const loadNotesSize = () => {
  try {
    return Number(localStorage.getItem(NOTES_KEY)) || 20;
  } catch {
    return 20;
  }
};

export function PresenterView({ ctl, onOpenAudience }: { ctl: ShowCtl; onOpenAudience: (secondScreen: boolean) => void }) {
  useTick(500);
  const curRef = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(curRef);
  const nextRef = useRef<HTMLDivElement>(null);
  const nextW = Math.max(120, Math.min(useElementSize(nextRef).w || 360, 640));
  const [notesSize, setNotesSize] = useState(loadNotesSize);
  const [help, setHelp] = useState(false);
  const [dispMenu, setDispMenu] = useState(false);
  const W = ctl.doc.size.width;
  const H = ctl.doc.size.height;
  const scale = w && h ? Math.min(w / W, h / H) : 0;
  const ni = ctl.nextIndex();
  const nextSlide = ctl.ended ? undefined : ctl.seq[ni];
  const setNotes = (n: number) => {
    const v = Math.max(10, Math.min(48, n));
    setNotesSize(v);
    try {
      localStorage.setItem(NOTES_KEY, String(v));
    } catch {
      /* ignore */
    }
  };
  const docNo = ctl.slide ? ctl.doc.slides.indexOf(ctl.slide) + 1 : 0;
  const now = new Date();
  const remaining = ctl.player.finished ? null : '애니메이션이 남아 있습니다';
  return (
    <div className="presenter" data-view="presenter">
      <div className="pv-top" onClick={(e) => e.stopPropagation()}>
        <span className="show-tool-anchor">
          <button type="button" className="pv-top-btn" data-pv="display" onClick={() => setDispMenu((v) => !v)}>
            <MonitorUp size={15} /> 디스플레이 설정
          </button>
          {dispMenu && (
            <ShowMenu
              x={0}
              y={34}
              onClose={() => setDispMenu(false)}
              items={[
                { label: ctl.audienceWin ? '청중 화면 창 앞으로 가져오기' : '청중 화면 창 열기', onClick: () => onOpenAudience(false) },
                { label: '보조 모니터에 청중 화면 표시', disabled: !('getScreenDetails' in window), onClick: () => onOpenAudience(true) },
                { label: '청중 화면 창 닫기', disabled: !ctl.audienceWin, onClick: () => ctl.audienceWin?.close() },
                'sep',
                { label: '발표자 보기 숨기기 (이 창에 슬라이드 쇼 표시)', onClick: () => ctl.setPresenter(false) },
              ]}
            />
          )}
        </span>
        <span className="pv-audience-state">{ctl.audienceWin ? '청중 화면: 별도 창에 표시 중' : '청중 화면 창이 열려 있지 않습니다'}</span>
        <button type="button" className="pv-top-btn" data-pv="end" onClick={ctl.requestExit}>
          슬라이드 쇼 마침
        </button>
      </div>
      <div className="pv-body">
        <div className="pv-left">
          <div className="pv-timer">
            <button type="button" title={ctl.timer.running ? '타이머 일시 중지' : '타이머 계속'} data-pv="timer-toggle" onClick={ctl.toggleTimer}>
              {ctl.timer.running ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="pv-elapsed" data-pv="elapsed">
              {formatDuration(ctl.elapsed())}
            </span>
            <button type="button" title="타이머 다시 시작" data-pv="timer-reset" onClick={ctl.resetTimer}>
              <RotateCcw size={15} />
            </button>
            <span className="pv-clock">{now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <div
            className="pv-current"
            ref={curRef}
            onClick={(e) => onShowClick(ctl, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              ctl.prev();
            }}
          >
            {scale > 0 && ctl.slide && !ctl.ended && <ShowStage ctl={ctl} scale={scale} muted={!!ctl.audienceWin} />}
            {ctl.ended && <div className="show-end">슬라이드 쇼 끝</div>}
            {ctl.blank && <div className={`pv-blank-badge`}>{ctl.blank === 'black' ? '청중 화면: 검은 화면' : '청중 화면: 흰 화면'}</div>}
          </div>
          <ShowToolbar ctl={ctl} visible presenterStyle onHelp={() => setHelp(true)} />
          <div className="pv-nav" onClick={(e) => e.stopPropagation()}>
            <button type="button" title="이전 애니메이션 또는 슬라이드" data-pv="prev" onClick={ctl.prev}>
              <ChevronLeft size={22} />
            </button>
            <span data-pv="counter">
              슬라이드 {docNo} / {ctl.doc.slides.length}
            </span>
            <button type="button" title="다음 애니메이션 또는 슬라이드" data-pv="next" onClick={() => ctl.next()}>
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
        <div className="pv-right">
          <div className="pv-next" data-pv="next-preview" ref={nextRef}>
            <div className="pv-label">{remaining ? '다음: 애니메이션 (현재 슬라이드)' : '다음 슬라이드'}</div>
            {remaining && ctl.slide ? <ScaledSlide slide={ctl.slide} doc={ctl.doc} width={nextW} /> : nextSlide ? <ScaledSlide slide={nextSlide} doc={ctl.doc} width={nextW} /> : <div className="pv-next-empty">슬라이드 쇼 끝</div>}
          </div>
          <div className="pv-notes" data-pv="notes" style={{ fontSize: notesSize }}>
            {ctl.slide?.notes ? ctl.slide.notes : <span className="pv-notes-empty">슬라이드 노트 없음</span>}
          </div>
          <div className="pv-notes-tools">
            <button type="button" title="텍스트 확대" data-pv="notes-bigger" onClick={() => setNotes(notesSize + 2)}>
              <Plus size={14} /> A
            </button>
            <button type="button" title="텍스트 축소" data-pv="notes-smaller" onClick={() => setNotes(notesSize - 2)}>
              <Minus size={14} /> A
            </button>
          </div>
        </div>
      </div>
      {ctl.mode && <RecordBar ctl={ctl} />}
      {ctl.grid && <ShowGrid ctl={ctl} />}
      {help && <ShowHelp onClose={() => setHelp(false)} />}
      <ShowPrompt ctl={ctl} />
    </div>
  );
}

/* ───────────── 별도 청중 창 (React 포털) ───────────── */

export function AudienceWindow({ win, onClosed, children }: { win: Window; onClosed: () => void; children: ReactNode }) {
  const [container] = useState(() => {
    const d = win.document;
    d.title = '슬라이드 쇼 - SlideLab';
    if (!d.querySelector('base')) {
      const base = d.createElement('base');
      base.href = document.baseURI;
      d.head.appendChild(base);
    }
    // 편집기 스타일 복사 (개발: <style>, 빌드: <link rel=stylesheet>)
    d.head.querySelectorAll('[data-slidelab-style]').forEach((n) => n.remove());
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const c = n.cloneNode(true) as HTMLElement;
      c.setAttribute('data-slidelab-style', '');
      if (c instanceof HTMLLinkElement) c.href = (n as HTMLLinkElement).href;
      d.head.appendChild(c);
    });
    d.body.style.margin = '0';
    d.body.style.background = '#000';
    d.getElementById('slidelab-audience')?.remove();
    const el = d.createElement('div');
    el.id = 'slidelab-audience';
    d.body.appendChild(el);
    return el;
  });
  // 글꼴은 문서마다 따로 등록되므로 청중 창에도 내 글꼴을 등록 (웹 글꼴 스타일시트는 위에서 복사됨)
  useEffect(() => {
    void import('../../services/fonts/library').then((m) => m.registerFontsIn(win.document));
    ensureMathFont(win.document);
  }, [win]);
  useEffect(() => {
    const closed = () => onClosed();
    win.addEventListener('pagehide', closed);
    // 창을 닫은 것을 놓치지 않도록 확인
    const t = setInterval(() => win.closed && onClosed(), 500);
    return () => {
      win.removeEventListener('pagehide', closed);
      clearInterval(t);
    };
  }, [win, onClosed]);
  return createPortal(children, container);
}
