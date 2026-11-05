import { useState } from 'react';
import { Undo2, Redo2, Save, Play, Cloud, CloudOff, Loader2, Check, MonitorDown } from 'lucide-react';
import { useEditor, useSelectedObjects } from '../../core/store/editorStore';
import { TableDesignTab, TableLayoutTab, ChartDesignTab, MediaTab } from './ObjectTabs';
import { saveNow } from '../../services/storage/autosave';
import { HomeTab } from './HomeTab';
import { AnimationsTab, DesignTab, InsertTab, RecordTab, ReviewTab, SlideShowTab, TransitionsTab, ViewTab } from './OtherTabs';
import { ContextualTab } from './ContextualTab';
import { usePwaInstall } from '../../hooks/usePwaInstall';

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'insert', label: '삽입' },
  { id: 'design', label: '디자인' },
  { id: 'transitions', label: '전환' },
  { id: 'animations', label: '애니메이션' },
  { id: 'slideshow', label: '슬라이드 쇼' },
  { id: 'record', label: '녹화' },
  { id: 'review', label: '검토' },
  { id: 'view', label: '보기' },
] as const;

type TabId = (typeof TABS)[number]['id'] | 'format' | 'tableDesign' | 'tableLayout' | 'chartDesign' | 'media';

export function Ribbon({ onCustomSize }: { onCustomSize: () => void }) {
  const [tab, setTab] = useState<TabId>('home');
  const [collapsed, setCollapsed] = useState(false);
  const title = useEditor((s) => s.doc.title);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past[s.history.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.history.future[0]?.label);
  const saveStatus = useEditor((s) => s.saveStatus);
  const selected = useSelectedObjects();
  const contextualTabs: { id: TabId; label: string }[] = (() => {
    if (!selected.length) return [];
    if (selected.length === 1 && selected[0].type === 'table') return [{ id: 'tableDesign', label: '표 디자인' }, { id: 'tableLayout', label: '레이아웃' }];
    if (selected.length === 1 && selected[0].type === 'chart') return [{ id: 'chartDesign', label: '차트 디자인' }, { id: 'format', label: '서식' }];
    if (selected.length === 1 && selected[0].type === 'media') return [{ id: 'media', label: '재생' }, { id: 'format', label: '서식' }];
    return [{ id: 'format', label: selected.every((o) => o.type === 'image') ? '그림 서식' : '도형 서식' }];
  })();
  const { canInstall, install } = usePwaInstall();
  const isContextual = (t: TabId) => ['format', 'tableDesign', 'tableLayout', 'chartDesign', 'media'].includes(t);
  const activeTab: TabId = isContextual(tab) && !contextualTabs.some((c) => c.id === tab) ? 'home' : tab;
  const table = selected.length === 1 && selected[0].type === 'table' ? selected[0] : null;

  return (
    <header className="ribbon-wrap">
      <div className="titlebar">
        <div className="qat" role="toolbar" aria-label="빠른 실행 도구 모음">
          <span className="app-badge" aria-hidden>
            S
          </span>
          <button type="button" className="qat-btn" title="저장 (Ctrl+S) — 변경 내용은 자동 저장됩니다" onClick={() => void saveNow()}>
            <Save size={15} />
          </button>
          <button type="button" className="qat-btn" title={`실행 취소${undoLabel ? `: ${undoLabel}` : ''} (Ctrl+Z)`} disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
            <Undo2 size={15} />
          </button>
          <button type="button" className="qat-btn" title={`다시 실행${redoLabel ? `: ${redoLabel}` : ''} (Ctrl+Y)`} disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
            <Redo2 size={15} />
          </button>
          <button
            type="button"
            className="qat-btn"
            title="처음부터 슬라이드 쇼 (F5)"
            onClick={() => useEditor.getState().set({ slideshow: { startIndex: 0 } })}
          >
            <Play size={15} />
          </button>
        </div>
        <div className="doc-title">
          <input
            key={title}
            className="doc-title-input"
            defaultValue={title}
            aria-label="프레젠테이션 제목"
            onBlur={(e) => e.target.value !== title && useEditor.getState().commit('제목 변경', (d) => void (d.title = e.target.value.trim() || '제목 없는 프레젠테이션'))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <SaveBadge status={saveStatus} />
        </div>
        <div className="titlebar-right">
          {canInstall && (
            <button type="button" className="qat-btn install-btn" title="SlideLab을 앱으로 설치 (오프라인 사용)" onClick={install}>
              <MonitorDown size={15} /> 앱 설치
            </button>
          )}
          <span className="brand">SlideLab</span>
        </div>
      </div>
      <nav className="tabs" role="tablist">
        <button type="button" className="tab tab-file" role="tab" onClick={() => useEditor.getState().set({ backstageOpen: true })}>
          파일
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`tab ${activeTab === t.id ? 'is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (setTab(t.id), setCollapsed(false))}
            onDoubleClick={() => setCollapsed((c) => !c)}
          >
            {t.label}
          </button>
        ))}
        {contextualTabs.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeTab === c.id}
            className={`tab tab-contextual ${activeTab === c.id ? 'is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (setTab(c.id), setCollapsed(false))}
          >
            {c.label}
          </button>
        ))}
      </nav>
      {!collapsed && (
        <div className="ribbon" role="tabpanel">
          {activeTab === 'home' && <HomeTab />}
          {activeTab === 'insert' && <InsertTab />}
          {activeTab === 'design' && <DesignTab onCustomSize={onCustomSize} />}
          {activeTab === 'transitions' && <TransitionsTab />}
          {activeTab === 'animations' && <AnimationsTab />}
          {activeTab === 'slideshow' && <SlideShowTab />}
          {activeTab === 'record' && <RecordTab />}
          {activeTab === 'review' && <ReviewTab />}
          {activeTab === 'view' && <ViewTab />}
          {activeTab === 'format' && <ContextualTab />}
          {activeTab === 'tableDesign' && table && <TableDesignTab table={table} />}
          {activeTab === 'tableLayout' && table && <TableLayoutTab table={table} />}
          {activeTab === 'chartDesign' && <ChartDesignTab />}
          {activeTab === 'media' && <MediaTab />}
        </div>
      )}
    </header>
  );
}

function SaveBadge({ status }: { status: string }) {
  const map: Record<string, [React.ReactNode, string]> = {
    saved: [<Check size={13} key="i" />, '저장됨'],
    saving: [<Loader2 size={13} className="spin" key="i" />, '저장 중…'],
    unsaved: [<Cloud size={13} key="i" />, '변경됨'],
    error: [<CloudOff size={13} key="i" />, '저장 실패'],
  };
  const [icon, label] = map[status] ?? map.saved;
  return (
    <span className={`save-badge s-${status}`} title="이 브라우저에 자동 저장됩니다">
      {icon}
      {label}
    </span>
  );
}
