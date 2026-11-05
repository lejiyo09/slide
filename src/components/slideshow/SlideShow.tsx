import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { SlideView } from '../../engines/rendering/SlideView';
import { useAnimationPlayer } from '../../engines/animation/usePlayer';
import { buildTimeline, frameStates } from '../../engines/animation/timeline';
import { transitionFrame } from '../../engines/transition/transitions';

/**
 * 기본 슬라이드 쇼 (전체 화면, 키보드 조작, 검은/흰 화면).
 * 전환·애니메이션·발표자 보기는 10~11단계에서 이 컴포넌트에 연결된다.
 */
/** 쇼를 시작할 때마다 새로 마운트해 첫 프레임부터 시작 슬라이드를 표시 */
export function SlideShow() {
  const show = useEditor((s) => s.slideshow);
  if (!show) return null;
  return <SlideShowInner key={`${show.startIndex}-${showCounter(show)}`} />;
}

const seen = new WeakMap<object, number>();
let counter = 0;
const showCounter = (o: object) => {
  if (!seen.has(o)) seen.set(o, ++counter);
  return seen.get(o)!;
};

function SlideShowInner() {
  const show = useEditor((s) => s.slideshow);
  const doc = useEditor((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const slides = doc.slides.filter((s) => !s.hidden);
  const startSlide = show ? doc.slides[show.startIndex] : undefined;
  const startIdx = Math.max(0, startSlide ? slides.findIndex((s) => s.id === startSlide.id) : 0);
  const [index, setIndex] = useState(startIdx);
  const [cameBack, setCameBack] = useState(false);
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const [ended, setEnded] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cursorVisible, setCursorVisible] = useState(true);
  /** 진행 중 전환: 이전 슬라이드 인덱스와 시작 시각 */
  const [trans, setTrans] = useState<{ from: number; t0: number; p: number } | null>(null);
  const typed = useRef('');
  const slide = slides[index];
  const player = useAnimationPlayer(trans ? undefined : slide, doc.size.width, doc.size.height, { startAtEnd: cameBack });

  useEffect(() => {
    setIndex(startIdx);
    setEnded(false);
    setBlank(null);
    setCameBack(false);
    setTrans(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // 전환 애니메이션 루프
  useEffect(() => {
    if (!trans) return;
    const dur = slide?.transition?.duration ?? 0;
    let raf = 0;
    const tick = () => {
      const p = dur > 0 ? (performance.now() - trans.t0) / dur : 1;
      if (p >= 1) setTrans(null);
      else {
        setTrans((t) => (t ? { ...t, p } : t));
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trans?.t0]);

  const go = (i: number, forward: boolean) => {
    if (i < 0) return;
    if (i >= slides.length) return setEnded(true);
    const tr = slides[i].transition;
    if (forward && tr && tr.type !== 'none' && tr.duration > 0) setTrans({ from: index, t0: performance.now(), p: 0 });
    else setTrans(null);
    setCameBack(!forward);
    setIndex(i);
  };

  // 자동으로 넘기기 (화면 전환 시기: 다음 시간 후)
  useEffect(() => {
    const after = slide?.transition?.advanceAfter;
    if (!show || ended || trans || blank || !player.finished || after === undefined) return;
    const t = setTimeout(() => go(index + 1, true), Math.max(0, after));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ended, trans, blank, player.finished, index]);

  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    useEditor.getState().set({ slideshow: null });
  };

  useEffect(() => {
    if (!show) return;
    const el = ref.current;
    el?.focus();
    el?.requestFullscreen?.().catch(() => {
      /* 전체 화면 거부 시 창 안에서 발표 */
    });
    const onFs = () => {
      if (!document.fullscreenElement) useEditor.getState().set({ slideshow: null });
    };
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('resize', onResize);
    };
  }, [show]);

  useEffect(() => {
    if (!cursorVisible) return;
    const t = setTimeout(() => setCursorVisible(false), 2500);
    return () => clearTimeout(t);
  }, [cursorVisible]);

  if (!show) return null;

  const next = (byClick = false) => {
    if (blank) return setBlank(null);
    if (ended) return exit();
    if (trans) return setTrans(null); // 전환 중 클릭: 즉시 완료
    if (player.next()) return;
    // '마우스를 클릭할 때' 해제된 슬라이드는 클릭으로 넘기지 않음 (키보드는 허용)
    if (byClick && slide?.transition?.advanceOnClick === false) return;
    go(index + 1, true);
  };
  const prev = () => {
    if (blank) return setBlank(null);
    if (ended) return setEnded(false);
    if (trans) setTrans(null);
    if (player.prev()) return;
    go(index - 1, false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      typed.current += k;
      return;
    }
    if (k === 'Enter' && typed.current) {
      const n = parseInt(typed.current, 10);
      typed.current = '';
      if (n >= 1 && n <= slides.length) {
        go(n - 1, false);
        setCameBack(false);
        setEnded(false);
      }
      return;
    }
    typed.current = '';
    if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(k)) {
      e.preventDefault();
      next();
    } else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'p', 'P'].includes(k)) {
      e.preventDefault();
      prev();
    } else if (k === 'Home') {
      go(0, false);
      setCameBack(false);
      setEnded(false);
    } else if (k === 'End') {
      go(slides.length - 1, false);
      setEnded(false);
    } else if (k === 'b' || k === 'B' || k === '.') setBlank((b) => (b === 'black' ? null : 'black'));
    else if (k === 'w' || k === 'W' || k === ',') setBlank((b) => (b === 'white' ? null : 'white'));
    else if (k === 'Escape' || k === '-') exit();
  };

  const scale = Math.min(size.w / doc.size.width, size.h / doc.size.height);
  const layer = (sl: typeof slide, style: React.CSSProperties, frames?: ReturnType<typeof frameStates>) => (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: doc.size.width, height: doc.size.height, position: 'relative' }}>
        <SlideView slide={sl} doc={doc} mode="show" frames={frames} />
      </div>
    </div>
  );
  return (
    <div
      ref={ref}
      className={`slideshow ${cursorVisible ? '' : 'hide-cursor'}`}
      tabIndex={-1}
      onKeyDown={onKey}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        // 미디어 컨트롤 클릭은 슬라이드를 넘기지 않음
        if (t.closest('video, audio')) return;
        const link = t.closest('[data-link]')?.getAttribute('data-link');
        if (link) {
          window.open(link, '_blank', 'noopener');
          return;
        }
        // 트리거 개체 클릭
        const objId = (t.closest('[data-obj-id]') as HTMLElement | null)?.dataset.objId;
        if (objId && !trans && player.trigger(objId)) return;
        next(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        prev();
      }}
      onMouseMove={() => setCursorVisible(true)}
      role="presentation"
    >
      {slide && !ended && (
        <div className="show-stage" data-transition={trans ? 'running' : undefined} style={{ width: doc.size.width * scale, height: doc.size.height * scale }}>
          {trans && slides[trans.from] ? (
            (() => {
              const f = transitionFrame(slide.transition!, trans.p);
              const prevFrames = frameStates(slides[trans.from].objects, buildTimeline(slides[trans.from].animations), { done: Infinity, t: null }, doc.size.width, doc.size.height);
              const nextFrames = frameStates(slide.objects, buildTimeline(slide.animations), { done: 0, t: null }, doc.size.width, doc.size.height);
              const prevLayer = layer(slides[trans.from], f.prev, prevFrames);
              const nextLayer = layer(slide, f.next, nextFrames);
              return (
                <>
                  {f.prevOnTop ? nextLayer : prevLayer}
                  {f.prevOnTop ? prevLayer : nextLayer}
                  {f.black !== undefined && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: f.black }} />}
                </>
              );
            })()
          ) : (
            layer(slide, {}, player.frames)
          )}
        </div>
      )}
      {(ended || !slide) && <div className="show-end">슬라이드 쇼 끝. 클릭하여 나갑니다.</div>}
      {blank && <div className={`show-blank ${blank}`} />}
      <div className={`show-controls ${cursorVisible ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" title="이전 (←)" onClick={prev}>
          <ChevronLeft size={18} />
        </button>
        <span>
          {Math.min(index + 1, slides.length)} / {slides.length}
        </span>
        <button type="button" title="다음 (→)" onClick={() => next()}>
          <ChevronRight size={18} />
        </button>
        <button type="button" title="쇼 마침 (Esc)" onClick={exit}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
