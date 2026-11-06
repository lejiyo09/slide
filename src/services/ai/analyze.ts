/**
 * 항상 로컬에서 계산하는 분석 (제공자와 무관):
 * - 슬라이드 요약(SlideDigest): AI에 보낼 최소 텍스트
 * - 디자인 점검: 글자 크기, 글 양, 명암 대비, 슬라이드 밖 개체, 겹침, 글꼴 수, 빈 개체 틀, 어긋난 정렬 — 고칠 수 있는 항목은 고치기 동작 포함
 * - 대본-슬라이드 비교: 핵심어 포함률, 빠진 핵심어, 예상 시간
 */
import type { Presentation, Slide, SlideObject, TextBody, TextObject, ShapeObject, Fill } from '../../types/model';
import type { CompareItem, SlideDigest } from './types';
import { plainText } from '../../core/document/factory';
import { designLayers } from '../../engines/rendering/SlideView';
import { resolveColor, resolveFont } from '../../utils/themeColor';
import { covers, keywords, speakingSeconds, tokens } from './offline/text';
import { newId } from '../../utils/id';

const textOf = (o: SlideObject): TextBody | null => (o.type === 'text' || o.type === 'shape' ? o.text : null);
const isTitle = (o: SlideObject) => o.type === 'text' && (o.ph?.type === 'title' || o.ph?.type === 'ctrTitle');

function flat(objs: SlideObject[]): SlideObject[] {
  return objs.flatMap((o) => (o.type === 'group' ? flat(o.children) : [o]));
}

export function digestSlides(doc: Presentation, slides: Slide[] = doc.slides): SlideDigest[] {
  return slides.map((s) => {
    const objs = flat(s.objects);
    const titleObj = objs.find(isTitle) ?? objs.find((o) => o.type === 'text' && plainText(o.text).trim());
    const title = titleObj && textOf(titleObj) ? plainText(textOf(titleObj)!).replace(/\n/g, ' ').trim() : '';
    const body: string[] = [];
    for (const o of objs) {
      if (o === titleObj) continue;
      const t = textOf(o);
      if (t) for (const p of t.paragraphs) {
        const line = p.runs.map((r) => r.text).join('').trim();
        if (line) body.push(line);
      }
      if (o.type === 'table') for (const row of o.rows) body.push(row.cells.map((c) => plainText(c.text)).join(' | '));
    }
    return {
      id: s.id,
      number: doc.slides.indexOf(s) + 1,
      layout: s.layout,
      title,
      body,
      notes: s.notes,
      hasImage: objs.some((o) => o.type === 'image'),
      hasChart: objs.some((o) => o.type === 'chart'),
      hasTable: objs.some((o) => o.type === 'table'),
    };
  });
}

/* ───────────── 디자인 점검 ───────────── */

export type IssueKind = 'smallText' | 'tooMuchText' | 'contrast' | 'offSlide' | 'overlap' | 'fonts' | 'emptyPlaceholder' | 'misaligned' | 'noTitle';

export interface DesignIssue {
  id: string;
  kind: IssueKind;
  severity: 'error' | 'warning' | 'info';
  slideId: string;
  objectIds: string[];
  message: string;
  /** 자동 고치기 가능 */
  fixable: boolean;
}

function hexLum(hex: string): number {
  const v = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG 명암비 */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [hexLum(a), hexLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function solidOf(f: Fill | undefined, theme: Presentation['theme']): string | null {
  if (!f) return null;
  if (f.type === 'solid' && (f.opacity ?? 1) > 0.6) return resolveColor(f.color, theme);
  if (f.type === 'gradient' && f.stops.length) return resolveColor(f.stops[Math.floor(f.stops.length / 2)].color, theme);
  if (f.type === 'pattern') return resolveColor(f.bg, theme);
  return null;
}

const bbox = (o: SlideObject) => ({ x1: o.x, y1: o.y, x2: o.x + o.width, y2: o.y + o.height });
const MIN_PT = 12;

export function lintDesign(doc: Presentation, slides: Slide[] = doc.slides): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const W = doc.size.width;
  const H = doc.size.height;
  const fontsUsed = new Map<string, string[]>();
  let n = 0;
  const add = (i: Omit<DesignIssue, 'id'>) => issues.push({ ...i, id: `i${++n}` });
  for (const s of slides) {
    const num = doc.slides.indexOf(s) + 1;
    const { bg } = designLayers(s, doc);
    const slideBg = solidOf(bg, doc.theme) ?? (bg.type === 'image' ? null : '#FFFFFF');
    const texts = s.objects.filter((o): o is TextObject | ShapeObject => (o.type === 'text' || o.type === 'shape') && !!plainText(o.text).trim());
    // 작은 글자
    const small = texts.filter((o) => o.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim() && (r.fontSize ?? 18) < MIN_PT)));
    if (small.length) add({ kind: 'smallText', severity: 'warning', slideId: s.id, objectIds: small.map((o) => o.id), message: `슬라이드 ${num}: ${MIN_PT}pt보다 작은 글자가 있어 뒤쪽 청중이 읽기 어렵습니다.`, fixable: true });
    // 글 양
    const paras = texts.filter((o) => !isTitle(o)).flatMap((o) => o.text.paragraphs.filter((p) => p.runs.some((r) => r.text.trim())));
    const chars = paras.reduce((a, p) => a + p.runs.map((r) => r.text).join('').length, 0);
    if (paras.length > 7 || chars > 450) add({ kind: 'tooMuchText', severity: 'warning', slideId: s.id, objectIds: [], message: `슬라이드 ${num}: 글이 많습니다 (${paras.length}개 문단, ${chars}자). 핵심만 남기거나 슬라이드를 나누세요.`, fixable: true });
    // 명암 대비
    for (const o of texts) {
      const back = solidOf(o.fill, doc.theme) ?? slideBg;
      if (!back) continue;
      const bad = o.text.paragraphs.some((p) =>
        p.runs.some((r) => {
          if (!r.text.trim()) return false;
          const c = resolveColor(r.color ?? '@dark1', doc.theme);
          const need = (r.fontSize ?? 18) >= 24 || (r.bold && (r.fontSize ?? 18) >= 18.5) ? 3 : 4.5;
          return contrastRatio(c, back) < need;
        }),
      );
      if (bad) add({ kind: 'contrast', severity: 'error', slideId: s.id, objectIds: [o.id], message: `슬라이드 ${num}: '${o.name}'의 글자색과 배경의 명암 대비가 낮습니다 (WCAG 기준 미달).`, fixable: true });
    }
    // 슬라이드 밖
    for (const o of s.objects) {
      const b = bbox(o);
      const outside = Math.max(0, -b.x1) + Math.max(0, b.x2 - W) + Math.max(0, -b.y1) + Math.max(0, b.y2 - H);
      if (outside > 4 && b.x2 > 0 && b.y2 > 0 && b.x1 < W && b.y1 < H) add({ kind: 'offSlide', severity: 'warning', slideId: s.id, objectIds: [o.id], message: `슬라이드 ${num}: '${o.name}'이(가) 슬라이드 밖으로 나가 일부가 보이지 않습니다.`, fixable: true });
    }
    // 텍스트 겹침
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = bbox(texts[i]);
        const b = bbox(texts[j]);
        const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
        const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
        const minArea = Math.min(texts[i].width * texts[i].height, texts[j].width * texts[j].height);
        if (minArea > 0 && (ix * iy) / minArea > 0.25 && texts[i].type === 'text' && texts[j].type === 'text')
          add({ kind: 'overlap', severity: 'warning', slideId: s.id, objectIds: [texts[i].id, texts[j].id], message: `슬라이드 ${num}: '${texts[i].name}'과(와) '${texts[j].name}'의 글이 겹칩니다.`, fixable: false });
      }
    // 빈 개체 틀
    const empty = s.objects.filter((o) => o.type === 'text' && o.ph && !['dt', 'ftr', 'sldNum'].includes(o.ph.type) && !plainText(o.text).trim());
    if (empty.length) add({ kind: 'emptyPlaceholder', severity: 'info', slideId: s.id, objectIds: empty.map((o) => o.id), message: `슬라이드 ${num}: 비어 있는 개체 틀 ${empty.length}개 (쇼에는 보이지 않지만 정리하면 깔끔합니다).`, fixable: true });
    // 왼쪽 맞춤이 1~6px 어긋남
    const lefts = texts.filter((o) => o.type === 'text').map((o) => o);
    for (let i = 0; i < lefts.length; i++)
      for (let j = i + 1; j < lefts.length; j++) {
        const d = Math.abs(lefts[i].x - lefts[j].x);
        if (d > 0.5 && d <= 6) {
          add({ kind: 'misaligned', severity: 'info', slideId: s.id, objectIds: [lefts[i].id, lefts[j].id], message: `슬라이드 ${num}: '${lefts[i].name}'과(와) '${lefts[j].name}'의 왼쪽 가장자리가 ${d.toFixed(1)}px 어긋나 있습니다.`, fixable: true });
          i = lefts.length;
          break;
        }
      }
    // 제목
    if (num > 1 && s.objects.length && !s.objects.some((o) => isTitle(o) && plainText((o as TextObject).text).trim()) && texts.length)
      add({ kind: 'noTitle', severity: 'info', slideId: s.id, objectIds: [], message: `슬라이드 ${num}: 제목이 없습니다. 제목은 화면 읽기 프로그램과 목차에 쓰입니다.`, fixable: false });
    for (const o of texts) for (const p of o.text.paragraphs) for (const r of p.runs) if (r.text.trim()) {
      const f = resolveFont(r.fontFamily ?? '@body', doc.theme) ?? '';
      fontsUsed.set(f, [...(fontsUsed.get(f) ?? []), s.id]);
    }
  }
  if (fontsUsed.size > 3) add({ kind: 'fonts', severity: 'warning', slideId: slides[0]?.id ?? '', objectIds: [], message: `글꼴을 ${fontsUsed.size}종류 쓰고 있습니다 (${[...fontsUsed.keys()].join(', ')}). 테마 글꼴 2종으로 통일하면 일관돼 보입니다.`, fixable: true });
  return issues;
}

/** 고치기: immer draft에 적용 */
export function fixIssue(d: Presentation, issue: DesignIssue, slides?: string[]) {
  const W = d.size.width;
  const H = d.size.height;
  const slide = d.slides.find((s) => s.id === issue.slideId);
  const objs = (ids: string[]) => slide?.objects.filter((o) => ids.includes(o.id)) ?? [];
  switch (issue.kind) {
    case 'smallText':
      for (const o of objs(issue.objectIds)) {
        const t = textOf(o);
        if (t) for (const p of t.paragraphs) for (const r of p.runs) if ((r.fontSize ?? 18) < MIN_PT) r.fontSize = MIN_PT + 2;
      }
      break;
    case 'contrast':
      for (const o of objs(issue.objectIds)) {
        const t = textOf(o);
        if (!t || (o.type !== 'text' && o.type !== 'shape')) continue;
        const { bg } = designLayers(slide!, d);
        const back = solidOf(o.fill, d.theme) ?? solidOf(bg, d.theme) ?? '#FFFFFF';
        // 테마의 어두운/밝은 글자색 중 대비가 더 큰 것
        const dark = resolveColor('@dark1', d.theme);
        const light = resolveColor('@light1', d.theme);
        const color = contrastRatio(dark, back) >= contrastRatio(light, back) ? '@dark1' : '@light1';
        for (const p of t.paragraphs) for (const r of p.runs) r.color = color;
      }
      break;
    case 'offSlide':
      for (const o of objs(issue.objectIds)) {
        o.x = Math.max(0, Math.min(W - Math.min(o.width, W), o.x));
        o.y = Math.max(0, Math.min(H - Math.min(o.height, H), o.y));
        if (o.width > W) o.width = W;
        if (o.height > H) o.height = H;
      }
      break;
    case 'emptyPlaceholder':
      if (slide) slide.objects = slide.objects.filter((o) => !issue.objectIds.includes(o.id));
      break;
    case 'misaligned': {
      const os = objs(issue.objectIds);
      const x = Math.min(...os.map((o) => o.x));
      for (const o of os) o.x = x;
      break;
    }
    case 'fonts':
      for (const s of d.slides) {
        if (slides && !slides.includes(s.id)) continue;
        for (const o of flat(s.objects)) {
          const t = textOf(o);
          if (!t) continue;
          const font = isTitle(o) ? '@heading' : '@body';
          for (const p of t.paragraphs) for (const r of p.runs) if (r.fontFamily) r.fontFamily = font;
        }
      }
      break;
    case 'tooMuchText':
      if (slide) splitSlideInDraft(d, slide.id);
      break;
    default:
      break;
  }
}

/** 본문이 많은 슬라이드를 두 장으로: 가장 큰 본문 텍스트 상자의 문단을 반으로 나눔 */
export function splitSlideInDraft(d: Presentation, slideId: string): boolean {
  const i = d.slides.findIndex((s) => s.id === slideId);
  const s = d.slides[i];
  if (!s) return false;
  const bodies = s.objects.filter((o): o is TextObject => o.type === 'text' && !isTitle(o) && o.text.paragraphs.length >= 2);
  const body = bodies.sort((a, b) => b.text.paragraphs.length - a.text.paragraphs.length)[0];
  if (!body) return false;
  const half = Math.ceil(body.text.paragraphs.length / 2);
  const copy: Slide = JSON.parse(JSON.stringify(s));
  copy.id = newId();
  for (const o of copy.objects) o.id = newId();
  // 애니메이션·전환 원본 XML은 복사본에 두지 않음 (대상 ID가 바뀜)
  delete copy.animations;
  delete copy.source;
  const bodyIdx = s.objects.indexOf(body);
  const copyBody = copy.objects[bodyIdx] as TextObject;
  copyBody.text.paragraphs = copyBody.text.paragraphs.slice(half);
  body.text.paragraphs = body.text.paragraphs.slice(0, half);
  // 다른 본문 상자는 첫 슬라이드에만
  copy.objects = copy.objects.filter((o, k) => k === bodyIdx || !(o.type === 'text' && !isTitle(o) && bodies.includes(s.objects[k] as TextObject)));
  const t = copy.objects.find(isTitle) as TextObject | undefined;
  if (t) {
    const r = t.text.paragraphs[0]?.runs;
    if (r?.length) r[r.length - 1].text = `${r[r.length - 1].text} (계속)`;
  }
  copy.notes = '';
  d.slides.splice(i + 1, 0, copy);
  return true;
}

/* ───────────── 대본 비교 ───────────── */

export function compareScripts(digests: SlideDigest[], scriptOf: (d: SlideDigest) => string = (d) => d.notes): CompareItem[] {
  return digests.map((d) => {
    const script = scriptOf(d).trim();
    const keys = keywords(`${d.title} ${d.title} ${d.body.join(' ')}`, 8);
    const st = new Set(tokens(script));
    const missing = keys.filter((k) => !covers(st, k));
    const coverage = keys.length ? (keys.length - missing.length) / keys.length : script ? 1 : 0;
    const seconds = speakingSeconds(script);
    const notes: string[] = [];
    if (!script) notes.push('대본(발표자 노트)이 없습니다.');
    else {
      if (keys.length && coverage < 0.5) notes.push(`슬라이드 핵심어 중 ${Math.round(coverage * 100)}%만 대본에 나옵니다.`);
      if (seconds > 150) notes.push(`대본이 깁니다 (약 ${Math.round(seconds / 60)}분). 슬라이드 하나에 2분 이내를 권장합니다.`);
      if (seconds < 8 && d.body.length >= 2) notes.push('대본이 슬라이드 내용에 비해 짧습니다.');
    }
    return { slideId: d.id, coverage, missing, seconds, notes };
  });
}
