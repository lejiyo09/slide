import { lazy, Suspense, useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useEditor } from '../core/store/editorStore';
import { Ribbon } from '../components/ribbon/Ribbon';
import { Backstage } from '../components/ribbon/Backstage';
import { SlidePanel, SorterView } from '../components/sidebar/SlidePanel';
import { MasterPanel } from '../components/sidebar/MasterPanel';
import { CommentsPane } from '../components/comments/CommentsPane';
import { SpellPane } from '../components/spell/SpellPane';
import { ComparePane } from '../components/compare/ComparePane';
import { useDocFonts } from '../hooks/useDocFonts';
import { FontDialogs, addFontsFromFiles } from '../components/dialogs/FontDialogs';
import { EquationDialogHost } from '../components/dialogs/EquationDialog';
import { AnimationPane } from '../components/properties/AnimationPane';
import { EditorCanvas } from '../components/canvas/EditorCanvas';
import { PropertiesPanel } from '../components/properties/PropertiesPanel';
import { NotesPane, StatusBar } from '../components/statusbar/StatusBar';
import { SlideSizeDialog } from '../components/dialogs/SlideSizeDialog';
import { Toasts } from '../components/common/Toasts';
import { PwaPrompt } from '../components/common/PwaPrompt';
import { useShortcuts } from '../hooks/useShortcuts';
import { bootstrap } from './bootstrap';

// 처음 화면에 필요 없는 큰 구성 요소는 쓸 때 불러옴 (시작 크기 절약)
const AIPane = lazy(() => import('../components/ai/AIPane').then((m) => ({ default: m.AIPane })));
const SlideShow = lazy(() => import('../components/slideshow/SlideShow').then((m) => ({ default: m.SlideShow })));
import { ImportReportDialog } from '../components/dialogs/ImportReportDialog';
import { ChartDataEditor } from '../components/dialogs/ChartDataEditor';
import { LinkDialog } from '../components/ribbon/InsertExtras';
import { lockSelection } from '../editors/text/editorSession';
import { isOpenableFile, openPresentationFile, registerLaunchQueue } from '../services/import/importFile';

export function App() {
  const [ready, setReady] = useState(false);
  const [sizeDialog, setSizeDialog] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  useEffect(() => {
    const f = () => {
      lockSelection();
      setLinkDialog(true);
    };
    window.addEventListener('slidelab:link', f);
    return () => window.removeEventListener('slidelab:link', f);
  }, []);
  const darkMode = useEditor((s) => s.darkMode);
  const viewMode = useEditor((s) => s.viewMode);
  const showNotes = useEditor((s) => s.showNotes);
  const showProps = useEditor((s) => s.showProperties);
  const masterView = useEditor((s) => s.masterView);
  const animPane = useEditor((s) => s.animPaneOpen);
  const aiPane = useEditor((s) => s.aiPane);
  const commentsPane = useEditor((s) => s.commentsPane);
  const slideshowOn = useEditor((s) => !!s.slideshow);
  const spellPane = useEditor((s) => s.spellPane);
  const compare = useEditor((s) => s.compare);
  useShortcuts();
  useDocFonts();

  useEffect(() => {
    void bootstrap().finally(() => {
      setReady(true);
      registerLaunchQueue();
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  const setProps = (v: boolean) => {
    useEditor.getState().set({ showProperties: v });
    try {
      localStorage.setItem('slidelab.showProperties', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-logo">S</div>
        <div>SlideLab을 여는 중…</div>
      </div>
    );
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        // .pptx/.slidelab 파일은 창 어디에 놓아도 열기 (이미지는 캔버스가 처리)
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const fontFiles = Array.from(e.dataTransfer.files).filter((x) => /\.(ttf|otf|ttc|woff2?)$/i.test(x.name));
        if (fontFiles.length) {
          // 글꼴 파일을 창에 놓으면 내 글꼴에 추가
          e.preventDefault();
          e.stopPropagation();
          void addFontsFromFiles(fontFiles);
          return;
        }
        const f = Array.from(e.dataTransfer.files).find(isOpenableFile);
        if (f) {
          e.preventDefault();
          e.stopPropagation();
          void openPresentationFile(f);
        }
      }}
    >
      <Ribbon onCustomSize={() => setSizeDialog(true)} />
      <div className="workspace">
        {viewMode === 'normal' ? (
          <>
            {masterView ? <MasterPanel /> : <SlidePanel />}
            <main className={`center ${masterView ? 'is-master-view' : ''}`} onPointerDown={() => useEditor.getState().set({ focusArea: 'canvas' })}>
              <h1 className="sr-only">SlideLab 프레젠테이션 편집기</h1>
              <EditorCanvas />
              {showNotes && !masterView && <NotesPane />}
            </main>
            {compare && !masterView ? (
              <ComparePane />
            ) : spellPane && !masterView ? (
              <SpellPane />
            ) : commentsPane && !masterView ? (
              <CommentsPane />
            ) : aiPane && !masterView ? (
              <Suspense fallback={<aside className="properties" aria-busy="true" />}>
                <AIPane />
              </Suspense>
            ) : animPane && !masterView ? (
              <AnimationPane onClose={() => useEditor.getState().set({ animPaneOpen: false })} />
            ) : showProps ? (
              <PropertiesPanel onClose={() => setProps(false)} />
            ) : (
              <button type="button" className="props-reopen" title="서식 창 열기" onClick={() => setProps(true)}>
                <PanelRightOpen size={16} />
              </button>
            )}
          </>
        ) : (
          <SorterView />
        )}
      </div>
      <StatusBar />
      <Backstage />
      {slideshowOn && (
        <Suspense fallback={<div className="slideshow-loading" aria-busy="true" />}>
          <SlideShow />
        </Suspense>
      )}
      {sizeDialog && <SlideSizeDialog onClose={() => setSizeDialog(false)} />}
      <ImportReportDialog />
      <ChartDataEditor />
      {linkDialog && <LinkDialog onClose={() => setLinkDialog(false)} />}
      <FontDialogs />
      <EquationDialogHost />
      <Toasts />
      <PwaPrompt />
    </div>
  );
}
