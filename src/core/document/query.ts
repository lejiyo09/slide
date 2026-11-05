import type { Presentation, Slide, SlideObject } from '../../types/model';

export const findSlide = (doc: Presentation, id: string | null): Slide | undefined =>
  id ? doc.slides.find((s) => s.id === id) : undefined;

export const slideIndex = (doc: Presentation, id: string) => doc.slides.findIndex((s) => s.id === id);

export const findObject = (slide: Slide | undefined, id: string): SlideObject | undefined =>
  slide?.objects.find((o) => o.id === id);

export function getSectionForSlide(doc: Presentation, slideId: string) {
  let current: Presentation['sections'][number] | undefined;
  for (const s of doc.slides) {
    const sec = doc.sections.find((x) => x.startSlideId === s.id);
    if (sec) current = sec;
    if (s.id === slideId) return current;
  }
  return undefined;
}

/** 텍스트를 가질 수 있는 객체인가 */
export const hasText = (o: SlideObject): o is Extract<SlideObject, { text: unknown }> =>
  o.type === 'text' || o.type === 'shape';
