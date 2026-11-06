/** AI 도우미 동작: 제공자 호출 결과를 문서에 반영 (각 반영 = 실행 취소 한 단계) */
import { produce } from 'immer';
import { getActiveSlide, getSelectedObjects, useEditor } from '../store/editorStore';
import * as C from './commands';
import { applyTemplateDraft } from './masterActions';
import { insertImageFiles } from './actions';
import type { Presentation, TextObject } from '../../types/model';
import type { AIProvider, CallOptions, CompareItem, DeckSpec, DesignChoice, DocumentInput, GenerateOptions, OutlineSpec, ScriptItem, Suggestion } from '../../services/ai/types';
import { getImageProvider, getProvider } from '../../services/ai/settings';
import { applyScripts, changeLayout, insertDeck } from '../../services/ai/apply';
import { compareScripts, digestSlides, fixIssue, lintDesign, splitSlideInDraft, type DesignIssue } from '../../services/ai/analyze';
import { TEMPLATES } from '../../themes/templates';
import { COLOR_SCHEMES, FONT_SCHEMES } from '../../themes/schemes';
import { createTextBox, paragraph, plainText } from '../document/factory';
import { docxToText } from '../../services/ai/offline/document';

const st = () => useEditor.getState();

export async function provider(): Promise<AIProvider> {
  return getProvider();
}

/* ── 만들기 ── */

export async function generate(input: { prompt?: string; outline?: OutlineSpec; document?: DocumentInput }, opts: GenerateOptions, mode: 'replace' | 'append', call?: CallOptions): Promise<DeckSpec> {
  const p = await provider();
  const deck = await p.generateDeck(input, opts, call);
  insertGeneratedDeck(deck, mode);
  return deck;
}

export function insertGeneratedDeck(deck: DeckSpec, mode: 'replace' | 'append') {
  const s = st();
  let ids: string[] = [];
  s.commit(mode === 'replace' ? 'AI: 프레젠테이션 만들기' : 'AI: 슬라이드 추가', (d) => {
    ids = insertDeck(d as Presentation, deck, mode, s.activeSlideId);
  });
  if (ids[0]) st().setActiveSlide(ids[0]);
  st().toast(`슬라이드 ${ids.length}장을 만들었습니다. 마음에 들지 않으면 실행 취소(Ctrl+Z)하세요.`, 'success');
}

export async function outline(topic: string, opts: GenerateOptions, call?: CallOptions) {
  return (await provider()).outline(topic, opts, call);
}

/** 목차 ↔ 편집용 텍스트 (# 제목 / ## 구역 / - 요점) */
export function outlineToText(o: OutlineSpec): string {
  return [`# ${o.title}`, ...o.sections.flatMap((s) => [``, `## ${s.heading}`, ...s.points.map((p) => `- ${p}`)])].join('\n');
}
export function textToOutline(text: string): OutlineSpec {
  let title = '';
  const sections: OutlineSpec['sections'] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#\s/.test(line) && !title) title = line.replace(/^#\s*/, '');
    else if (/^#{1,3}\s/.test(line)) sections.push({ heading: line.replace(/^#+\s*/, ''), points: [] });
    else if (sections.length) sections[sections.length - 1].points.push(line.replace(/^[-*•]\s*/, ''));
    else sections.push({ heading: line, points: [] });
  }
  return { title: title || sections[0]?.heading || '발표', sections };
}

/** 파일 → 문서 입력 (txt/md/docx는 텍스트, pdf는 base64) */
export async function readDocumentFile(file: File): Promise<DocumentInput> {
  const name = file.name;
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { name, pdfBase64: btoa(bin) };
  }
  if (/\.docx$/i.test(name)) return { name, text: await docxToText(await file.arrayBuffer()) };
  return { name, text: await file.text() };
}

/* ── 다듬기 ── */

/** 요약할 텍스트: 선택한 개체 → 현재 슬라이드 */
export function textForSummary(): { text: string; source: 'selection' | 'slide' } {
  const sel = getSelectedObjects().filter((o) => o.type === 'text' || o.type === 'shape');
  if (sel.length) return { text: sel.map((o) => plainText((o as TextObject).text)).join('\n'), source: 'selection' };
  const d = digestSlides(st().doc, [getActiveSlide()])[0];
  return { text: [d.title, ...d.body].join('\n'), source: 'slide' };
}

export async function summarize(text: string, length: 'short' | 'medium', call?: CallOptions) {
  return (await provider()).summarize(text, length, call);
}

const lines = (summary: string) => summary.split('\n').map((l) => l.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);

export function applySummary(summary: string, target: 'replaceSelection' | 'newSlide' | 'notes') {
  const s = st();
  const slide = getActiveSlide();
  if (target === 'replaceSelection') {
    const sel = getSelectedObjects().find((o) => o.type === 'text' || o.type === 'shape');
    if (!sel) return s.toast('바꿀 텍스트 개체를 선택하세요.', 'warning');
    s.commit('AI: 요약으로 바꾸기', (d) =>
      C.updateObjects(d, slide.id, [sel.id], (o) => {
        if (o.type !== 'text' && o.type !== 'shape') return;
        const tpl = o.text.paragraphs[0];
        o.text.paragraphs = lines(summary).map((t) => ({ ...tpl, bullet: 'bullet', level: 0, runs: [{ ...(tpl?.runs[0] ?? {}), text: t }] }));
      }),
    );
  } else if (target === 'newSlide') {
    const d0 = digestSlides(s.doc, [slide])[0];
    s.commit('AI: 요약 슬라이드', (d) => void insertDeck(d as Presentation, { title: '', slides: [{ kind: 'bullets', title: `${d0.title || '요약'} — 요약`, bullets: lines(summary) }] }, 'append', slide.id));
  } else {
    s.commit('AI: 요약을 노트에', (d) => {
      const x = d.slides.find((y) => y.id === slide.id);
      if (x) x.notes = [x.notes.trim(), summary].filter(Boolean).join('\n\n');
    });
  }
}

export async function writeScripts(scope: 'current' | 'all', opts: { secondsPerSlide?: number; onlyEmpty: boolean }, call?: CallOptions): Promise<ScriptItem[]> {
  const s = st();
  const slides = scope === 'all' ? s.doc.slides : [getActiveSlide()];
  const items = await (await provider()).writeScript(digestSlides(s.doc, slides), { secondsPerSlide: opts.secondsPerSlide }, call);
  let n = 0;
  st().commit('AI: 발표 대본', (d) => void (n = applyScripts(d as Presentation, items, opts.onlyEmpty)));
  st().toast(n ? `${n}개 슬라이드의 발표자 노트에 대본을 넣었습니다.` : '바꾼 노트가 없습니다 (이미 노트가 있는 슬라이드는 건너뜀).', n ? 'success' : 'info');
  return items;
}

export async function compare(call?: CallOptions): Promise<CompareItem[]> {
  const digests = digestSlides(st().doc);
  const base = compareScripts(digests);
  const p = await provider();
  // 생성형 제공자는 노트가 있는 슬라이드만 서술형 검토
  if (p.generative && digests.some((d) => d.notes.trim())) return p.reviewScript(digests, base, call);
  return base;
}

/* ── 디자인 ── */

export function lint(): DesignIssue[] {
  return lintDesign(st().doc);
}

export function fix(issues: DesignIssue[]) {
  if (!issues.length) return;
  st().commit(issues.length > 1 ? 'AI: 디자인 문제 모두 고치기' : 'AI: 디자인 문제 고치기', (d) => {
    // 슬라이드 나누기는 슬라이드 순서를 바꾸므로 마지막에
    const sorted = [...issues].sort((a, b) => Number(a.kind === 'tooMuchText') - Number(b.kind === 'tooMuchText'));
    for (const i of sorted) fixIssue(d as Presentation, i);
  });
}

export async function reviewDesign(call?: CallOptions): Promise<Suggestion[]> {
  const p = await provider();
  return p.generative ? p.reviewDesign(digestSlides(st().doc), call) : [];
}

export async function recommendLayout(scope: 'current' | 'all', call?: CallOptions): Promise<Suggestion[]> {
  const s = st();
  return (await provider()).recommendLayout(digestSlides(s.doc, scope === 'all' ? s.doc.slides : [getActiveSlide()]), call);
}

export function applySuggestion(sg: Suggestion) {
  if (!sg.action || !sg.slideId) return;
  const id = sg.slideId;
  const a = sg.action;
  if (a.type === 'split') st().commit('AI: 슬라이드 나누기', (d) => void splitSlideInDraft(d as Presentation, id));
  else if (a.type === 'layout') {
    const kind = { title: 'title', titleContent: 'bullets', twoContent: 'twoColumn', titleOnly: 'titleOnly', sectionHeader: 'section' } as const;
    let ok = false;
    st().commit('AI: 레이아웃 바꾸기', (d) => void (ok = changeLayout(d as Presentation, id, kind[a.layout])));
    if (!ok) st().toast('이 프레젠테이션에 맞는 레이아웃이 없습니다.', 'warning');
  } else if (a.type === 'template') applyDesign({ templateId: a.templateId, colorScheme: a.colorScheme, fontScheme: a.fontScheme, reason: '' });
}

export async function chooseDesign(call?: CallOptions): Promise<DesignChoice[]> {
  const s = st();
  return (await provider()).chooseDesign(digestSlides(s.doc), s.doc.title, call);
}

/** 디자인 후보를 적용한 문서 (미리 보기용, 저장 안 함) */
export function designPreview(doc: Presentation, c: DesignChoice): Presentation {
  return produce(doc, (d) => designRecipe(d as Presentation, c));
}

function designRecipe(d: Presentation, c: DesignChoice) {
  const t = TEMPLATES.find((x) => x.id === c.templateId);
  if (t) applyTemplateDraft(d, t);
  const cs = COLOR_SCHEMES.find((x) => x.id === c.colorScheme);
  if (cs) d.theme.colors = { ...cs.colors };
  const fs = FONT_SCHEMES.find((x) => x.id === c.fontScheme);
  if (fs) d.theme.fonts = { heading: fs.heading, body: fs.body };
}

export function applyDesign(c: DesignChoice) {
  st().commit('AI: 디자인 아이디어', (d) => designRecipe(d as Presentation, c));
}

/* ── 이미지 ── */

export async function generateImage(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', call?: CallOptions): Promise<Blob> {
  return (await getImageProvider()).generate(prompt, size, call);
}

export async function insertGeneratedImage(blob: Blob, prompt: string) {
  const name = `${prompt.slice(0, 30).replace(/[\\/:*?"<>|]/g, '') || 'AI 이미지'}.png`;
  await insertImageFiles([new File([blob], name, { type: blob.type || 'image/png' })]);
}

/** 텍스트를 슬라이드에 새 상자로 (복사 대신) */
export function insertTextBox(text: string) {
  const s = st();
  const slide = getActiveSlide();
  const box = createTextBox({ x: s.doc.size.width * 0.1, y: s.doc.size.height * 0.3, width: s.doc.size.width * 0.8, text: '' });
  box.text.paragraphs = lines(text).map((t) => paragraph(t, { fontSize: 20 }, { bullet: 'bullet' }));
  s.commit('AI: 텍스트 삽입', (d) => C.addObjects(d, slide.id, [box]));
}
