/** 테마 사용자 지정: 색 10개 + 제목/본문 글꼴 → 적용 또는 사용자 지정 테마로 저장 */
import { useState } from 'react';
import { Dialog } from './Dialog';
import { useEditor } from '../../core/store/editorStore';
import { THEME_COLOR_KEYS, THEME_COLOR_NAMES } from '../../utils/themeColor';
import { FontPicker } from '../common/FontPicker';
import type { Theme } from '../../types/model';
import { applyFullTheme } from '../../core/commands/masterActions';
import { saveCustomTheme } from '../../services/storage/designLibrary';
import { newId } from '../../utils/id';

export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const current = useEditor((s) => s.doc.theme);
  const [t, setT] = useState<Theme>(() => structuredClone(current));
  const [name, setName] = useState(current.id.startsWith('custom-') ? current.name : `${current.name} 사용자 지정`);
  const apply = () => applyFullTheme({ ...t, name });
  return (
    <Dialog title="테마 사용자 지정" onClose={onClose} onOk={() => (apply(), onClose())} okLabel="적용">
      <div className="theme-dialog">
        <div className="td-preview" style={{ background: t.colors.light1, color: t.colors.dark1 }}>
          <div style={{ fontFamily: t.fonts.heading, fontSize: 22, fontWeight: 700 }}>제목 Aa</div>
          <div style={{ fontFamily: t.fonts.body, fontSize: 13, color: t.colors.dark2 }}>본문 텍스트 미리 보기</div>
          <div className="td-bars">
            {(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => (
              <span key={k} style={{ background: t.colors[k] }} />
            ))}
          </div>
        </div>
        <div className="td-colors">
          {THEME_COLOR_KEYS.map((k) => (
            <label key={k} className="td-color">
              <input type="color" value={t.colors[k]} onChange={(e) => setT({ ...t, colors: { ...t.colors, [k]: e.target.value.toUpperCase() } })} />
              <span>{THEME_COLOR_NAMES[k]}</span>
            </label>
          ))}
        </div>
        <div className="td-fonts">
          {(['heading', 'body'] as const).map((k) => (
            <label key={k} className="field">
              <span>{k === 'heading' ? '제목 글꼴' : '본문 글꼴'}</span>
              <FontPicker className="pp-font" value={t.fonts[k]} lock={false} ariaLabel={k === 'heading' ? '제목 글꼴' : '본문 글꼴'} onChange={(f) => setT({ ...t, fonts: { ...t.fonts, [k]: f } })} />
            </label>
          ))}
        </div>
        <label className="field">
          <span>테마 이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const saved: Theme = { ...t, id: t.id.startsWith('custom-') ? t.id : `custom-${newId()}`, name };
            await saveCustomTheme(saved);
            applyFullTheme(saved);
            useEditor.getState().toast(`'${name}' 테마를 저장했습니다. 디자인 탭의 테마 목록에서 다시 쓸 수 있습니다.`, 'success');
            onClose();
          }}
        >
          사용자 지정 테마로 저장 후 적용
        </button>
      </div>
    </Dialog>
  );
}
