/**
 * PPTX 메모
 * 내보내기: 기존 메모 형식 (PowerPoint 2007~2019, LibreOffice가 읽고 쓰는 형식, PowerPoint 365도 읽음)
 *   ppt/commentAuthors.xml (p:cmAuthorLst) + ppt/comments/commentN.xml (p:cmLst/p:cm)
 *   위치 p:pos는 마스터 단위(1/576인치 = 슬라이드 px × 6), 답글은 p15:threadingInfo/p15:parentCm (PowerPoint 2013+)
 *   '해결됨'은 기존 형식에 없어 저장되지 않는다.
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
