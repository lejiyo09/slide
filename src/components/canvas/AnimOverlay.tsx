/** 편집 캔버스의 애니메이션 표시(번호 배지·이동 경로)와 미리 보기 재생 */
import { useEffect, useState } from 'react';
import { useEditor } from '../../core/store/editorStore';
import { SlideView } from '../../engines/rendering/SlideView';
import { useAnimationPlayer } from '../../engines/animation/usePlayer';
import { buildTimeline, frameStates } from '../../engines/animation/timeline';
import { transitionFrame } from '../../engines/transition/transitions';
import type { Presentation, Slide } from '../../types/model';
import { CATEGORY_COLORS } from '../ribbon/AnimTabs';

/** 애니메이션 순서 번호 배지 (애니메이션 탭/창이 열려 있을 때) */
export function AnimBadges({ slide, zoom }: { slide: Slide; zoom: number }) {
  const show = useEditor((s) => s.ribbonTab === 'animations' || s.animPaneOpen);
  const selectedIds = useEditor((s) => s.selectedIds);
  if (!show || !slide.animations?.length) return null;
  const tl = buildTimeline(slide.animations);
  const labels = new Map<string, { nums: string[]; color: string }>();
  let n = 0;
  tl.steps.forEach((st) => {
    if (!st.auto) n++;
    for (const it of st.items) {
      const e = labels.get(it.anim.targetId) ?? { nums: [], color: CATEGORY_COLORS[it.anim.category] };
      const label = st.auto ? '0' : String(n);
      if (!e.nums.includes(label)) e.nums.push(label);
      labels.set(it.anim.targetId, e);
    }
  });
  for (const a of slide.animations)
    if (a.triggerId) {
      const e = labels.get(a.targetId) ?? { nums: [], color: CATEGORY_COLORS[a.category] };
      if (!e.nums.includes('⚡')) e.nums.push('⚡');
      labels.set(a.targetId, e);
    }
  return (
    <div className="anim-badges" aria-hidden>
      {[...labels].map(([id, l]) => {
        const o = slide.objects.find((x) => x.id === id);
        if (!o) return null;
        return (
          <span key={id} className="anim-badge" style={{ left: o.x * zoom - 22, top: o.y * zoom, borderColor: l.color }}>
            {l.nums.join(',')}
          </span>
        );
      })}
      {/* 선택한 개체의 이동 경로 */}
      <svg className="overlay-svg" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {slide.animations
          .filter((a) => a.category === 'path' && a.path && selectedIds.includes(a.targetId))
          .map((a) => {
            const o = slide.objects.find((x) => x.id === a.targetId);
            if (!o) return null;
            const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
            const pts = a.path!.map((p) => `${(cx + p.x) * zoom},${(cy + p.y) * zoom}`).join(' ');
            const last = a.path![a.path!.length - 1];
            return (
              <g key={a.id}>
                <polyline points={pts} fill="none" stroke="#3A7BD5" strokeWidth={1.5} strokeDasharray="5 4" />
                <circle cx={cx * zoom} cy={cy * zoom} r={4} fill="#2E9D4F" />
                <circle cx={(cx + last.x) * zoom} cy={(cy + last.y) * zoom} r={4} fill="#D13438" />
              </g>
            );
          })}
      </svg>
    </div>
  );
}

/** 미리 보기: 캔버스 위에서 전환/애니메이션 재생 후 자동으로 닫힘 */
export function PreviewOverlay({ slide, doc }: { slide: Slide; doc: Presentation }) {
  const preview = useEditor((s) => s.preview);
  if (!preview || preview.slideId !== slide.id) return null;
  const stop = () => useEditor.setState({ preview: null });
  return (
    <div className="preview-overlay" onPointerDown={stop} title="클릭하면 미리 보기를 멈춥니다">
      {preview.kind === 'animation' ? (
        <AnimPreview key={preview.key} slide={slide} doc={doc} onDone={stop} />
      ) : (
        <TransitionPreview key={preview.key} slide={slide} doc={doc} onDone={stop} />
      )}
    </div>
  );
}

function AnimPreview({ slide, doc, onDone }: { slide: Slide; doc: Presentation; onDone: () => void }) {
  const player = useAnimationPlayer(slide, doc.size.width, doc.size.height, { autoplay: true });
  useEffect(() => {
    if (player.finished) {
      const t = setTimeout(onDone, 400);
      return () => clearTimeout(t);
    }
  }, [player.finished, onDone]);
  return <SlideView slide={slide} doc={doc} mode="show" frames={player.frames} />;
}

function TransitionPreview({ slide, doc, onDone }: { slide: Slide; doc: Presentation; onDone: () => void }) {
  const [p, setP] = useState(0);
  const t = slide.transition;
  useEffect(() => {
    const dur = t?.duration ?? 0;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const v = dur ? (performance.now() - t0) / dur : 1;
      setP(Math.min(1, v));
      if (v < 1) raf = requestAnimationFrame(tick);
      else setTimeout(onDone, 250);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!t) return null;
  const idx = doc.slides.findIndex((x) => x.id === slide.id);
  const prevSlide = doc.slides[idx - 1];
  const f = transitionFrame(t, p);
  const prevFrames = prevSlide ? frameStates(prevSlide.objects, buildTimeline(prevSlide.animations), { done: Infinity, t: null }, doc.size.width, doc.size.height) : undefined;
  const nextFrames = frameStates(slide.objects, buildTimeline(slide.animations), { done: 0, t: null }, doc.size.width, doc.size.height);
  const prevLayer = (
    <div style={{ position: 'absolute', inset: 0, ...f.prev }}>
      {prevSlide ? <SlideView slide={prevSlide} doc={doc} mode="show" frames={prevFrames} /> : <div style={{ position: 'absolute', inset: 0, background: '#000' }} />}
    </div>
  );
  const nextLayer = (
    <div style={{ position: 'absolute', inset: 0, ...f.next }}>
      <SlideView slide={slide} doc={doc} mode="show" frames={nextFrames} />
    </div>
  );
  return (
    <div className="preview-transition" data-p={p.toFixed(2)}>
      {f.prevOnTop ? nextLayer : prevLayer}
      {f.prevOnTop ? prevLayer : nextLayer}
      {f.black !== undefined && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: f.black }} />}
    </div>
  );
}
