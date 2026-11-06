/**
 * AI 결과를 문서에 반영 (immer draft 대상 순수 함수 — 스토어의 commit 한 번 = 실행 취소 한 번).
 * 생성한 슬라이드는 문서의 레이아웃(개체 틀)을 써서 만들므로 테마·마스터 디자인을 그대로 따른다.
 */
import type { MasterSlide, Paragraph, Presentation, Slide, TextObject } from '../../types/model';
import type { DeckSpec, SlideKind, SlideSpec } from './types';
import { createSlide, createTextBox, paragraph } from '../../core/document/factory';
import { slideFromLayout } from '../../core/document/masters';
import { deepClone } from '../../utils/clone';

const BUILTIN: Record<SlideKind, string> = { title: 'title', section: 'sectionHeader', bullets: 'titleContent', twoColumn: 'twoContent', titleOnly: 'titleOnly' };

/** 문서의 레이아웃 중 이 종류에 맞는 것 (기본 레이아웃 ID → 개체 틀 구성으로 추정) */
export function findLayout(doc: Presentation, kind: SlideKind): MasterSlide | undefined {
  const layouts = doc.layouts ?? {};
  const byId = layouts[BUILTIN[kind]];
  if (byId) return byId;
  const all = (doc.layoutOrder ?? Object.keys(layouts)).map((id) => layouts[id]).filter(Boolean);
  const phs = (l: MasterSlide) => l.objects.filter((o): o is TextObject => o.type === 'text' && !!o.ph).map((o) => o.ph!.type);
  const count = (l: MasterSlide, t: string) => phs(l).filter((x) => x === t).length;
  const match: Record<SlideKind, (l: MasterSlide) => boolean> = {
    title: (l) => count(l, 'ctrTitle') > 0,
    section: (l) => /구역|section/i.test(l.name) && count(l, 'title') > 0,
    bullets: (l) => count(l, 'title') === 1 && count(l, 'body') === 1,
    twoColumn: (l) => count(l, 'title') === 1 && count(l, 'body') === 2,
    titleOnly: (l) => count(l, 'title') === 1 && count(l, 'body') === 0 && !/구역|section/i.test(l.name),
  };
  return all.find(match[kind]) ?? (kind === 'section' || kind === 'titleOnly' ? all.find(match.bullets) : undefined);
}

function setLines(o: TextObject, lines: string[]) {
  const tpl: Paragraph = o.text.paragraphs[0] ?? paragraph('');
  const run = tpl.runs[0] ?? { text: '' };
  o.text.paragraphs = (lines.length ? lines : ['']).map((t) => ({ ...deepClone(tpl), level: 0, runs: [{ ...deepClone(run), text: t }] }));
  delete o.placeholder;
}

/** 슬라이드 하나 만들기 */
export function buildSlide(doc: Presentation, spec: SlideSpec): Slide {
  const layout = findLayout(doc, spec.kind);
  const slide = layout ? slideFromLayout(deepClone(layout)) : createSlide(BUILTIN[spec.kind] as 'title', doc.size);
  const texts = slide.objects.filter((o): o is TextObject => o.type === 'text');
  const title = texts.find((o) => o.ph?.type === 'title' || o.ph?.type === 'ctrTitle');
  const sub = texts.find((o) => o.ph?.type === 'subTitle');
  const bodies = texts.filter((o) => o.ph?.type === 'body').sort((a, b) => (a.ph?.idx ?? 0) - (b.ph?.idx ?? 0) || a.x - b.x);
  if (title) setLines(title, [spec.title]);
  else if (spec.title) slide.objects.push(createTextBox({ x: doc.size.width * 0.07, y: doc.size.height * 0.06, width: doc.size.width * 0.86, height: doc.size.height * 0.16, text: spec.title }));
  const used = new Set<TextObject>();
  const fill = (o: TextObject | undefined, lines: string[] | undefined) => {
    if (!o || !lines?.length) return;
    setLines(o, lines);
    used.add(o);
  };
  switch (spec.kind) {
    case 'title':
      fill(sub ?? bodies[0], spec.subtitle ? [spec.subtitle] : undefined);
      break;
    case 'section':
      fill(bodies[0] ?? sub, spec.subtitle ? [spec.subtitle] : undefined);
      break;
    case 'bullets':
      fill(bodies[0], spec.bullets);
      break;
    case 'twoColumn':
      if (bodies.length >= 2) {
        fill(bodies[0], spec.left);
        fill(bodies[1], spec.right);
      } else fill(bodies[0], [...(spec.left ?? []), ...(spec.right ?? [])]);
      break;
    case 'titleOnly':
      break;
  }
  // 레이아웃에 본문 개체 틀이 없는데 내용이 있으면 텍스트 상자로
  const lines = spec.kind === 'bullets' ? spec.bullets : spec.kind === 'twoColumn' ? [...(spec.left ?? []), ...(spec.right ?? [])] : undefined;
  if (lines?.length && !bodies.length) {
    const box = createTextBox({ x: doc.size.width * 0.07, y: doc.size.height * 0.26, width: doc.size.width * 0.86, height: doc.size.height * 0.62, text: '' });
    box.text.paragraphs = lines.map((t) => paragraph(t, { fontSize: 24, fontFamily: '@body' }, { bullet: 'bullet' }));
    slide.objects.push(box);
  }
  // 쓰지 않은 빈 본문 개체 틀은 제거 (표지의 부제목은 남김)
  slide.objects = slide.objects.filter((o) => !(o.type === 'text' && o.ph?.type === 'body' && !used.has(o as TextObject)));
  slide.notes = spec.notes ?? '';
  return slide;
}

/**
 * 생성한 프레젠테이션을 문서에 넣음.
 * replace: 기존 슬라이드를 모두 바꾸고 제목도 바꿈 / append: afterId 뒤(없으면 끝)에 추가
 */
export function insertDeck(d: Presentation, deck: DeckSpec, mode: 'replace' | 'append', afterId?: string): string[] {
  const slides = deck.slides.map((s) => buildSlide(d, s));
  if (mode === 'replace') {
    d.slides = slides;
    d.sections = [];
    if (deck.title) d.title = deck.title;
  } else {
    const at = afterId ? d.slides.findIndex((s) => s.id === afterId) + 1 : d.slides.length;
    d.slides.splice(at > 0 ? at : d.slides.length, 0, ...slides);
  }
  return slides.map((s) => s.id);
}

/** 대본을 발표자 노트로 (onlyEmpty: 노트가 비어 있는 슬라이드만) */
export function applyScripts(d: Presentation, items: { slideId: string; script: string }[], onlyEmpty: boolean): number {
  let n = 0;
  for (const it of items) {
    const s = d.slides.find((x) => x.id === it.slideId);
    if (!s || !it.script.trim() || (onlyEmpty && s.notes.trim())) continue;
    s.notes = it.script.trim();
    n++;
  }
  return n;
}

/** 슬라이드 레이아웃 바꾸기: 제목/본문 텍스트를 새 레이아웃의 개체 틀로 옮김 */
export function changeLayout(d: Presentation, slideId: string, layoutKind: SlideKind) {
  const i = d.slides.findIndex((s) => s.id === slideId);
  const s = d.slides[i];
  const layout = findLayout(d, layoutKind);
  if (!s || !layout) return false;
  const texts = s.objects.filter((o): o is TextObject => o.type === 'text');
  const title = texts.find((o) => o.ph?.type === 'title' || o.ph?.type === 'ctrTitle');
  const bodies = texts.filter((o) => o.ph?.type === 'body' || o.ph?.type === 'subTitle');
  const lines = bodies.flatMap((b) => b.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).filter((x) => x.trim()));
  const titleText = title ? title.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ') : '';
  let spec: SlideSpec;
  if (layoutKind === 'twoColumn') {
    const half = Math.ceil(lines.length / 2);
    spec = { kind: 'twoColumn', title: titleText, left: lines.slice(0, half), right: lines.slice(half) };
  } else if (layoutKind === 'section' || layoutKind === 'title') spec = { kind: layoutKind, title: titleText, subtitle: lines.join(' ') || undefined };
  else spec = { kind: layoutKind, title: titleText, bullets: lines };
  const next = buildSlide(d, spec);
  // 개체 틀이 아닌 개체(그림, 도형 등)와 노트·전환은 유지
  const others = s.objects.filter((o) => !(o.type === 'text' && o.ph));
  next.id = s.id;
  next.objects = [...next.objects, ...others];
  next.notes = s.notes;
  if (s.transition) next.transition = s.transition;
  if (s.background) next.background = s.background;
  // 개체 틀 애니메이션은 대상이 바뀌므로 다른 개체 것만 유지
  const keep = new Set(others.map((o) => o.id));
  const anims = s.animations?.filter((a) => keep.has(a.targetId));
  if (anims?.length) next.animations = anims;
  d.slides[i] = next;
  return true;
}
