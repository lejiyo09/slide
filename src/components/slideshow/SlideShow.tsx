import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { SlideView } from '../../engines/rendering/SlideView';

/**
 * 기본 슬라이드 쇼 (전체 화면, 키보드 조작, 검은/흰 화면).
 * 전환·애니메이션·발표자 보기는 10~11단계에서 이 컴포넌트에 연결된다.
 */
export function SlideShow() {
  const show = useEditor((s) => s.slideshow);
  const doc = useEditor((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const slides = doc.slides.filter((s) => !s.hidden);
  const startSlide = show ? doc.slides[show.startIndex] : undefined;
  const startIdx = Math.max(0, startSlide ? slides.findIndex((s) => s.id === startSlide.id) : 0);
  const [index, setIndex] = useState(startIdx);
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const [ended, setEnded] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cursorVisible, setCursorVisible] = useState(true);
  const typed = useRef('');

  useEffect(() => {
    setIndex(startIdx);
    setEnded(false);
    setBlank(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

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

  const next = () => {
    if (blank) return setBlank(null);
    if (ended) return exit();
    if (index < slides.length - 1) setIndex(index + 1);
    else setEnded(true);
  };
  const prev = () => {
    if (blank) return setBlank(null);
    if (ended) return setEnded(false);
    setIndex(Math.max(0, index - 1));
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
        setIndex(n - 1);
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
      setIndex(0);
      setEnded(false);
    } else if (k === 'End') {
      setIndex(slides.length - 1);
      setEnded(false);
    } else if (k === 'b' || k === 'B' || k === '.') setBlank((b) => (b === 'black' ? null : 'black'));
    else if (k === 'w' || k === 'W' || k === ',') setBlank((b) => (b === 'white' ? null : 'white'));
    else if (k === 'Escape' || k === '-') exit();
  };

  const slide = slides[index];
  const scale = Math.min(size.w / doc.size.width, size.h / doc.size.height);
  return (
    <div
      ref={ref}
      className={`slideshow ${cursorVisible ? '' : 'hide-cursor'}`}
      tabIndex={-1}
      onKeyDown={onKey}
      onClick={next}
      onContextMenu={(e) => {
        e.preventDefault();
        prev();
      }}
      onMouseMove={() => setCursorVisible(true)}
      role="presentation"
    >
      {slide && !ended && (
        <div className="show-stage" style={{ width: doc.size.width * scale, height: doc.size.height * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: doc.size.width, height: doc.size.height, position: 'relative' }}>
            <SlideView slide={slide} doc={doc} />
          </div>
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
        <button type="button" title="다음 (→)" onClick={next}>
          <ChevronRight size={18} />
        </button>
        <button type="button" title="쇼 마침 (Esc)" onClick={exit}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
