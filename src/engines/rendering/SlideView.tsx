import { memo, type ReactNode } from 'react';
import type { Presentation, Slide } from '../../types/model';
import { ObjectView, fillToCss, type EditableObject, type RenderMode } from './ObjectView';

interface SlideViewProps {
  slide: Slide;
  doc: Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts'>;
  editingTextId?: string | null;
  editingCell?: [number, number] | null;
  renderEditor?: (obj: EditableObject, cell?: [number, number]) => ReactNode;
  interactive?: boolean;
  mode?: RenderMode;
  cellSelection?: { id: string; r1: number; c1: number; r2: number; c2: number } | null;
}

/** 슬라이드 원본 크기(px)로 렌더링. 확대/축소는 바깥에서 transform으로 처리 */
export const SlideView = memo(function SlideView({ slide, doc, editingTextId, editingCell, renderEditor, interactive, mode, cellSelection }: SlideViewProps) {
  const layout = doc.layouts?.[slide.layout];
  const bg = slide.background?.fill ?? layout?.background ?? doc.theme.background;
  const showLayout = layout && slide.showMasterShapes !== false;
  return (
    <div className="sl-slide" style={{ position: 'absolute', left: 0, top: 0, width: doc.size.width, height: doc.size.height, overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'absolute', inset: 0, ...fillToCss(bg, doc.assets) }} />
      {showLayout && (
        <div className="sl-layout-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {layout.objects.map((o) => (
            <ObjectView key={o.id} obj={o} assets={doc.assets} theme={doc.theme} mode={mode ?? 'thumb'} />
          ))}
        </div>
      )}
      {slide.objects.map((o) => (
        <ObjectView
          key={o.id}
          obj={o}
          assets={doc.assets}
          theme={doc.theme}
          editingTextId={editingTextId}
          editingCell={editingTextId === o.id ? editingCell : null}
          renderEditor={renderEditor}
          interactive={interactive}
          mode={mode ?? (interactive ? 'edit' : 'thumb')}
          cellSelection={cellSelection && cellSelection.id === o.id ? cellSelection : null}
        />
      ))}
    </div>
  );
});

/** 고정 폭에 맞춰 축소된 슬라이드 (축소판, 슬라이드 쇼 등) */
export function ScaledSlide({ slide, doc, width, className }: { slide: Slide; doc: Presentation; width: number; className?: string }) {
  const scale = width / doc.size.width;
  return (
    <div className={className} style={{ position: 'relative', width, height: doc.size.height * scale, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <SlideView slide={slide} doc={doc} />
      </div>
    </div>
  );
}
