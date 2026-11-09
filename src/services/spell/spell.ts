/**
 * 맞춤법 검사 (PowerPoint: 검토 › 맞춤법 검사, F7).
 * - 영어: Hunspell(WebAssembly, hunspell-asm) + en_US 사전(dictionary-en, MIT/BSD)
 * - 한국어: Hunspell + hunspell-dict-ko 사전(dictionary-ko, MPL 1.1) + 국립국어원 규범 기반 보조 규칙(korean.ts)
 * - 반복된 단어("the the")
 * 사전은 처음 검사할 때만 받아 온다 (한국어 약 0.9MB, 영어 0.2MB, 압축 기준). 사용자 사전·모두 무시는 이 브라우저에 저장.
 */
import type { Paragraph, Presentation, SlideObject, TextBody } from '../../types/model';
import { checkKorean } from './korean';
import { checkParticles, particleAgreement } from './particles';

export type SpellLang = 'ko' | 'en';

export interface Speller {
  spell(word: string): boolean;
  suggest(word: string): string[];
}

/* ───────────── 사전 불러오기 ───────────── */

type Factory = Awaited<ReturnType<typeof import('hunspell-asm').loadModule>>;
let factory: Promise<Factory> | null = null;
const spellers = new Map<SpellLang, Promise<Speller>>();

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`사전을 받지 못했습니다 (HTTP ${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

export function loadSpeller(lang: SpellLang): Promise<Speller> {
  let p = spellers.get(lang);
  if (!p) {
    p = (async () => {
      factory ??= import('hunspell-asm').then((m) => m.loadModule());
      const f = await factory;
      const urls =
        lang === 'ko'
          ? await Promise.all([import('../../../node_modules/dictionary-ko/index.aff?url'), import('../../../node_modules/dictionary-ko/index.dic?url')])
          : await Promise.all([import('../../../node_modules/dictionary-en/index.aff?url'), import('../../../node_modules/dictionary-en/index.dic?url')]);
      const [aff, dic] = await Promise.all(urls.map((u) => fetchBytes(new URL(u.default, location.href).href)));
      const h = f.create(f.mountBuffer(aff, `${lang}.aff`), f.mountBuffer(dic, `${lang}.dic`));
      return { spell: (w: string) => h.spell(w), suggest: (w: string) => h.suggest(w) };
    })();
    spellers.set(lang, p);
    p.catch(() => spellers.delete(lang));
  }
  return p;
}

/* ───────────── 사용자 사전 ───────────── */

const DICT_KEY = 'slidelab.spell.user';
export function userDictionary(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DICT_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function addToDictionary(word: string) {
  const s = userDictionary();
  s.add(word);
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify([...s]));
  } catch {
    /* 저장 불가 */
  }
}

/* ───────────── 낱말 나누기 ───────────── */

export interface Token {
  word: string;
  start: number;
  end: number;
  lang: SpellLang;
}

const URLISH = /^(https?:\/\/|www\.)|@|\.(com|net|org|kr|io)\b/i;

/** 문단 글자 → 검사할 낱말 (숫자·URL·전자 우편·대문자 약어는 건너뜀: PowerPoint 기본 옵션과 같음) */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const chunk = /\S+/g;
  let c: RegExpExecArray | null;
  while ((c = chunk.exec(text))) {
    // 주소·전자 우편은 통째로 건너뜀
    if (URLISH.test(c[0])) continue;
    const word = /[\p{L}\p{M}'’]+(?:-[\p{L}\p{M}]+)*/gu;
    let m: RegExpExecArray | null;
    while ((m = word.exec(c[0]))) {
      // 앞뒤 따옴표
      const lead = m[0].match(/^['’]+/)?.[0].length ?? 0;
      const trail = m[0].match(/['’]+$/)?.[0].length ?? 0;
      const w = m[0].slice(lead, m[0].length - trail || undefined);
      const start = c.index + m.index + lead;
      if (!w) continue;
      // 숫자가 붙은 낱말(2026년)과 대문자 약어(NASA)는 건너뜀 (PowerPoint 기본 옵션)
      const next = c[0][m.index + m[0].length], prev = c[0][m.index - 1];
      if ((next && /\d/.test(next)) || (prev && /\d/.test(prev))) continue;
      if (/^[A-Z]{2,}$/.test(w)) continue;
      if (/^[\uac00-\ud7a3]+$/.test(w)) out.push({ word: w, start, end: start + w.length, lang: 'ko' });
      else if (/^[A-Za-z][A-Za-z'’-]*$/.test(w)) out.push({ word: w.replace(/’/g, "'"), start, end: start + w.length, lang: 'en' });
    }
  }
  return out;
}

/* ───────────── 문서 검사 ───────────── */

export interface SpellIssue {
  id: string;
  slideId: string;
  /** 개체 ID (노트면 'notes') */
  objectId: string;
  /** 표 셀 [행, 열] */
  cell?: [number, number];
  paragraph: number;
  start: number;
  end: number;
  word: string;
  kind: 'spelling' | 'grammar' | 'repeat' | 'ai';
  suggestions: string[];
  /** 규칙 설명 (한국어 규칙·반복) */
  why?: string;
  context: string;
}

export const paragraphText = (p: Paragraph) => p.runs.map((r) => r.text).join('');

interface Body {
  objectId: string;
  cell?: [number, number];
  body: TextBody;
}

function bodiesOf(o: SlideObject): Body[] {
  if (o.type === 'text' || o.type === 'shape') return [{ objectId: o.id, body: o.text }];
  if (o.type === 'group') return o.children.flatMap(bodiesOf);
  if (o.type === 'table') return o.rows.flatMap((r, ri) => r.cells.map((c, ci) => ({ objectId: o.id, cell: [ri, ci] as [number, number], body: c.text })));
  return [];
}

const notesBody = (notes: string): TextBody => ({ paragraphs: notes.split('\n').map((t) => ({ runs: [{ text: t }] })) }) as unknown as TextBody;

export interface CheckOptions {
  speller: (lang: SpellLang) => Speller | null;
  ignore: Set<string>;
  includeNotes: boolean;
}

/* ───────────── AI 문맥 문법 ───────────── */

export interface ParagraphRef {
  key: string;
  slideId: string;
  objectId: string;
  cell?: [number, number];
  paragraph: number;
  text: string;
}

/** 검사할 문단 목록 (checkDocument와 같은 순서·범위) */
export function listParagraphs(doc: Presentation, includeNotes: boolean): ParagraphRef[] {
  const out: ParagraphRef[] = [];
  for (const s of doc.slides) {
    const bodies = [...s.objects.flatMap(bodiesOf), ...(includeNotes && s.notes ? [{ objectId: 'notes', body: notesBody(s.notes) }] : [])];
    for (const b of bodies)
      b.body.paragraphs.forEach((p, pi) => {
        const text = paragraphText(p);
        if (text.trim()) out.push({ key: `${s.id}|${b.objectId}|${b.cell?.join(',') ?? ''}|${pi}`, slideId: s.id, objectId: b.objectId, ...(b.cell ? { cell: b.cell } : {}), paragraph: pi, text });
      });
  }
  return out;
}

export interface AIEdit {
  /** ParagraphRef.key */
  key: string;
  find: string;
  replace: string;
  reason: string;
}

/** AI가 고칠 부분 → 지금 문서 기준 이슈 (고친 뒤 원문에서 사라진 것은 뺌) */
export function aiIssues(doc: Presentation, edits: AIEdit[], includeNotes: boolean): SpellIssue[] {
  const byKey = new Map(listParagraphs(doc, includeNotes).map((p) => [p.key, p]));
  const out: SpellIssue[] = [];
  edits.forEach((e, n) => {
    const p = byKey.get(e.key);
    const at = p ? p.text.indexOf(e.find) : -1;
    if (!p || at < 0) return;
    const end = at + e.find.length;
    const context = `${at > 20 ? '…' : ''}${p.text.slice(Math.max(0, at - 20), end + 20)}${end + 20 < p.text.length ? '…' : ''}`;
    out.push({ id: `ai${n}`, slideId: p.slideId, objectId: p.objectId, ...(p.cell ? { cell: p.cell } : {}), paragraph: p.paragraph, start: at, end, word: e.find, kind: 'ai', suggestions: [e.replace], why: e.reason, context });
  });
  return out;
}

/** 문서 전체 검사 (슬라이드 순서, 개체 순서) */
export function checkDocument(doc: Presentation, opts: CheckOptions): SpellIssue[] {
  const user = userDictionary();
  const out: SpellIssue[] = [];
  let seq = 0;
  for (const s of doc.slides) {
    const bodies = [...s.objects.flatMap(bodiesOf), ...(opts.includeNotes && s.notes ? [{ objectId: 'notes', body: notesBody(s.notes) }] : [])];
    for (const b of bodies) {
      b.body.paragraphs.forEach((p, pi) => {
        const text = paragraphText(p);
        if (!text.trim()) return;
        const ctx = (a: number, z: number) => `${a > 20 ? '…' : ''}${text.slice(Math.max(0, a - 20), z + 20)}${z + 20 < text.length ? '…' : ''}`;
        const base = { slideId: s.id, objectId: b.objectId, ...(b.cell ? { cell: b.cell } : {}), paragraph: pi };
        const before = out.length;
        const taken: [number, number][] = [];
        // 한국어 규칙 (어절을 넘는 띄어쓰기 포함)
        for (const k of checkKorean(text)) {
          if (opts.ignore.has(k.found)) continue;
          out.push({ ...base, id: `i${seq++}`, start: k.start, end: k.end, word: k.found, kind: 'grammar', suggestions: [k.fix], why: k.why, context: ctx(k.start, k.end) });
          taken.push([k.start, k.end]);
        }
        // 숫자·대문자 약어 뒤 조사 받침 맞춤 (2를, SQL로)
        for (const k of checkParticles(text)) {
          if (opts.ignore.has(text.slice(k.start - 8 < 0 ? 0 : k.start - 8, k.end)) || taken.some(([a, z]) => k.start < z && k.end > a)) continue;
          out.push({ ...base, id: `i${seq++}`, start: k.start, end: k.end, word: k.found, kind: 'grammar', suggestions: [k.fix], why: k.why, context: ctx(k.start, k.end) });
          taken.push([k.start, k.end]);
        }
        const toks = tokenize(text);
        toks.forEach((t, i) => {
          if (taken.some(([a, z]) => t.start < z && t.end > a)) return;
          // 반복된 단어
          const prev = toks[i - 1];
          if (prev && prev.word.toLowerCase() === t.word.toLowerCase() && /^\s+$/.test(text.slice(prev.end, t.start)) && !opts.ignore.has(`${t.word} ${t.word}`)) {
            out.push({ ...base, id: `i${seq++}`, start: prev.start, end: t.end, word: text.slice(prev.start, t.end), kind: 'repeat', suggestions: [t.word], why: '같은 단어가 반복되었습니다.', context: ctx(prev.start, t.end) });
            return;
          }
          if (user.has(t.word) || opts.ignore.has(t.word)) return;
          const sp = opts.speller(t.lang);
          if (!sp || sp.spell(t.word)) return;
          // 영어: 첫 글자만 대문자인 문장 첫 단어도 소문자로 다시 확인
          if (t.lang === 'en' && /^[A-Z][a-z]+$/.test(t.word) && sp.spell(t.word.toLowerCase())) return;
          // 한국어: 조사만 받침에 맞게 바꾸면 맞는 말이면 문법(조사) 오류로
          const pa = t.lang === 'ko' ? particleAgreement(t.word, (w) => sp.spell(w)) : null;
          if (pa) {
            out.push({ ...base, id: `i${seq++}`, start: t.start, end: t.end, word: t.word, kind: 'grammar', suggestions: [pa.fix], why: pa.why, context: ctx(t.start, t.end) });
            return;
          }
          out.push({ ...base, id: `i${seq++}`, start: t.start, end: t.end, word: t.word, kind: 'spelling', suggestions: [], context: ctx(t.start, t.end) });
        });
        // 문단 안에서는 글자 순서대로
        const mine = out.splice(before).sort((a, z) => a.start - z.start);
        out.push(...mine);
      });
    }
  }
  return out;
}

/** 문단의 [start, end) 글자를 바꿈 (여러 글자 묶음(run)에 걸쳐도 앞 묶음의 서식으로) */
export function replaceInParagraph(p: Paragraph, start: number, end: number, text: string) {
  let pos = 0;
  let inserted = false;
  for (const r of p.runs) {
    const a = pos, z = pos + r.text.length;
    pos = z;
    if (z <= start || a >= end) continue;
    const from = Math.max(0, start - a), to = Math.min(r.text.length, end - a);
    r.text = r.text.slice(0, from) + (inserted ? '' : text) + r.text.slice(to);
    inserted = true;
  }
  if (!inserted && p.runs.length) p.runs[p.runs.length - 1].text += text;
}

/** 이슈 위치의 문단 찾기 (노트는 줄 단위) */
export function applyFix(doc: Presentation, issue: SpellIssue, text: string): boolean {
  const s = doc.slides.find((x) => x.id === issue.slideId);
  if (!s) return false;
  if (issue.objectId === 'notes') {
    const lines = s.notes.split('\n');
    const line = lines[issue.paragraph];
    if (line === undefined || line.slice(issue.start, issue.end) !== issue.word) return false;
    lines[issue.paragraph] = line.slice(0, issue.start) + text + line.slice(issue.end);
    s.notes = lines.join('\n');
    return true;
  }
  const find = (list: SlideObject[]): SlideObject | undefined => {
    for (const o of list) {
      if (o.id === issue.objectId) return o;
      if (o.type === 'group') {
        const f = find(o.children);
        if (f) return f;
      }
    }
    return undefined;
  };
  const o = find(s.objects);
  if (!o) return false;
  const body = o.type === 'table' && issue.cell ? o.rows[issue.cell[0]]?.cells[issue.cell[1]]?.text : o.type === 'text' || o.type === 'shape' ? o.text : undefined;
  const p = body?.paragraphs[issue.paragraph];
  if (!p || paragraphText(p).slice(issue.start, issue.end) !== issue.word) return false;
  replaceInParagraph(p, issue.start, issue.end, text);
  return true;
}
