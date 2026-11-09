/**
 * 문서 읽기: txt / md / docx → 구조(제목, 구역, 문단, 목록).
 * docx는 ZIP 안의 word/document.xml을 직접 해석한다 (제목 스타일 → 구역, 번호/글머리 목록 → 항목).
 */

export interface DocSection {
  heading: string;
  level: number;
  paragraphs: string[];
  bullets: string[];
}

export interface ParsedDoc {
  title: string;
  sections: DocSection[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** docx → 마크다운 비슷한 텍스트 (# 제목, - 목록) */
export async function docxToText(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  // 압축 해제 라이브러리는 Word 문서를 읽을 때만 불러옴 (시작 화면 크기 절약)
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Word 문서(.docx)가 아닙니다.');
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  const parser = new DOMParser();
  // 스타일 ID → 제목 수준 (스타일 이름 heading N / title, 한국어 Word의 '제목 N')
  const headingLevel = new Map<string, number>();
  if (stylesXml) {
    const sdoc = parser.parseFromString(stylesXml, 'application/xml');
    for (const st of Array.from(sdoc.getElementsByTagNameNS(W, 'style'))) {
      const id = st.getAttributeNS(W, 'styleId') ?? st.getAttribute('w:styleId') ?? '';
      const name = (st.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val') ?? '').toLowerCase();
      const m = name.match(/^(?:heading|제목)\s*(\d)$/);
      if (m) headingLevel.set(id, Number(m[1]));
      else if (name === 'title' || name === '제목') headingLevel.set(id, 0);
    }
  }
  const doc = parser.parseFromString(xml, 'application/xml');
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const text = Array.from(p.getElementsByTagNameNS(W, 't'))
      .map((t) => t.textContent ?? '')
      .join('')
      .trim();
    if (!text) continue;
    const pPr = p.getElementsByTagNameNS(W, 'pPr')[0];
    const styleId = pPr?.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
    const lvl = headingLevel.get(styleId) ?? (/^heading(\d)$/i.test(styleId) ? Number(styleId.slice(7)) : /^title$/i.test(styleId) ? 0 : undefined);
    if (lvl !== undefined) out.push(`${'#'.repeat(Math.max(1, lvl))} ${text}`);
    else if (pPr?.getElementsByTagNameNS(W, 'numPr').length) out.push(`- ${text}`);
    else out.push(text);
  }
  return out.join('\n');
}

const HEADING_PATTERNS: [RegExp, number][] = [
  [/^(#{1,6})\s+(.+)$/, 0], // 마크다운
  [/^(제\s*\d+\s*[장절부])\s*[.:]?\s*(.+)?$/, 1],
  [/^([IVXⅠ-Ⅻ]+)\.\s+(.+)$/, 1],
  [/^(\d+)\.\s+(.{1,40})$/, 2],
  [/^(\d+\.\d+)\.?\s+(.{1,40})$/, 3],
];

function headingOf(line: string): { level: number; text: string } | null {
  for (const [re, kind] of HEADING_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    if (kind === 0) return { level: m[1].length, text: m[2].trim() };
    if (kind === 1) return { level: 1, text: (m[2] ?? m[1]).trim() };
    // "1. 짧은 줄"은 문장이 아닐 때만 제목 (마침표로 끝나면 번호 목록)
    if (/[.다요]$/.test(m[2])) return null;
    return { level: kind, text: m[2].trim() };
  }
  return null;
}

/** 텍스트(마크다운 포함) → 구역 구조 */
export function parseDocument(text: string, fallbackTitle = '문서'): ParsedDoc {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: DocSection[] = [];
  let title = '';
  let cur: DocSection | null = null;
  const ensure = () => (cur ??= (sections.push({ heading: '', level: 1, paragraphs: [], bullets: [] }), sections[sections.length - 1]));
  let para: string[] = [];
  const flush = () => {
    if (para.length) ensure().paragraphs.push(para.join(' '));
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = headingOf(line);
    if (h) {
      flush();
      if (!title && (h.level === 1 || (h.level === 0 && !sections.length)) && !sections.length && !cur) {
        // 첫 1수준 제목은 문서 제목
        title = h.text;
        continue;
      }
      cur = { heading: h.text, level: h.level, paragraphs: [], bullets: [] };
      sections.push(cur);
      continue;
    }
    const b = line.match(/^(?:[-*•·▪◦]|\d+[.)]|[가-하][.)])\s+(.+)$/);
    if (b) {
      flush();
      ensure().bullets.push(b[1].trim());
      continue;
    }
    // 짧고 문장부호 없는 단독 줄 → 소제목으로
    if (line.length <= 30 && !/[.!?,:;다요]$/.test(line) && para.length === 0 && /\S\s*$/.test(line) && lines.length > 3) {
      cur = { heading: line, level: 2, paragraphs: [], bullets: [] };
      sections.push(cur);
      continue;
    }
    para.push(line);
  }
  flush();
  // 제목 없는 첫 구역이 비었으면 제거
  const cleaned = sections.filter((s) => s.heading || s.paragraphs.length || s.bullets.length);
  if (!title) title = fallbackTitle;
  return { title, sections: cleaned };
}
