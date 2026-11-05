import { useEditor } from '../../core/store/editorStore';
import { allMasterSlides } from '../../core/document/masters';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import * as A from '../../core/commands/actions';

/** 새 슬라이드 레이아웃 선택: 문서의 실제 레이아웃(마스터 디자인 포함) 축소판 */
export function LayoutGallery({ close }: { close: () => void }) {
  const doc = useEditor((s) => s.doc);
  const layouts = allMasterSlides(doc).filter((m) => m.kind === 'layout');
  return (
    <div className="layout-gallery">
      <div className="sg-title">{doc.theme.name}</div>
      <div className="lg-grid">
        {layouts.map((l) => (
          <button key={l.id} type="button" className="lg-item" data-layout={l.id} onClick={() => (A.newSlide(l.id), close())} title={l.name}>
            <ScaledSlide slide={l} doc={doc} width={96} className="lg-thumb" />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
