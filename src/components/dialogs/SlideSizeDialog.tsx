import { useState } from 'react';
import { useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import { Dialog } from './Dialog';

/** 사용자 지정 슬라이드 크기 (cm) */
export function SlideSizeDialog({ onClose }: { onClose: () => void }) {
  const size = useEditor((s) => s.doc.size);
  const [w, setW] = useState(((size.width / 96) * 2.54).toFixed(2));
  const [h, setH] = useState(((size.height / 96) * 2.54).toFixed(2));
  const [scale, setScale] = useState(true);
  const apply = () => {
    const wn = parseFloat(w), hn = parseFloat(h);
    if (!(wn >= 2.54 && wn <= 142.24 && hn >= 2.54 && hn <= 142.24)) {
      useEditor.getState().toast('너비와 높이는 2.54cm ~ 142.24cm 사이여야 합니다 (PowerPoint 제한).', 'warning');
      return;
    }
    const width = Math.round((wn / 2.54) * 96 * 100) / 100;
    const height = Math.round((hn / 2.54) * 96 * 100) / 100;
    useEditor.getState().commit('슬라이드 크기', (d) => C.setSlideSize(d, { width, height, preset: 'custom' }, scale));
    onClose();
  };
  return (
    <Dialog title="슬라이드 크기" onClose={onClose} onOk={apply}>
      <label className="field">
        <span>너비 (cm)</span>
        <input value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" autoFocus />
      </label>
      <label className="field">
        <span>높이 (cm)</span>
        <input value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" />
      </label>
      <div className="preset-row">
        {[
          ['와이드스크린 16:9', 33.867, 19.05],
          ['표준 4:3', 25.4, 19.05],
          ['A4', 27.517, 19.05],
          ['16:10', 25.4, 15.875],
        ].map(([label, pw, ph]) => (
          <button key={label as string} type="button" className="chip" onClick={() => (setW(String(pw)), setH(String(ph)))}>
            {label}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> 콘텐츠 크기 맞춤 (비율 유지하며 축소/확대)
      </label>
    </Dialog>
  );
}
