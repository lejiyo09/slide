/** 전환 탭 · 애니메이션 탭 */
import { Play, ListOrdered, Zap, ChevronUp, ChevronDown, Plus, Star, MousePointerClick, Copy } from 'lucide-react';
import { RibbonButton, DropdownButton, RibbonGroup, MenuItem, MenuSeparator } from '../common/Buttons';
import { useEditor, useActiveSlide, useSelectedObjects } from '../../core/store/editorStore';
import * as AA from '../../core/commands/animActions';
import { TRANSITIONS, DIRECTION_NAMES, MORPH_OPTIONS } from '../../engines/transition/transitions';
import { EFFECTS, PATH_PRESETS } from '../../engines/animation/effects';
import type { AnimationCategory, AnimationStart, Direction, TransitionType } from '../../types/model';

export const CATEGORY_NAMES: Record<AnimationCategory, string> = { entrance: '나타내기', emphasis: '강조', exit: '끝내기', path: '이동 경로' };
export const CATEGORY_COLORS: Record<AnimationCategory, string> = { entrance: '#2E9D4F', emphasis: '#D8A100', exit: '#D13438', path: '#3A7BD5' };
export const START_NAMES: Record<AnimationStart, string> = { onClick: '클릭할 때', withPrevious: '이전 효과와 함께', afterPrevious: '이전 효과 다음에' };

/** 전환 아이콘: 두 사각형으로 효과를 도식화 */
function TransitionIcon({ id }: { id: TransitionType }) {
  const a = 'var(--shape-icon-fill)', b = 'var(--shape-icon-stroke)';
  const inner = {
    none: <rect x="6" y="8" width="28" height="20" fill="none" stroke={b} strokeDasharray="2 2" />,
    fade: (<><rect x="4" y="6" width="24" height="18" fill={a} /><rect x="12" y="12" width="24" height="18" fill={b} opacity="0.55" /></>),
    fadeBlack: (<><rect x="4" y="6" width="32" height="22" fill="#222" /><rect x="10" y="11" width="20" height="12" fill={b} opacity="0.4" /></>),
    push: (<><rect x="2" y="8" width="18" height="20" fill={a} /><rect x="20" y="8" width="18" height="20" fill={b} /><path d="M24 18h8m-3-3 3 3-3 3" stroke="#fff" fill="none" /></>),
    wipe: (<><rect x="4" y="8" width="32" height="20" fill={a} /><rect x="20" y="8" width="16" height="20" fill={b} /></>),
    split: (<><rect x="4" y="8" width="32" height="20" fill={a} /><rect x="14" y="8" width="12" height="20" fill={b} /></>),
    cover: (<><rect x="4" y="8" width="26" height="20" fill={a} /><rect x="14" y="10" width="22" height="20" fill={b} /></>),
    uncover: (<><rect x="10" y="10" width="26" height="20" fill={b} /><rect x="2" y="6" width="22" height="20" fill={a} stroke={b} /></>),
    circle: (<><rect x="4" y="8" width="32" height="20" fill={a} /><circle cx="20" cy="18" r="7" fill={b} /></>),
    zoom: (<><rect x="4" y="6" width="32" height="24" fill={a} /><rect x="13" y="13" width="14" height="10" fill={b} /></>),
    rotate: (<><rect x="4" y="8" width="32" height="20" fill={a} /><rect x="12" y="10" width="16" height="14" fill={b} transform="rotate(-20 20 17)" /></>),
    flip: (<><path d="M6 8 L20 11 L20 25 L6 28 Z" fill={a} /><path d="M20 11 L34 8 L34 28 L20 25 Z" fill={b} /></>),
    morph: (<><circle cx="11" cy="14" r="6" fill={a} /><rect x="22" y="16" width="14" height="12" rx="2" fill={b} /><path d="M16 16 Q20 12 23 19" stroke={b} strokeDasharray="2 2" fill="none" /></>),
  }[id];
  return (
    <svg width="40" height="34" viewBox="0 0 40 36" aria-hidden>
      {inner}
    </svg>
  );
}

export function TransitionsTab() {
  const slide = useActiveSlide();
  const t = slide.transition ?? { type: 'none' as TransitionType, duration: 0, advanceOnClick: true };
  const def = TRANSITIONS.find((x) => x.id === t.type)!;
  return (
    <>
      <RibbonGroup label="미리 보기">
        <RibbonButton size="large" icon={<Play size={26} />} label="미리 보기" title="현재 슬라이드의 전환 미리 보기" disabled={t.type === 'none'} onClick={AA.previewTransition} />
      </RibbonGroup>
      <RibbonGroup label="이 슬라이드로 전환" className="rg-gallery">
        <div className="fx-gallery" tabIndex={0} role="group" aria-label="전환 효과 목록">
          {TRANSITIONS.map((x) => (
            <button key={x.id} type="button" className={`fx-item ${t.type === x.id ? 'is-active' : ''}`} title={x.name} data-transition={x.id} onClick={() => AA.applyTransition(x.id)}>
              <TransitionIcon id={x.id} />
              <span>{x.name}</span>
            </button>
          ))}
        </div>
        <DropdownButton size="large" icon={<Zap size={22} />} label="효과 옵션" title={t.type === 'morph' ? '모핑 단위' : '방향'} disabled={!def.directions && t.type !== 'morph'}>
          {(close) => (
            <div className="menu" data-transition-options="">
              {t.type === 'morph' &&
                MORPH_OPTIONS.map((m) => (
                  <MenuItem key={m.id} label={m.name} checked={(t.morphOption ?? 'byObject') === m.id} onClick={() => (AA.updateTransition({ morphOption: m.id }), AA.previewTransition(), close())} />
                ))}
              {def.directions?.map((d) => (
                <MenuItem key={d} label={DIRECTION_NAMES[d]} checked={t.direction === d} onClick={() => (AA.updateTransition({ direction: d }), AA.previewTransition(), close())} />
              ))}
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="타이밍">
        <div className="rb-col rb-col-tight timing-col">
          <label className="timing-field">
            <span>기간</span>
            <SecondsInput value={t.duration} disabled={t.type === 'none'} onChange={(ms) => AA.updateTransition({ duration: ms })} />
          </label>
          <RibbonButton icon={<Copy size={15} />} label="모두 적용" title="이 슬라이드의 전환·타이밍을 모든 슬라이드에" onClick={AA.applyTransitionToAll} />
        </div>
        <div className="rb-col rb-col-tight timing-col">
          <div className="muted timing-head">화면 전환 시기</div>
          <label className="rb-check">
            <input type="checkbox" checked={t.advanceOnClick !== false} onChange={(e) => AA.updateTransition({ advanceOnClick: e.target.checked })} /> 마우스를 클릭할 때
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={t.advanceAfter !== undefined} onChange={(e) => AA.updateTransition({ advanceAfter: e.target.checked ? 5000 : undefined })} /> 다음 시간 후:
            <SecondsInput value={t.advanceAfter ?? 0} disabled={t.advanceAfter === undefined} onChange={(ms) => AA.updateTransition({ advanceAfter: ms })} />
          </label>
        </div>
      </RibbonGroup>
    </>
  );
}

/** 초 단위 입력 (내부 값은 ms) */
export function SecondsInput({ value, onChange, disabled, max = 600 }: { value: number; onChange: (ms: number) => void; disabled?: boolean; max?: number }) {
  return (
    <input
      type="number"
      className="rb-input seconds-input"
      step={0.25}
      min={0}
      max={max}
      disabled={disabled}
      value={Math.round(value / 10) / 100}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v <= max) onChange(Math.round(v * 1000));
      }}
    />
  );
}

function EffectIcon({ category }: { category: AnimationCategory }) {
  return <Star size={22} fill={CATEGORY_COLORS[category]} color={CATEGORY_COLORS[category]} />;
}

export function AnimationsTab() {
  const slide = useActiveSlide();
  const sel = useSelectedObjects();
  const selectedAnimIds = useEditor((s) => s.selectedAnimIds);
  const paneOpen = useEditor((s) => s.animPaneOpen);
  const list = slide.animations ?? [];
  const targetIds = (() => {
    const ids = selectedAnimIds.filter((id) => list.some((a) => a.id === id));
    return ids.length ? ids : list.filter((a) => sel.some((o) => o.id === a.targetId)).map((a) => a.id);
  })();
  const cur = list.find((a) => a.id === targetIds[0]);
  const curDef = cur ? EFFECTS.find((e) => e.id === cur.effect) : undefined;
  const noTarget = !sel.length;
  const categories: AnimationCategory[] = ['entrance', 'emphasis', 'exit', 'path'];
  return (
    <>
      <RibbonGroup label="미리 보기">
        <RibbonButton size="large" icon={<Play size={26} />} label="미리 보기" title="이 슬라이드의 애니메이션 미리 보기" disabled={!list.length} onClick={AA.previewAnimation} />
      </RibbonGroup>
      <RibbonGroup label="애니메이션" className="rg-gallery">
        <div className="fx-gallery fx-anim" tabIndex={0} role="group" aria-label="애니메이션 효과 목록">
          {categories.map((cat) =>
            EFFECTS.filter((e) => e.category === cat && cat !== 'path').map((e) => (
              <button
                key={e.id}
                type="button"
                className={`fx-item ${cur?.effect === e.id ? 'is-active' : ''}`}
                title={`${CATEGORY_NAMES[cat]}: ${e.name}`}
                data-effect={e.id}
                disabled={noTarget}
                onClick={() => AA.applyAnimation(e.id)}
              >
                <EffectIcon category={cat} />
                <span>{e.name}</span>
              </button>
            )),
          )}
          {PATH_PRESETS.map((pp) => (
            <button key={pp.id} type="button" className={`fx-item ${cur?.effect === 'path' ? '' : ''}`} title={`이동 경로: ${pp.name}`} data-path={pp.id} disabled={noTarget} onClick={() => AA.applyAnimation('path', { pathPreset: pp.id })}>
              <EffectIcon category="path" />
              <span>{pp.name}</span>
            </button>
          ))}
        </div>
        <DropdownButton size="large" icon={<Zap size={22} />} label="효과 옵션" title="방향" disabled={!curDef?.directions}>
          {(close) => (
            <div className="menu">
              {curDef?.directions?.map((d) => (
                <MenuItem key={d} label={{ down: '아래에서', up: '위에서', left: '왼쪽에서', right: '오른쪽에서' }[d]} checked={cur?.direction === d} onClick={() => (AA.updateSelectedAnimations('효과 옵션', (a) => void (a.direction = d as Direction)), close())} />
              ))}
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="고급 애니메이션">
        <DropdownButton size="large" icon={<Plus size={26} />} label="애니메이션 추가" title="선택한 개체에 효과를 하나 더 추가" disabled={noTarget} panelClass="wide">
          {(close) => (
            <div className="add-anim-menu">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="menu-title">{CATEGORY_NAMES[cat]}</div>
                  <div className="menu-inline">
                    {cat === 'path'
                      ? PATH_PRESETS.map((pp) => (
                          <button key={pp.id} type="button" className="chip" onClick={() => (AA.applyAnimation('path', { add: true, pathPreset: pp.id }), close())}>
                            {pp.name}
                          </button>
                        ))
                      : EFFECTS.filter((e) => e.category === cat).map((e) => (
                          <button key={e.id} type="button" className="chip" data-add-effect={e.id} onClick={() => (AA.applyAnimation(e.id, { add: true }), close())}>
                            {e.name}
                          </button>
                        ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DropdownButton>
        <div className="rb-col">
          <RibbonButton icon={<ListOrdered size={15} />} label="애니메이션 창" title="애니메이션 창 열기/닫기" active={paneOpen} onClick={() => useEditor.getState().set({ animPaneOpen: !paneOpen })} />
          <DropdownButton icon={<MousePointerClick size={15} />} label="트리거" title="다른 개체를 클릭할 때 재생" disabled={!cur}>
            {(close) => (
              <div className="menu">
                <MenuItem label="클릭 순서대로 (트리거 없음)" checked={!cur?.triggerId} onClick={() => (AA.setTrigger(null), close())} />
                <MenuSeparator />
                <div className="menu-title">클릭할 개체</div>
                {slide.objects
                  .filter((o) => o.id !== cur?.targetId)
                  .map((o) => (
                    <MenuItem key={o.id} label={o.name || o.type} checked={cur?.triggerId === o.id} onClick={() => (AA.setTrigger(o.id), close())} />
                  ))}
              </div>
            )}
          </DropdownButton>
        </div>
      </RibbonGroup>
      <RibbonGroup label="타이밍">
        <div className="rb-col rb-col-tight timing-col">
          <label className="timing-field">
            <span>시작</span>
            <select className="rb-select" disabled={!cur} value={cur?.start ?? 'onClick'} onChange={(e) => AA.updateSelectedAnimations('시작', (a) => void (a.start = e.target.value as AnimationStart))}>
              {Object.entries(START_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="timing-field">
            <span>재생 시간</span>
            <SecondsInput value={cur?.duration ?? 0} disabled={!cur} onChange={(ms) => AA.updateSelectedAnimations('재생 시간', (a) => void (a.duration = ms))} />
          </label>
          <label className="timing-field">
            <span>지연</span>
            <SecondsInput value={cur?.delay ?? 0} disabled={!cur} onChange={(ms) => AA.updateSelectedAnimations('지연', (a) => void (a.delay = ms))} />
          </label>
        </div>
        <div className="rb-col rb-col-tight timing-col">
          <label className="timing-field">
            <span>반복</span>
            <select className="rb-select" disabled={!cur} value={cur?.repeat ?? 1} onChange={(e) => AA.updateSelectedAnimations('반복', (a) => void (a.repeat = Number(e.target.value)))}>
              <option value={1}>(없음)</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={0}>다음 클릭할 때까지</option>
            </select>
          </label>
          <div className="rb-row">
            <RibbonButton icon={<ChevronUp size={15} />} label="앞으로" title="애니메이션 순서를 앞으로" disabled={targetIds.length !== 1} onClick={() => AA.moveSelectedAnimation(-1)} />
            <RibbonButton icon={<ChevronDown size={15} />} label="뒤로" title="애니메이션 순서를 뒤로" disabled={targetIds.length !== 1} onClick={() => AA.moveSelectedAnimation(1)} />
          </div>
        </div>
      </RibbonGroup>
    </>
  );
}
