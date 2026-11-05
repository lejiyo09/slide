import { memo, type ReactNode } from 'react';
import type { Presentation, ShapeObject, Slide, TextObject } from '../../types/model';
import { ObjectView, fillToCss } from './ObjectView';

interface SlideViewProps {
  slide: Slide;
  doc: Pick<Presentation, 'size' | 'theme' | 'assets'>;
  editingTextId?: string | null;
  renderEditor?: (obj: TextObject | ShapeObject) => ReactNode;
  interactive?: boolean;
}

/** 슬라이드 원본 크기(px)로 렌더링. 확대/축소는 바깥에서 transform으로 처리 */
export const SlideView = memo(function SlideView({ slide, doc, editingTextId, renderEditor, interactive }: SlideViewProps) {
  const bg = slide.background?.fill ?? doc.theme.background;
  return (
    <div className="sl-slide" style={{ position: 'absolute', left: 0, top: 0, width: doc.size.width, height: doc.size.height, overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'absolute', inset: 0, ...fillToCss(bg, doc.assets) }} />
      {slide.objects.map((o) => (
        <ObjectView key={o.id} obj={o} assets={doc.assets} editingTextId={editingTextId} renderEditor={renderEditor} interactive={interactive} />
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
