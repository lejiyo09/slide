/**
 * 모핑 전환 화면: [앞 슬라이드 배경·디자인] → [다음 슬라이드 배경·디자인(서서히)] → [모핑 장면(개체·글자 묶음)].
 * 슬라이드 쇼·전환 미리 보기·비디오 내보내기가 함께 쓴다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Presentation, Slide, SlideObject } from '../../types/model';
import type { Frame } from '../animation/effects';
import { ObjectView, type RenderMode } from '../rendering/ObjectView';
import { SlideView } from '../rendering/SlideView';
import { resolveTokensDeep } from '../../utils/themeColor';
import { buildMorphPlan, morphFrame, type MorphOption, type MorphPlan, type MorphScene, type MorphToken } from './morph';
import { measureMorphTokens } from './morphMeasure';

type Doc = Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>;

/** 애니메이션 상태로 보이지 않는 개체(아직 나타나지 않음·이미 끝남)는 빼고, 테마 색은 실제 값으로 */
function visibleObjects(doc: Doc, slide: Slide | null, frames?: Map<string, Frame>): SlideObject[] {
  if (!slide) return [];
  const objs = slide.objects.filter((o) => !o.hidden && frames?.get(o.id)?.visible !== false && (frames?.get(o.id)?.opacity ?? 1) > 0);
  return resolveTokensDeep(objs, doc.theme);
}

export interface MorphPlanInput {
  doc: Doc;
  from: Slide | null;
  to: Slide;
  fromFrames?: Map<string, Frame>;
  toFrames?: Map<string, Frame>;
  tokens?: Map<string, MorphToken[]>;
}

/** 전환 하나에 한 번: 보이는 개체로 짝짓기·경로·글자 묶음 계획 (설정은 다음 슬라이드의 전환) */
export function planMorph({ doc, from, to, fromFrames, toFrames, tokens }: MorphPlanInput): MorphPlan {
  const tr = to.transition;
  return buildMorphPlan({ from: visibleObjects(doc, from, fromFrames), to: visibleObjects(doc, to, toFrames), option: tr?.morphOption ?? 'byObject', tokens, easing: tr });
}

/** 동작 줄이기(prefers-reduced-motion)를 켠 사용자에게는 움직임 없이 페이드 */
export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 단어/문자 옵션: 두 슬라이드의 텍스트 개체 글자 묶음을 잼 (개체 옵션이면 빈 목록) */
export async function morphTokensFor(doc: Doc, from: Slide | null, to: Slide, option: MorphOption = 'byObject'): Promise<Map<string, MorphToken[]>> {
  const m = new Map<string, MorphToken[]>();
  if (option === 'byObject') return m;
  if (from) for (const [k, v] of await measureMorphTokens(doc, from, option)) m.set(k, v);
  for (const [k, v] of await measureMorphTokens(doc, to, option)) m.set(k, v);
  return m;
}

/** 모핑 장면만 (배경 없음, 투명) */
export function MorphLayer({ scene, doc, mode = 'show' }: { scene: MorphScene; doc: Doc; mode?: RenderMode }) {
  return (
    <div className="sl-morph" style={{ position: 'absolute', left: 0, top: 0, width: doc.size.width, height: doc.size.height, overflow: 'hidden' }} data-morph="">
      {scene.objects.map((o) => (
        <ObjectView key={o.id} obj={o} assets={doc.assets} theme={doc.theme} mode={mode} frame={scene.frames.get(o.id)} tagId={mode === 'show'} />
      ))}
      {scene.tokens.map((t) =>
        t.opacity > 0.001 ? (
          <span
            key={t.key}
            data-morph-token={t.text}
            style={{
              position: 'absolute',
              left: t.x,
              top: t.y,
              height: t.height,
              lineHeight: `${t.height}px`,
              whiteSpace: 'pre',
              fontFamily: t.style.fontFamily,
              fontSize: t.style.fontSize,
              fontWeight: t.style.fontWeight as React.CSSProperties['fontWeight'],
              fontStyle: t.style.fontStyle,
              color: t.style.color,
              textDecoration: t.style.textDecoration,
              letterSpacing: t.style.letterSpacing,
              opacity: t.opacity,
            }}
          >
            {t.text}
          </span>
        ) : null,
      )}
    </div>
  );
}

const bgOnly = (s: Slide): Slide => ({ ...s, objects: [] });

/** 전환 전체: 배경 두 장 + 장면. 계획은 전환마다 한 번, 프레임마다는 사이값만 계산 */
export function MorphTransitionView({ doc, from, to, p, fromFrames, toFrames }: Omit<MorphPlanInput, 'tokens'> & { p: number }) {
  const tr = to.transition;
  const option = tr?.morphOption ?? 'byObject';
  const reduced = useMemo(prefersReducedMotion, []);
  // 글자 묶음은 전환 하나에 한 번만 잼 (재는 동안 몇 프레임은 개체 단위로 그림)
  const [tokens, setTokens] = useState<Map<string, MorphToken[]> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setTokens(undefined);
    if (!reduced) void morphTokensFor(doc, from, to, option).then((t) => alive && setTokens(t));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.id, to.id, option, reduced]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planMorph({ doc, from, to, fromFrames, toFrames, tokens }), [from?.id, to.id, option, tr?.easing, tr?.bezier?.join(','), tokens]);
  const bgFrom = useMemo(() => (from ? bgOnly(from) : null), [from]);
  const bgTo = useMemo(() => bgOnly(to), [to]);
  const q = Math.max(0, Math.min(1, p));
  if (reduced)
    return (
      <>
        <div style={{ position: 'absolute', inset: 0 }}>{from ? <SlideView slide={from} doc={doc} mode="show" frames={fromFrames} /> : null}</div>
        <div style={{ position: 'absolute', inset: 0, opacity: q }}>
          <SlideView slide={to} doc={doc} mode="show" frames={toFrames} />
        </div>
      </>
    );
  const scene = morphFrame(plan, q);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0 }}>{bgFrom ? <SlideView slide={bgFrom} doc={doc} mode="show" /> : <div style={{ position: 'absolute', inset: 0, background: '#000' }} />}</div>
      <div style={{ position: 'absolute', inset: 0, opacity: plan.ease(q) }}>
        <SlideView slide={bgTo} doc={doc} mode="show" />
      </div>
      <MorphLayer scene={scene} doc={doc} />
    </>
  );
}
