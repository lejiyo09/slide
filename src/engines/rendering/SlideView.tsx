import { memo, type ReactNode } from 'react';
import type { Fill, MasterSlide, Presentation, Slide, SlideObject } from '../../types/model';
import { ObjectView, fillToCss, type EditableObject, type RenderMode } from './ObjectView';
import type { Frame } from '../animation/effects';

interface SlideViewProps {
  slide: Slide;
  doc: Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>;
  editingTextId?: string | null;
  editingCell?: [number, number] | null;
  renderEditor?: (obj: EditableObject, cell?: [number, number]) => ReactNode;
  interactive?: boolean;
  mode?: RenderMode;
  cellSelection?: { id: string; r1: number; c1: number; r2: number; c2: number } | null;
  /** 애니메이션 프레임 (개체 ID → 상태) */
  frames?: Map<string, Frame>;
  /** 편집 화면: 슬라이드 바깥(작업 영역)에 놓은 개체도 그림 (배경은 슬라이드 안에만). 쇼·축소판·내보내기는 잘라서 그림 */
  showOffSlide?: boolean;
}

/** 슬라이드 원본 크기(px)로 렌더링. 확대/축소는 바깥에서 transform으로 처리 */
export const SlideView = memo(function SlideView({ slide, doc, editingTextId, editingCell, renderEditor, interactive, mode, cellSelection, frames, showOffSlide }: SlideViewProps) {
  const { bg, layers } = designLayers(slide, doc);
  return (
    <div className="sl-slide" style={{ position: 'absolute', left: 0, top: 0, width: doc.size.width, height: doc.size.height, overflow: showOffSlide ? 'visible' : 'hidden', background: showOffSlide ? undefined : '#fff' }}>
      <div style={{ position: 'absolute', inset: 0, ...(showOffSlide ? { background: '#fff' } : {}) }} />
      <div style={{ position: 'absolute', inset: 0, ...fillToCss(bg, doc.assets, doc.theme) }} />
      {layers.length > 0 && (
        <div className="sl-layout-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {layers.map((o) => (
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
          frame={frames?.get(o.id)}
          tagId={mode === 'show'}
        />
      ))}
    </div>
  );
});

/** 고정 폭에 맞춰 축소된 슬라이드 (축소판, 슬라이드 쇼 등) */
export function ScaledSlide({ slide, doc, width, className }: { slide: Slide; doc: Pick<Presentation, 'size' | 'theme' | 'assets' | 'layouts' | 'master'>; width: number; className?: string }) {
  const scale = width / doc.size.width;
  return (
    <div className={className} style={{ position: 'relative', width, height: doc.size.height * scale, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <SlideView slide={slide} doc={doc} />
      </div>
    </div>
  );
}

const isDesign = (o: SlideObject) => !(o.type === 'text' && o.ph);

/**
 * 슬라이드(또는 레이아웃) 뒤에 그릴 배경과 디자인 개체.
 * 슬라이드: 마스터 디자인 → 레이아웃 디자인 / 레이아웃: 마스터 디자인 / 마스터: 없음
 */
export function designLayers(slide: Slide, doc: Pick<Presentation, 'theme' | 'layouts' | 'master'>): { bg: Fill; layers: SlideObject[] } {
  const kind = 'kind' in slide ? (slide as MasterSlide).kind : 'slide';
  const layout = kind === 'slide' ? doc.layouts?.[slide.layout] : kind === 'layout' ? slide : undefined;
  const master = doc.master;
  const bg = slide.background?.fill ?? (kind === 'slide' ? layout?.background?.fill : undefined) ?? (kind !== 'master' ? master?.background?.fill : undefined) ?? doc.theme.background;
  const layers: SlideObject[] = [];
  const showMaster = kind !== 'master' && slide.showMasterShapes !== false && (kind === 'layout' || layout?.showMasterShapes !== false);
  if (showMaster && master) layers.push(...master.objects.filter(isDesign));
  if (kind === 'slide' && layout && slide.showMasterShapes !== false) layers.push(...layout.objects.filter(isDesign));
  return { bg, layers };
}
