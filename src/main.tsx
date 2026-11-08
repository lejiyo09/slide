import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';
// 확장 개체 등록 (3D 모델)
import './extensions/model3d';
import { useEditor } from './core/store/editorStore';
import { useFonts } from './services/fonts/library';

// 자동화 테스트 및 디버깅용 (읽기 전용 용도로 사용 권장)
(window as unknown as { __SLIDELAB__: typeof useEditor }).__SLIDELAB__ = useEditor;
(window as unknown as { __SLIDELAB_FONTS__: typeof useFonts }).__SLIDELAB_FONTS__ = useFonts;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
