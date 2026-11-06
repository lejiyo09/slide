/**
 * 인쇄 (PowerPoint: 파일 › 인쇄): 전체 페이지 슬라이드 / 슬라이드 노트 / 유인물(1·2·3·4·6·9) / 개요.
 * 같은 페이지 구성으로 미리 보기와 실제 인쇄를 그린다. 인쇄는 브라우저 인쇄(“PDF로 저장” 포함)로 하므로
 * 글자가 벡터로 남고(선택·검색 가능) 문서에 등록한 글꼴이 그대로 쓰인다.
 */
import { createPortal } from 'react-dom';
import type { Presentation, Slide, SlideObject, TextBody } from '../../types/model';
import { SlideView } from '../../engines/rendering/SlideView';

export type PrintLayout = 'slides' | 'notes' | 'outline' | 'handout1' | 'handout2' | 'handout3' | 'handout4' | 'handout6' | 'handout9';

export interface PrintSettings {
  layout: PrintLayout;
  /** 'all' | 'current' | '1-3,5' */
  range: string;
  includeHidden: boolean;
  color: 'color' | 'grayscale' | 'bw';
  frame: boolean;
}

export const LAYOUT_NAMES: Record<PrintLayout, string> = {
  slides: '전체 페이지 슬라이드',
  notes: '슬라이드 노트',
  outline: '개요',
  handout1: '유인물: 1슬라이드',
  handout2: '유인물: 2슬라이드',
  handout3: '유인물: 3슬라이드',
  handout4: '유인물: 4슬라이드',
  handout6: '유인물: 6슬라이드',
  handout9: '유인물: 9슬라이드',
};

/** A4 세로 (96dpi px) */
export const A4 = { width: 794, height: 1123 };

/** '1-3,5' → 슬라이드 번호(1부터) 집합. 잘못된 범위면 null */
export function parseRange(range: string, count: number): number[] | null {
  const out = new Set<number>();
  for (const part of range.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > count) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

export function slidesToPrint(doc: Presentation, s: PrintSettings, currentId: string): Slide[] {
  let list: Slide[];
  if (s.range === 'current') list = doc.slides.filter((x) => x.id === currentId);
  else if (s.range === 'all' || !s.range.trim()) list = doc.slides;
  else list = (parseRange(s.range, doc.slides.length) ?? []).map((n) => doc.slides[n - 1]);
  return list.filter((x) => s.includeHidden || !x.hidden || s.range === 'current');
}

const PER_PAGE: Partial<Record<PrintLayout, number>> = { handout1: 1, handout2: 2, handout3: 3, handout4: 4, handout6: 6, handout9: 9 };

export function pageSize(doc: Presentation, layout: PrintLayout) {
  return layout === 'slides' ? { width: doc.size.width, height: doc.size.height } : A4;
}

export function pageCount(slides: number, layout: PrintLayout): number {
  if (layout === 'slides' || layout === 'notes') return slides;
  if (layout === 'outline') return Math.max(1, Math.ceil(slides / 6));
  return Math.ceil(slides / PER_PAGE[layout]!);
}

function bodies(o: SlideObject): TextBody[] {
  if (o.type === 'text' || o.type === 'shape') return [o.text];
  if (o.type === 'group') return o.children.flatMap(bodies);
  return [];
}
const plain = (b: TextBody) => b.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).filter((t) => t.trim());

/** 개요: 제목 + 본문 문단 */
export function outlineOf(slide: Slide): { title: string; lines: string[] } {
  const title = slide.objects.find((o) => o.type === 'text' && (o.ph?.type === 'title' || o.ph?.type === 'ctrTitle'));
  const rest = slide.objects.filter((o) => o !== title);
  return { title: title ? plain((title as Extract<SlideObject, { type: 'text' }>).text).join(' ') : '', lines: rest.flatMap(bodies).flatMap(plain) };
}

/** 슬라이드 한 장을 주어진 폭에 맞춰 */
function Fit({ slide, doc, width, frame }: { slide: Slide; doc: Presentation; width: number; frame: boolean }) {
  const scale = width / doc.size.width;
  return (
    <div className="pv-slide" style={{ width, height: doc.size.height * scale, outline: frame ? '1px solid #555' : undefined }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }}>
        <SlideView slide={slide} doc={doc} mode="thumb" />
      </div>
    </div>
  );
}

const filterOf = (c: PrintSettings['color']) => (c === 'grayscale' ? 'grayscale(1)' : c === 'bw' ? 'grayscale(1) contrast(4)' : undefined);

/** 페이지 목록 (각 페이지는 page px 크기) */
export function PrintPages({ doc, slides, settings, pageOffset = 0 }: { doc: Presentation; slides: Slide[]; settings: PrintSettings; pageOffset?: number }) {
  const { layout, frame } = settings;
  const size = pageSize(doc, layout);
  const pages: React.ReactNode[] = [];
  const style = { width: size.width, height: size.height, filter: filterOf(settings.color) };
  const num = (s: Slide) => doc.slides.indexOf(s) + 1;
  if (layout === 'slides') {
    for (const s of slides)
      pages.push(
        <div className="print-page" style={style} key={s.id} data-print-page="">
          <Fit slide={s} doc={doc} width={size.width} frame={frame} />
        </div>,
      );
  } else if (layout === 'notes') {
    for (const s of slides)
      pages.push(
        <div className="print-page pp-notes" style={style} key={s.id} data-print-page="">
          <Fit slide={s} doc={doc} width={size.width - 192} frame />
          <div className="pp-notes-text">{s.notes || ''}</div>
          <div className="pp-num">{num(s)}</div>
        </div>,
      );
  } else if (layout === 'outline') {
    for (let i = 0; i < slides.length; i += 6)
      pages.push(
        <div className="print-page pp-outline" style={style} key={`o${i}`} data-print-page="">
          {slides.slice(i, i + 6).map((s) => {
            const o = outlineOf(s);
            return (
              <section key={s.id}>
                <h3>
                  {num(s)}. {o.title || '(제목 없음)'}
                </h3>
                <ul>{o.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
              </section>
            );
          })}
        </div>,
      );
  } else {
    const n = PER_PAGE[layout]!;
    const cols = n <= 3 ? 1 : n === 9 ? 3 : 2;
    const inner = size.width - 144;
    const slideW = n === 3 ? inner * 0.45 : n <= 2 ? inner * (n === 1 ? 1 : 0.62) : (inner - (cols - 1) * 24) / cols;
    for (let i = 0; i < slides.length; i += n)
      pages.push(
        <div className={`print-page pp-handout pp-h${n}`} style={style} key={`h${i}`} data-print-page="">
          <div className="pp-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${n === 3 ? '1fr' : `${slideW}px`})` }}>
            {slides.slice(i, i + n).map((s) => (
              <div className="pp-cell" key={s.id}>
                <Fit slide={s} doc={doc} width={slideW} frame />
                {n === 3 && (
                  <div className="pp-lines">
                    {Array.from({ length: 6 }, (_, k) => (
                      <span key={k} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pp-num">{pageOffset + Math.floor(i / n) + 1}</div>
        </div>,
      );
  }
  return <>{pages}</>;
}

/** 실제 인쇄: body 바로 아래에 그리고 @page 크기 지정 */
export function PrintPortal({ doc, slides, settings }: { doc: Presentation; slides: Slide[]; settings: PrintSettings }) {
  const size = pageSize(doc, settings.layout);
  return createPortal(
    <div id="sl-print-root">
      <style>{`@page { size: ${size.width}px ${size.height}px; margin: 0; }`}</style>
      <PrintPages doc={doc} slides={slides} settings={settings} />
    </div>,
    document.body,
  );
}
