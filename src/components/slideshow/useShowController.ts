/**
 * 슬라이드 쇼 상태와 동작을 한곳에서 관리한다.
 * 청중 화면(전체 화면/별도 창)과 발표자 보기가 같은 컨트롤러를 공유하므로 두 화면이 항상 같은 상태를 보여 준다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type ShowRequest } from '../../core/store/editorStore';
import { useAnimationPlayer, type PlayerApi } from '../../engines/animation/usePlayer';
import type { Slide } from '../../types/model';
import {
  appendPoint,
  clampZoom,
  eraseAt,
  HIGHLIGHTER_WIDTH,
  noZoom,
  PEN_WIDTH,
  showSequence,
  showSettingsOf,
  startIndexOf,
  stepIndex,
  zoomStep,
  type InkStroke,
  type ZoomState,
} from '../../engines/show/showModel';
import { newId } from '../../utils/id';
import { NarrationRecorder } from './narration';

export type ShowTool = 'arrow' | 'laser' | 'pen' | 'highlighter' | 'eraser';

export interface Transition {
  from: Slide;
  t0: number;
  p: number;
}

export type EndPrompt = { kind: 'ink'; then: EndPrompt | null } | { kind: 'timings'; total: number } | null;

export const PEN_COLORS = ['#FF0000', '#FFC000', '#FFFF00', '#00B050', '#00B0F0', '#0070C0', '#7030A0', '#000000', '#FFFFFF'];
export const HIGHLIGHTER_COLORS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#FF0000', '#0000FF'];

export function useShowController(req: ShowRequest) {
  const doc = useEditor((s) => s.doc);
  const settings = useMemo(() => showSettingsOf(doc), [doc]);
  const kiosk = settings.showType === 'kiosk';
  const mode = req.mode ?? null;
  const seq = useMemo(() => showSequence(doc, settings, req.customShowId), [doc, settings, req.customShowId]);
  const [index, setIndex] = useState(() => startIndexOf(seq, req.fromStart ? undefined : doc.slides[req.startIndex]?.id));
  const [cameBack, setCameBack] = useState(false);
  const [ended, setEnded] = useState(false);
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const [trans, setTrans] = useState<Transition | null>(null);
  const [grid, setGrid] = useState(false);
  const [presenter, setPresenter] = useState(() => !!req.presenter && !kiosk);
  const [audienceWin, setAudienceWin] = useState<Window | null>(null);
  // 도구
  const [tool, setToolState] = useState<ShowTool>('arrow');
  const [penColor, setPenColor] = useState(settings.penColor);
  const [hlColor, setHlColor] = useState('#FFFF00');
  const [ink, setInk] = useState<Record<string, InkStroke[]>>({});
  const [inkVisible, setInkVisible] = useState(true);
  const drawing = useRef<InkStroke | null>(null);
  const [, redrawInk] = useState(0);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [pointerMode, setPointerMode] = useState<'auto' | 'visible' | 'hidden'>('auto');
  const [zoom, setZoomState] = useState<ZoomState>(() => noZoom(doc.size.width, doc.size.height));
  const [zoomPick, setZoomPick] = useState(false);
  // 타이머 (발표 경과 시간)
  const [timer, setTimer] = useState({ start: performance.now(), acc: 0, running: true });
  // 자동 진행 일시 중지 (S)
  const [autoPaused, setAutoPaused] = useState(false);
  const [endPrompt, setEndPrompt] = useState<EndPrompt>(null);
  // 예행 연습 / 녹화: 슬라이드별 시간
  const timings = useRef<Record<string, number>>({});
  const slideClock = useRef({ start: performance.now(), acc: 0, running: mode === 'rehearse' });
  const [recording, setRecording] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [micOn, setMicOn] = useState(true);
  const recorder = useRef<NarrationRecorder | null>(null);

  const slide: Slide | undefined = seq[index];
  const playerSlide = useMemo(() => (slide && settings.noAnimation ? { ...slide, animations: [] } : slide), [slide, settings.noAnimation]);
  const player: PlayerApi = useAnimationPlayer(trans ? undefined : playerSlide, doc.size.width, doc.size.height, { startAtEnd: cameBack });

  /* ── 슬라이드별 시간 (예행 연습/녹화) ── */
  const clockMs = () => {
    const c = slideClock.current;
    return c.acc + (c.running ? performance.now() - c.start : 0);
  };
  const flushSlideTime = useCallback(() => {
    const id = seq[index]?.id;
    if (!id || !mode) return;
    const t = clockMs();
    if (t > 0) timings.current[id] = (timings.current[id] ?? 0) + t;
    slideClock.current = { start: performance.now(), acc: 0, running: slideClock.current.running };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, index, mode]);

  /* ── 이동 ── */
  const go = useCallback(
    (i: number, forward: boolean) => {
      if (i < 0) return;
      if (i >= seq.length) {
        if (settings.loop || kiosk) {
          const first = stepIndex(seq, -1, 1);
          if (first >= 0) return go(first, true);
        }
        flushSlideTime();
        recorder.current?.cut(seq[index]?.id);
        return setEnded(true);
      }
      if (i !== index) {
        flushSlideTime();
        recorder.current?.cut(seq[index]?.id);
      }
      const tr = seq[i].transition;
      if (forward && i !== index && slide && tr && tr.type !== 'none' && tr.duration > 0) setTrans({ from: slide, t0: performance.now(), p: 0 });
      else setTrans(null);
      setCameBack(!forward);
      setIndex(i);
      setEnded(false);
      setZoomState(noZoom(doc.size.width, doc.size.height));
      setZoomPick(false);
    },
    [seq, index, slide, settings.loop, kiosk, flushSlideTime, doc.size.width, doc.size.height],
  );

  // 전환 애니메이션 루프
  useEffect(() => {
    if (!trans) return;
    const dur = slide?.transition?.duration ?? 0;
    let raf = 0;
    // requestAnimationFrame의 시각(timestamp)으로 진행률: 화면 갱신 주기와 무관하게 재생 시간이 일정
    const tick = (ts: number) => {
      const p = dur > 0 ? Math.max(0, ts - trans.t0) / dur : 1;
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

  // 자동으로 넘기기: 쇼 설정의 '설정된 시간 사용' + 슬라이드의 '다음 시간 후' (예행 연습/녹화 중에는 사용 안 함)
  useEffect(() => {
    const after = slide?.transition?.advanceAfter;
    if (mode || !settings.useTimings || autoPaused || ended || trans || blank || grid || endPrompt || !player.finished || after === undefined) return;
    const t = setTimeout(() => go(stepIndex(seq, index, 1) === -1 ? seq.length : stepIndex(seq, index, 1), true), Math.max(0, after));
    return () => clearTimeout(t);
  }, [slide, mode, settings.useTimings, autoPaused, ended, trans, blank, grid, endPrompt, player.finished, index, seq, go]);

  const nextIndex = () => {
    const j = stepIndex(seq, index, 1);
    return j === -1 ? seq.length : j;
  };

  const next = (byClick = false) => {
    if (blank) return setBlank(null);
    if (ended) return requestExit();
    if (trans) return setTrans(null); // 전환 중 클릭: 즉시 완료
    if (player.next()) return;
    // 키오스크: 클릭으로 넘기지 않음 / '마우스를 클릭할 때' 해제된 슬라이드는 클릭으로 넘기지 않음
    if (byClick && (kiosk || slide?.transition?.advanceOnClick === false)) return;
    go(nextIndex(), true);
  };
  const prev = () => {
    if (blank) return setBlank(null);
    if (ended) {
      setEnded(false);
      return;
    }
    if (trans) setTrans(null);
    if (player.prev()) return;
    const j = stepIndex(seq, index, -1);
    if (j >= 0) go(j, false);
  };
  const goTo = (i: number) => {
    if (i < 0 || i >= seq.length) return;
    setBlank(null);
    setGrid(false);
    go(i, false);
    setCameBack(false);
  };
  /** H: 다음 슬라이드가 숨긴 슬라이드면 표시 */
  const nextHidden = () => {
    if (seq[index + 1]?.hidden) go(index + 1, true);
  };

  /* ── 도구 ── */
  const setTool = (t: ShowTool) => {
    setToolState((cur) => (cur === t && t !== 'arrow' ? 'arrow' : t));
    setZoomPick(false);
    if (t !== 'laser') setLaser(null);
  };
  const slideInk = slide ? (ink[slide.id] ?? []) : [];
  const inkCount = Object.values(ink).reduce((n, a) => n + a.length, 0);
  const beginStroke = (x: number, y: number) => {
    if (!slide) return;
    if (tool === 'eraser') return eraseStroke(x, y);
    if (tool !== 'pen' && tool !== 'highlighter') return;
    drawing.current = { id: newId(), tool, color: tool === 'pen' ? penColor : hlColor, width: tool === 'pen' ? PEN_WIDTH : HIGHLIGHTER_WIDTH, points: [x, y] };
    setInkVisible(true);
    redrawInk((n) => n + 1);
  };
  const extendStroke = (x: number, y: number) => {
    if (tool === 'eraser') return eraseStroke(x, y);
    const d = drawing.current;
    if (!d) return;
    const pts = appendPoint(d.points, x, y);
    if (pts !== d.points) {
      drawing.current = { ...d, points: pts };
      redrawInk((n) => n + 1);
    }
  };
  const endStroke = () => {
    const d = drawing.current;
    drawing.current = null;
    if (!d || !slide) return;
    const id = slide.id;
    setInk((m) => ({ ...m, [id]: [...(m[id] ?? []), d] }));
  };
  const eraseStroke = (x: number, y: number) => {
    if (!slide) return;
    const id = slide.id;
    setInk((m) => {
      const cur = m[id] ?? [];
      const out = eraseAt(cur, x, y, 8 / zoom.scale);
      return out === cur ? m : { ...m, [id]: out };
    });
  };
  /** E: 슬라이드의 모든 잉크 지우기 */
  const eraseAll = () => slide && setInk((m) => ({ ...m, [slide.id]: [] }));

  /* ── 확대 ── */
  const setZoom = (z: ZoomState) => setZoomState(clampZoom(z, doc.size.width, doc.size.height));
  const zoomBy = (dir: 1 | -1, at?: { x: number; y: number }) => {
    if (dir < 0 && zoom.scale <= 1) {
      // 확대하지 않은 상태에서 축소 → 모든 슬라이드 보기
      setGrid(true);
      return;
    }
    const scale = zoomStep(zoom.scale, dir);
    setZoom({ scale, cx: at?.x ?? zoom.cx, cy: at?.y ?? zoom.cy });
  };
  const zoomTo = (x: number, y: number) => {
    setZoom({ scale: 2, cx: x, cy: y });
    setZoomPick(false);
  };
  const resetZoom = () => setZoomState(noZoom(doc.size.width, doc.size.height));

  /* ── 타이머 ── */
  const elapsed = () => timer.acc + (timer.running ? performance.now() - timer.start : 0);
  const toggleTimer = () => setTimer((t) => (t.running ? { ...t, acc: t.acc + performance.now() - t.start, running: false } : { ...t, start: performance.now(), running: true }));
  const resetTimer = () => setTimer((t) => ({ start: performance.now(), acc: 0, running: t.running }));

  /* ── 예행 연습 / 녹화 ── */
  const slideTime = () => clockMs();
  const totalTime = () => Object.values(timings.current).reduce((a, b) => a + b, 0) + clockMs();
  const toggleClock = () => {
    const c = slideClock.current;
    slideClock.current = c.running ? { ...c, acc: c.acc + performance.now() - c.start, running: false } : { ...c, start: performance.now(), running: true };
    redrawInk((n) => n + 1);
  };
  /** 반복: 현재 슬라이드 시간을 처음부터 */
  const repeatSlide = () => {
    slideClock.current = { start: performance.now(), acc: 0, running: true };
    redrawInk((n) => n + 1);
  };
  const startRecording = async () => {
    if (recording === 'recording') return;
    if (recording === 'paused') {
      recorder.current?.resume();
      if (!slideClock.current.running) toggleClock();
      setRecording('recording');
      return;
    }
    const rec = new NarrationRecorder();
    recorder.current = rec;
    const ok = micOn ? await rec.start(slide?.id ?? '') : false;
    if (micOn && !ok) useEditor.getState().toast('마이크를 사용할 수 없어 슬라이드 시간만 기록합니다.', 'warning');
    // 녹화 시작 시점부터 시간 측정
    timings.current = {};
    slideClock.current = { start: performance.now(), acc: 0, running: true };
    setRecording('recording');
  };
  const pauseRecording = () => {
    if (recording !== 'recording') return;
    recorder.current?.pause();
    if (slideClock.current.running) toggleClock();
    setRecording('paused');
  };
  const toggleMic = () => {
    setMicOn((m) => !m);
    recorder.current?.setMuted(micOn);
  };
  // 녹화 중 슬라이드가 바뀌면 그 슬라이드부터 새 조각
  useEffect(() => {
    if (recording !== 'idle' && slide && !ended) recorder.current?.begin(slide.id);
  }, [slide, recording, ended]);

  /* ── 끝내기 ── */
  const finishing = useRef(false);
  const finish = async (keepInk: boolean, keepTimings: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const st = useEditor.getState();
    const rec = recorder.current;
    recorder.current = null;
    const narration = rec ? await rec.stop() : {};
    const strokes = keepInk ? ink : {};
    const { commitShowResults } = await import('../../core/commands/showActions');
    await commitShowResults({ ink: strokes, timings: keepTimings ? timings.current : {}, narration, recorded: mode === 'record' && recording !== 'idle' });
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    audienceWin?.close();
    st.set({ slideshow: null });
  };
  /** Esc / 마지막 슬라이드 뒤 클릭 / 쇼 마침: 잉크 유지 여부 → 예행 연습 시간 저장 여부를 차례로 묻는다 */
  const requestExit = () => {
    if (endPrompt || finishing.current) return;
    if (mode) {
      if (!ended) flushSlideTime();
      slideClock.current = { ...slideClock.current, running: false, acc: 0 };
    }
    const timingsPrompt: EndPrompt = mode === 'rehearse' && Object.keys(timings.current).length ? { kind: 'timings', total: Object.values(timings.current).reduce((a, b) => a + b, 0) } : null;
    if (inkCount > 0) return setEndPrompt({ kind: 'ink', then: timingsPrompt });
    if (timingsPrompt) return setEndPrompt(timingsPrompt);
    void finish(false, mode === 'record');
  };
  const answerPrompt = (yes: boolean) => {
    const p = endPrompt;
    if (!p) return;
    if (p.kind === 'ink') {
      keptInk.current = yes;
      if (p.then) return setEndPrompt(p.then);
      return void finish(yes, mode === 'record');
    }
    void finish(keptInk.current, yes);
  };
  const keptInk = useRef(false);

  /* ── 키보드 (PowerPoint 슬라이드 쇼 단축키) ── */
  const typed = useRef('');
  const onKey = (e: React.KeyboardEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (endPrompt) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (k === 'Escape') {
      e.preventDefault();
      if (grid) return setGrid(false);
      if (zoomPick) return setZoomPick(false);
      if (zoom.scale > 1) return resetZoom();
      if (tool !== 'arrow' && tool !== 'laser') return setTool('arrow');
      return requestExit();
    }
    if (kiosk) return; // 키오스크: Esc 외 키보드 탐색 없음
    if (mod) {
      const map: Record<string, () => void> = {
        p: () => setTool('pen'),
        i: () => setTool('highlighter'),
        e: () => setTool('eraser'),
        l: () => setTool('laser'),
        a: () => (setTool('arrow'), setPointerMode('visible')),
        h: () => setPointerMode('hidden'),
        u: () => setPointerMode('auto'),
        m: () => setInkVisible((v) => !v),
        s: () => setGrid(true),
      };
      const fn = map[k.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
      return;
    }
    if (grid) return;
    if (/^[0-9]$/.test(k)) {
      typed.current += k;
      return;
    }
    if (k === 'Enter' && typed.current) {
      const n = parseInt(typed.current, 10);
      typed.current = '';
      // 슬라이드 번호 = 문서의 슬라이드 번호
      const target = doc.slides[n - 1];
      const i = target ? seq.findIndex((s) => s.id === target.id) : -1;
      if (i >= 0) goTo(i);
      return;
    }
    typed.current = '';
    if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(k)) {
      e.preventDefault();
      next();
    } else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'p', 'P'].includes(k)) {
      e.preventDefault();
      prev();
    } else if (k === 'Home') goTo(stepIndex(seq, -1, 1));
    else if (k === 'End') goTo(stepIndex(seq, seq.length, -1));
    else if (k === 'b' || k === 'B' || k === '.') setBlank((b) => (b === 'black' ? null : 'black'));
    else if (k === 'w' || k === 'W' || k === ',') setBlank((b) => (b === 'white' ? null : 'white'));
    else if (k === 'e' || k === 'E') eraseAll();
    else if (k === 'h' || k === 'H') nextHidden();
    else if (k === 's' || k === 'S') setAutoPaused((p) => !p);
    else if (k === 'g' || k === 'G') setGrid(true);
    else if (k === 'a' || k === 'A' || k === '=') setPointerMode((m) => (m === 'visible' ? 'hidden' : 'visible'));
    else if (k === '+') zoomBy(1);
    else if (k === '-') zoomBy(-1);
  };

  return {
    req,
    doc,
    settings,
    kiosk,
    mode,
    seq,
    index,
    slide,
    ended,
    blank,
    setBlank,
    trans,
    player,
    grid,
    setGrid,
    presenter: presenter && !kiosk,
    setPresenter,
    audienceWin,
    setAudienceWin,
    tool,
    setTool,
    penColor,
    setPenColor,
    hlColor,
    setHlColor,
    ink,
    slideInk,
    inkCount,
    inkVisible,
    setInkVisible,
    drawing: drawing.current,
    beginStroke,
    extendStroke,
    endStroke,
    eraseAll,
    laser,
    setLaser,
    pointerMode,
    setPointerMode,
    zoom,
    setZoom,
    zoomBy,
    zoomTo,
    zoomPick,
    setZoomPick,
    resetZoom,
    timer,
    elapsed,
    toggleTimer,
    resetTimer,
    autoPaused,
    slideTime,
    totalTime,
    clockRunning: slideClock.current.running,
    toggleClock,
    repeatSlide,
    recording,
    startRecording,
    pauseRecording,
    micOn,
    toggleMic,
    next,
    prev,
    goTo,
    nextIndex,
    requestExit,
    endPrompt,
    answerPrompt,
    onKey,
  };
}

export type ShowCtl = ReturnType<typeof useShowController>;
