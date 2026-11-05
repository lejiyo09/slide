import { useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useEditor } from '../core/store/editorStore';
import { Ribbon } from '../components/ribbon/Ribbon';
import { Backstage } from '../components/ribbon/Backstage';
import { SlidePanel, SorterView } from '../components/sidebar/SlidePanel';
import { EditorCanvas } from '../components/canvas/EditorCanvas';
import { PropertiesPanel } from '../components/properties/PropertiesPanel';
import { NotesPane, StatusBar } from '../components/statusbar/StatusBar';
import { SlideShow } from '../components/slideshow/SlideShow';
import { SlideSizeDialog } from '../components/dialogs/SlideSizeDialog';
import { Toasts } from '../components/common/Toasts';
import { PwaPrompt } from '../components/common/PwaPrompt';
import { useShortcuts } from '../hooks/useShortcuts';
import { bootstrap } from './bootstrap';

export function App() {
  const [ready, setReady] = useState(false);
  const [sizeDialog, setSizeDialog] = useState(false);
  const darkMode = useEditor((s) => s.darkMode);
  const viewMode = useEditor((s) => s.viewMode);
  const showNotes = useEditor((s) => s.showNotes);
  const showProps = useEditor((s) => s.showProperties);
  useShortcuts();

  useEffect(() => {
    void bootstrap().finally(() => setReady(true));
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
    <div className="app">
      <Ribbon onCustomSize={() => setSizeDialog(true)} />
      <div className="workspace">
        {viewMode === 'normal' ? (
          <>
            <SlidePanel />
            <main className="center" onPointerDown={() => useEditor.getState().set({ focusArea: 'canvas' })}>
              <EditorCanvas />
              {showNotes && <NotesPane />}
            </main>
            {showProps ? (
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
      <SlideShow />
      {sizeDialog && <SlideSizeDialog onClose={() => setSizeDialog(false)} />}
      <Toasts />
      <PwaPrompt />
    </div>
  );
}
