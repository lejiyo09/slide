/**
 * 슬라이드 쇼 무대: 전환·애니메이션 프레임 + 잉크 + 레이저 포인터 + 화면 확대.
 * 청중 화면과 발표자 보기의 현재 슬라이드가 같은 컴포넌트를 쓴다.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { SlideView } from '../../engines/rendering/SlideView';
import { ShowMediaContext } from '../../engines/rendering/ObjectView';
import { buildTimeline, frameStates } from '../../engines/animation/timeline';
import { transitionFrame } from '../../engines/transition/transitions';
import { MorphTransitionView } from '../../engines/transition/MorphView';
import { HIGHLIGHTER_OPACITY, inkPathD, viewToSlide, zoomTransform, type InkStroke } from '../../engines/show/showModel';
import type { Slide } from '../../types/model';
import type { ShowCtl } from './useShowController';

/** '내레이션 없이 쇼 진행'이면 내레이션 개체 제외 */
const withoutNarration = (s: Slide): Slide => ({ ...s, objects: s.objects.filter((o) => !(o.type === 'media' && o.narration)) });

export function ShowStage({ ctl, scale, muted, interactive = true }: { ctl: ShowCtl; scale: number; muted?: boolean; interactive?: boolean }) {
  const { doc, slide, trans, zoom } = ctl;
  const W = doc.size.width;
  const H = doc.size.height;
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  if (!slide) return null;
  const fix = (s: Slide) => (ctl.settings.noNarration ? withoutNarration(s) : s);

  /** 화면 좌표 → (확대 전) 무대 좌표, 슬라이드 좌표 */
  const coords = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const vy = ((e.clientY - r.top) / r.height) * H;
    return { vx, vy, ...viewToSlide(zoom, W, H, vx, vy) };
  };
  const drawingTool = ctl.tool === 'pen' || ctl.tool === 'highlighter' || ctl.tool === 'eraser';

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0 || ctl.ended) return;
    const c = coords(e);
    suppressClick.current = false;
    if (drawingTool) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      ctl.beginStroke(c.x, c.y);
      return;
    }
    if (zoom.scale > 1 && !ctl.zoomPick) pan.current = { x: e.clientX, y: e.clientY, cx: zoom.cx, cy: zoom.cy, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    const c = coords(e);
    if (ctl.zoomPick) setLens({ x: c.vx, y: c.vy });
    if (ctl.tool === 'laser') ctl.setLaser({ x: c.x, y: c.y });
    if (drawingTool && e.buttons & 1) return ctl.extendStroke(c.x, c.y);
    const p = pan.current;
    if (p && e.buttons & 1) {
      const r = ref.current!.getBoundingClientRect();
      const k = (r.width / W) * zoom.scale;
      const dx = (e.clientX - p.x) / k;
      const dy = (e.clientY - p.y) / k;
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 4) p.moved = true;
      if (p.moved) ctl.setZoom({ ...zoom, cx: p.cx - dx, cy: p.cy - dy });
    }
  };
  const onPointerUp = () => {
    if (drawingTool) ctl.endStroke();
    if (pan.current?.moved) suppressClick.current = true;
    pan.current = null;
  };
  const onClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    if (ctl.zoomPick) {
      e.stopPropagation();
      const c = coords(e);
      setLens(null);
      return ctl.zoomTo(c.x, c.y);
    }
    // 그리기 도구 사용 중이거나 확대 화면을 끌었으면 슬라이드를 넘기지 않음
    if (drawingTool || suppressClick.current) {
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  const layer = (sl: Slide, style: CSSProperties, frames?: ReturnType<typeof frameStates>, mediaMuted?: boolean) => (
    <div key={sl.id} style={{ position: 'absolute', inset: 0, ...style }}>
      <ShowMediaContext.Provider value={{ muted: !!(muted || mediaMuted) }}>
        <SlideView slide={fix(sl)} doc={doc} mode="show" frames={frames} />
      </ShowMediaContext.Provider>
    </div>
  );

  let layers;
  if (trans) {
    const f = transitionFrame(slide.transition!, trans.p);
    const prevFrames = frameStates(trans.from.objects, buildTimeline(ctl.settings.noAnimation ? [] : trans.from.animations), { done: Infinity, t: null }, W, H);
    const nextFrames = frameStates(slide.objects, buildTimeline(ctl.settings.noAnimation ? [] : slide.animations), { done: 0, t: null }, W, H);
    const prevLayer = layer(trans.from, f.prev, prevFrames, true);
    const nextLayer = layer(slide, f.next, nextFrames);
    layers =
      slide.transition?.type === 'morph' ? (
        <ShowMediaContext.Provider value={{ muted: true }}>
          <MorphTransitionView doc={doc} from={fix(trans.from)} to={fix(slide)} p={trans.p} fromFrames={prevFrames} toFrames={nextFrames} />
        </ShowMediaContext.Provider>
      ) : (
      <>
        {f.prevOnTop ? nextLayer : prevLayer}
        {f.prevOnTop ? prevLayer : nextLayer}
        {f.black !== undefined && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: f.black }} />}
      </>
      );
  } else layers = layer(slide, {}, ctl.player.frames);

  const cursor = !interactive
    ? undefined
    : ctl.zoomPick
      ? 'zoom-in'
      : ctl.tool === 'laser'
        ? 'none'
        : drawingTool
          ? ctl.tool === 'eraser'
            ? 'cell'
            : 'crosshair'
          : zoom.scale > 1
            ? 'grab'
            : undefined;
  const k = scale * zoom.scale;
  const strokes: InkStroke[] = ctl.inkVisible && !trans ? [...ctl.slideInk, ...(ctl.drawing ? [ctl.drawing] : [])] : [];

  return (
    <div
      ref={ref}
      className="show-stage"
      data-transition={trans ? 'running' : undefined}
      data-zoom={zoom.scale > 1 ? zoom.scale : undefined}
      style={{ width: W * scale, height: H * scale, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        if (ctl.tool === 'laser') ctl.setLaser(null);
        setLens(null);
      }}
      onClick={onClick}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: W, height: H, position: 'relative' }}>
        <div className="show-zoom" style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: zoomTransform(zoom, W, H) }}>
          {layers}
          {strokes.length > 0 && (
            <svg className="show-ink" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {strokes.map((s) => (
                <path
                  key={s.id}
                  data-ink={s.tool}
                  d={inkPathD(s.points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeLinecap={s.tool === 'pen' ? 'round' : 'square'}
                  strokeLinejoin="round"
                  opacity={s.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1}
                />
              ))}
            </svg>
          )}
          {ctl.laser && ctl.tool === 'laser' && (
            <div
              className="show-laser"
              style={{
                left: ctl.laser.x,
                top: ctl.laser.y,
                width: 14 / k,
                height: 14 / k,
                background: ctl.settings.laserColor,
                boxShadow: `0 0 ${10 / k}px ${4 / k}px ${ctl.settings.laserColor}aa`,
              }}
            />
          )}
        </div>
        {ctl.zoomPick && lens && (
          <div
            className="show-lens"
            style={{
              left: Math.max(0, Math.min(W / 2, lens.x - W / 4)),
              top: Math.max(0, Math.min(H / 2, lens.y - H / 4)),
              width: W / 2,
              height: H / 2,
            }}
          />
        )}
      </div>
    </div>
  );
}
