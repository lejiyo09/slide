/**
 * PPTX 메모
 * 내보내기 (문서 설정 '메모 형식': 자동 = 해결한 메모가 있으면 최신, 없으면 기존)
 *   기존 메모 (PowerPoint 2007~2019, LibreOffice가 읽고 쓰는 형식, PowerPoint 365도 읽음):
 *     ppt/commentAuthors.xml (p:cmAuthorLst) + ppt/comments/commentN.xml (p:cmLst/p:cm)
 *     위치 p:pos는 마스터 단위(1/576인치 = 슬라이드 px × 6), 답글은 p15:threadingInfo/p15:parentCm (PowerPoint 2013+). '해결됨'은 이 형식에 없음.
 *   최신 메모 (PowerPoint 365, MS-PPTX p188): ppt/authors.xml (p188:authorLst) + ppt/comments/modernComment_*.xml (p188:cmLst)
 *     메모마다 status="resolved"(해결됨)·답글(p188:replyLst)·위치(p188:pos, EMU)·슬라이드 표지(pc:sldMkLst),
 *     슬라이드는 p:extLst의 p188:commentRel로 메모 파트를 가리킴. 요소 순서·필수 속성은 Open XML SDK 스키마로 검증.
 * 가져오기: 기존 메모(답글 포함) + 최신 메모(PowerPoint 365: ppt/comments/modernComment_*.xml, ppt/authors.xml — p188 이름공간)
 */
import type { Presentation, SlideComment } from '../../types/model';
import { newId } from '../../utils/id';

export const REL_COMMENT_AUTHORS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors';
export const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
export const CT_COMMENT_AUTHORS = 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml';
export const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml';
/** 최신 메모 (MS-PPTX, Open XML SDK PowerPointCommentPart/PowerPointAuthorsPart) */
export const REL_MODERN_COMMENTS = 'http://schemas.microsoft.com/office/2018/10/relationships/comments';
export const REL_MODERN_AUTHORS = 'http://schemas.microsoft.com/office/2018/10/relationships/authors';
export const P188_NS = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const P15_NS = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
/** p:cm 확장: 답글 정보(p15:threadingInfo) */
const THREADING_EXT_URI = '{C676402C-5697-4E1C-873F-D02D1690AC5C}';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().replace('Z', '') : d.toISOString().replace('Z', '');
};

export interface LegacyCommentsXml {
  authorsXml: string;
  /** 내보낸 슬라이드 순서대로 (메모 없으면 undefined) */
  slides: (string | undefined)[];
  count: number;
}

export function buildLegacyComments(slides: Presentation['slides']): LegacyCommentsXml | null {
  const authors = new Map<string, { id: number; initials: string; lastIdx: number }>();
  const author = (name: string, initials: string) => {
    const key = name || '알 수 없음';
    let a = authors.get(key);
    if (!a) authors.set(key, (a = { id: authors.size, initials: initials || key.slice(0, 2), lastIdx: 0 }));
    return a;
  };
  let count = 0;
  const out = slides.map((s) => {
    if (!s.comments?.length) return undefined;
    const cms: string[] = [];
    for (const c of s.comments) {
      const a = author(c.author, c.initials);
      const idx = ++a.lastIdx;
      const pos = `<p:pos x="${Math.round(c.x * 6)}" y="${Math.round(c.y * 6)}"/>`;
      cms.push(`<p:cm authorId="${a.id}" dt="${dt(c.created)}" idx="${idx}">${pos}<p:text>${esc(c.text)}</p:text></p:cm>`);
      count++;
      for (const r of c.replies) {
        const ra = author(r.author, r.initials);
        const ridx = ++ra.lastIdx;
        cms.push(
          `<p:cm authorId="${ra.id}" dt="${dt(r.created)}" idx="${ridx}">${pos}<p:text>${esc(r.text)}</p:text>` +
            `<p:extLst><p:ext uri="${THREADING_EXT_URI}"><p15:threadingInfo xmlns:p15="${P15_NS}" timeZoneBias="0"><p15:parentCm authorId="${a.id}" idx="${idx}"/></p15:threadingInfo></p:ext></p:extLst></p:cm>`,
        );
        count++;
      }
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst xmlns:p="${P_NS}">${cms.join('')}</p:cmLst>`;
  });
  if (!count) return null;
  const list = [...authors.entries()].map(([name, a]) => `<p:cmAuthor id="${a.id}" name="${esc(name)}" initials="${esc(a.initials)}" lastIdx="${a.lastIdx}" clrIdx="${a.id % 8}"/>`);
  return { authorsXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst xmlns:p="${P_NS}">${list.join('')}</p:cmAuthorLst>`, slides: out, count };
}

/* ───────────── 최신 메모 (p188) ───────────── */

export const CT_MODERN_COMMENTS = 'application/vnd.ms-powerpoint.comments+xml';
export const CT_MODERN_AUTHORS = 'application/vnd.ms-powerpoint.authors+xml';
const PC_NS = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command';
/** p:sld 확장: 최신 메모 관계 (MS-PPTX commentRel) */
export const COMMENT_REL_EXT_URI = '{6950BFC3-D8DA-4A85-94F7-54DA5524770B}';
/** 슬라이드 ID 자리 (presentation.xml을 읽은 뒤 채움) */
export const SLIDE_ID_PLACEHOLDER = '__SLIDELAB_SLDID__';

/** 글자 → 고정 GUID ({8-4-4-4-12}, 같은 글자면 같은 값: 다시 저장해도 ID가 바뀌지 않음) */
export function stableGuid(seed: string): string {
  let h = '';
  for (let k = 0; k < 4; k++) {
    let x = 0x811c9dc5 ^ (k * 0x9e3779b9);
    for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 0x01000193);
    h += (x >>> 0).toString(16).padStart(8, '0');
  }
  h = h.toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}}`;
}

const txBody = (text: string) =>
  `<p188:txBody><a:bodyPr/><a:lstStyle/>${text
    .split('\n')
    .map((line) => (line ? `<a:p><a:r><a:rPr lang="ko-KR"/><a:t>${esc(line)}</a:t></a:r></a:p>` : '<a:p/>'))
    .join('')}</p188:txBody>`;

export interface ModernCommentsXml {
  authorsXml: string;
  /** 내보낸 슬라이드 순서대로 (메모 없으면 undefined). 슬라이드 ID는 SLIDE_ID_PLACEHOLDER */
  slides: (string | undefined)[];
  count: number;
}

export function buildModernComments(slides: Presentation['slides']): ModernCommentsXml | null {
  const authors = new Map<string, { id: string; initials: string }>();
  const author = (name: string, initials: string) => {
    const key = name || '알 수 없음';
    let a = authors.get(key);
    if (!a) authors.set(key, (a = { id: stableGuid(`author:${key}`), initials: initials || key.slice(0, 2) }));
    return a;
  };
  const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  const ns = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p188="${P188_NS}"`;
  let count = 0;
  const out = slides.map((s) => {
    if (!s.comments?.length) return undefined;
    const cms = s.comments.map((c) => {
      const a = author(c.author, c.initials);
      count += 1 + c.replies.length;
      const replies = c.replies.length
        ? `<p188:replyLst>${c.replies
            .map((r) => `<p188:reply id="${stableGuid(`reply:${r.id}`)}" authorId="${author(r.author, r.initials).id}" created="${dt(r.created)}">${txBody(r.text)}</p188:reply>`)
            .join('')}</p188:replyLst>`
        : '';
      return (
        `<p188:cm id="${stableGuid(`cm:${c.id}`)}" authorId="${a.id}" created="${dt(c.created)}"${c.resolved ? ' status="resolved"' : ''}>` +
        `<pc:sldMkLst xmlns:pc="${PC_NS}"><pc:docMk/><pc:sldMk cId="0" sldId="${SLIDE_ID_PLACEHOLDER}"/></pc:sldMkLst>` +
        `<p188:pos x="${Math.round(c.x * 9525)}" y="${Math.round(c.y * 9525)}"/>${replies}${txBody(c.text)}</p188:cm>`
      );
    });
    return `${head}<p188:cmLst ${ns}>${cms.join('')}</p188:cmLst>`;
  });
  if (!count) return null;
  const list = [...authors.entries()].map(([name, a]) => `<p188:author id="${a.id}" name="${esc(name)}" initials="${esc(a.initials)}" userId="${esc(name)}" providerId="None"/>`);
  return { authorsXml: `${head}<p188:authorLst ${ns}>${list.join('')}</p188:authorLst>`, slides: out, count };
}

/** 문서 설정 → 실제로 쓸 메모 형식 (자동: 해결한 메모가 있으면 최신) */
export function commentFormatFor(doc: Pick<Presentation, 'slides' | 'commentFormat'>): 'legacy' | 'modern' {
  if (doc.commentFormat === 'legacy' || doc.commentFormat === 'modern') return doc.commentFormat;
  return doc.slides.some((s) => s.comments?.some((c) => c.resolved)) ? 'modern' : 'legacy';
}

export type CommentsPlan = ({ format: 'legacy' } & LegacyCommentsXml) | ({ format: 'modern' } & ModernCommentsXml);

export function buildComments(doc: Pick<Presentation, 'slides' | 'commentFormat'>): CommentsPlan | null {
  if (commentFormatFor(doc) === 'modern') {
    const m = buildModernComments(doc.slides);
    return m ? { format: 'modern', ...m } : null;
  }
  const l = buildLegacyComments(doc.slides);
  return l ? { format: 'legacy', ...l } : null;
}

/* ───────────── 가져오기 ───────────── */

const kids = (e: Element | null | undefined) => (e ? Array.from(e.children) : []);
const kid = (e: Element | null | undefined, name: string) => kids(e).find((c) => c.localName === name) ?? null;
const all = (e: Element, name: string) => Array.from(e.getElementsByTagName('*')).filter((c) => c.localName === name);
const isoOf = (s: string | null) => {
  if (!s) return new Date(0).toISOString();
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
};

export interface CommentAuthor {
  name: string;
  initials: string;
}

/** ppt/commentAuthors.xml → id별 작성자 */
export function parseLegacyAuthors(doc: Document | null): Map<string, CommentAuthor> {
  const m = new Map<string, CommentAuthor>();
  if (!doc) return m;
  for (const a of all(doc.documentElement, 'cmAuthor')) m.set(a.getAttribute('id') ?? '', { name: a.getAttribute('name') ?? '', initials: a.getAttribute('initials') ?? '' });
  return m;
}

/** 기존 메모 (p:cmLst) → 메모 목록 (p15:parentCm으로 답글 묶기) */
export function parseLegacyComments(doc: Document, authors: Map<string, CommentAuthor>): SlideComment[] {
  const out: SlideComment[] = [];
  const byKey = new Map<string, SlideComment>();
  for (const cm of kids(doc.documentElement).filter((c) => c.localName === 'cm')) {
    const aid = cm.getAttribute('authorId') ?? '';
    const au = authors.get(aid) ?? { name: '알 수 없음', initials: '' };
    const pos = kid(cm, 'pos');
    const text = kid(cm, 'text')?.textContent ?? '';
    const created = isoOf(cm.getAttribute('dt'));
    const parent = all(cm, 'parentCm')[0];
    if (parent) {
      const p = byKey.get(`${parent.getAttribute('authorId')}:${parent.getAttribute('idx')}`);
      if (p) {
        p.replies.push({ id: newId(), author: au.name, initials: au.initials, text, created });
        continue;
      }
    }
    const c: SlideComment = {
      id: newId(),
      author: au.name,
      initials: au.initials,
      text,
      created,
      x: Number(pos?.getAttribute('x') ?? 0) / 6,
      y: Number(pos?.getAttribute('y') ?? 0) / 6,
      replies: [],
    };
    byKey.set(`${aid}:${cm.getAttribute('idx')}`, c);
    out.push(c);
  }
  return out;
}

/** ppt/authors.xml (p188:authorLst) */
export function parseModernAuthors(doc: Document | null): Map<string, CommentAuthor> {
  const m = new Map<string, CommentAuthor>();
  if (!doc) return m;
  for (const a of all(doc.documentElement, 'author')) m.set(a.getAttribute('id') ?? '', { name: a.getAttribute('name') ?? '', initials: a.getAttribute('initials') ?? '' });
  return m;
}

const bodyText = (txBody: Element | null) =>
  txBody
    ? kids(txBody)
        .filter((p) => p.localName === 'p')
        .map((p) => all(p, 't').map((t) => t.textContent ?? '').join(''))
        .join('\n')
    : '';

/** 최신 메모 (p188:cmLst): 답글·해결 상태 포함. 위치 p188:pos는 EMU */
export function parseModernComments(doc: Document, authors: Map<string, CommentAuthor>, slideObjectIdBySourceId?: (creationId: string) => string | undefined): SlideComment[] {
  const out: SlideComment[] = [];
  for (const cm of kids(doc.documentElement).filter((c) => c.localName === 'cm')) {
    const au = authors.get(cm.getAttribute('authorId') ?? '') ?? { name: '알 수 없음', initials: '' };
    const pos = kid(cm, 'pos');
    const status = cm.getAttribute('status');
    // 개체에 단 메모: oac:deMkLst의 마지막 oac:deMk id (cNvPr의 creationId가 아니라 도형 ID)
    const de = all(cm, 'deMk').pop();
    const objectId = de && slideObjectIdBySourceId ? slideObjectIdBySourceId(de.getAttribute('id') ?? '') : undefined;
    out.push({
      id: newId(),
      author: au.name,
      initials: au.initials,
      text: bodyText(kid(cm, 'txBody')),
      created: isoOf(cm.getAttribute('created')),
      x: pos ? Number(pos.getAttribute('x') ?? 0) / 9525 : 0,
      y: pos ? Number(pos.getAttribute('y') ?? 0) / 9525 : 0,
      ...(objectId ? { objectId } : {}),
      ...(status === 'resolved' || status === 'closed' ? { resolved: true } : {}),
      replies: kids(kid(cm, 'replyLst'))
        .filter((r) => r.localName === 'reply')
        .map((r) => {
          const ra = authors.get(r.getAttribute('authorId') ?? '') ?? { name: '알 수 없음', initials: '' };
          return { id: newId(), author: ra.name, initials: ra.initials, text: bodyText(kid(r, 'txBody')), created: isoOf(r.getAttribute('created')) };
        }),
    });
  }
  return out;
}
