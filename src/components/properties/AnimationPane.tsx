/** 애니메이션 창: 순서·시작 조건·트리거를 한눈에 보고 편집 */
import { Play, ChevronUp, ChevronDown, Trash2, PanelRightClose, MousePointerClick, Clock, Link2 } from 'lucide-react';
import { useEditor, useActiveSlide } from '../../core/store/editorStore';
import * as AA from '../../core/commands/animActions';
import { effectById } from '../../engines/animation/effects';
import { buildTimeline } from '../../engines/animation/timeline';
import { CATEGORY_COLORS, CATEGORY_NAMES, START_NAMES } from '../ribbon/AnimTabs';
import type { Animation } from '../../types/model';

export function AnimationPane({ onClose }: { onClose: () => void }) {
  const slide = useActiveSlide();
  const selected = useEditor((s) => s.selectedAnimIds);
  const list = slide.animations ?? [];
  const tl = buildTimeline(list);
  // 클릭 번호: 단계 순서 (자동 단계는 0)
  const stepOf = new Map<string, number>();
  let n = 0;
  tl.steps.forEach((st) => {
    if (!st.auto) n++;
    for (const it of st.items) stepOf.set(it.anim.id, st.auto ? 0 : n);
  });
  const nameOf = (id: string) => slide.objects.find((o) => o.id === id)?.name ?? '(삭제된 개체)';
  const select = (a: Animation, e: React.MouseEvent) => {
    const s = useEditor.getState();
    const ids = e.ctrlKey || e.metaKey ? (selected.includes(a.id) ? selected.filter((x) => x !== a.id) : [...selected, a.id]) : [a.id];
    useEditor.setState({ selectedAnimIds: ids });
    s.select([...new Set(list.filter((x) => ids.includes(x.id)).map((x) => x.targetId))]);
  };
  const row = (a: Animation) => {
    const def = effectById(a.effect);
    const step = stepOf.get(a.id);
    return (
      <li key={a.id} className={`ap-item ${selected.includes(a.id) ? 'is-selected' : ''}`} onClick={(e) => select(a, e)} data-anim-id={a.id}>
        <span className="ap-num">{a.start === 'onClick' || a.triggerId ? step || '' : ''}</span>
        <span className="ap-start" title={START_NAMES[a.start]}>
          {a.start === 'onClick' ? <MousePointerClick size={12} /> : a.start === 'afterPrevious' ? <Clock size={12} /> : <Link2 size={12} />}
        </span>
        <span className="ap-star" style={{ background: CATEGORY_COLORS[a.category] }} title={CATEGORY_NAMES[a.category]} />
        <span className="ap-label">
          <strong>{nameOf(a.targetId)}</strong>
          <em>
            {CATEGORY_NAMES[a.category]}: {def?.name ?? a.effect} · {(a.duration / 1000).toFixed(2)}초{a.delay ? ` · 지연 ${(a.delay / 1000).toFixed(2)}초` : ''}
            {a.repeat !== 1 ? ` · ${a.repeat === 0 ? '반복(클릭까지)' : `${a.repeat}회`}` : ''}
          </em>
        </span>
        <span className="ap-bar" style={{ background: CATEGORY_COLORS[a.category] }} />
      </li>
    );
  };
  const main = list.filter((a) => !a.triggerId);
  const triggers = [...new Set(list.filter((a) => a.triggerId).map((a) => a.triggerId!))];
  return (
    <aside className="properties anim-pane" aria-label="애니메이션 창">
      <div className="pp-head">
        <span>애니메이션 창</span>
        <button type="button" className="icon-btn" title="닫기" onClick={onClose}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="ap-tools">
        <button type="button" className="btn btn-sm" disabled={!list.length} onClick={AA.previewAnimation}>
          <Play size={13} /> 모두 재생
        </button>
        <span className="sb-spacer" />
        <button type="button" className="icon-btn" title="앞으로" disabled={selected.length !== 1} onClick={() => AA.moveSelectedAnimation(-1)}>
          <ChevronUp size={15} />
        </button>
        <button type="button" className="icon-btn" title="뒤로" disabled={selected.length !== 1} onClick={() => AA.moveSelectedAnimation(1)}>
          <ChevronDown size={15} />
        </button>
        <button type="button" className="icon-btn" title="제거 (Delete)" disabled={!selected.length} onClick={AA.removeSelectedAnimations}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="pp-body">
        {!list.length && <p className="pp-hint ap-empty">개체를 선택하고 [애니메이션] 탭에서 효과를 고르세요.</p>}
        <ul className="ap-list">{main.map(row)}</ul>
        {triggers.map((tid) => (
          <div key={tid} className="ap-trigger">
            <div className="ap-trigger-head">트리거: {nameOf(tid)} 클릭 시</div>
            <ul className="ap-list">{list.filter((a) => a.triggerId === tid).map(row)}</ul>
          </div>
        ))}
      </div>
    </aside>
  );
}
