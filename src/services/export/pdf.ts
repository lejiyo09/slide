/**
 * 최소 PDF 작성기 (PDF 1.7): 페이지마다 JPEG 그림 하나 (DCTDecode 그대로 넣음)
 * + 그 위에 보이지 않는 글자 층(글자 그리기 방식 3 = 안 보임) — OCR PDF와 같은 방식으로 선택·검색·복사가 된다.
 * 글자 층 글꼴: 모양이 없는 TrueType 글꼴(직접 만들어 넣음, Type0/Identity-H),
 * 글자 코드 = UTF-16 코드 단위(BMP), BMP 밖 글자는 D800–DFFF 자리에 차례로 배정, ToUnicode로 원래 글자를 알려 줌.
 * 글자마다 화면에서 잰 자리·폭에 Tz(가로 비율)로 맞춰 놓아 선택 영역이 그림의 글자와 겹치게 한다(글자 상자가 없으면 묶음 폭에 고르게).
 */
import { buildSfnt } from '../fonts/sfnt';

export interface PdfPage {
  /** 페이지 크기 (pt, 1pt = 1/72in) */
  width: number;
  height: number;
  jpeg: Uint8Array;
  /** 그림 픽셀 크기 */
  pixelWidth: number;
  pixelHeight: number;
  /** 보이지 않는 글자 층: 한 줄 묶음마다 위치(pt, 왼쪽 위 기준)와 글자 */
  text?: PdfTextRun[];
}

export interface PdfTextRun {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** 글자(코드 포인트)마다 화면의 [왼쪽, 오른쪽] (pt). 있으면 글자마다 그 자리·폭에 놓음 */
  boxes?: [number, number][];
}

export interface PdfInfo {
  title?: string;
  author?: string;
}

const enc = new TextEncoder();

/** PDF 문자열: 아스키면 (리터럴), 아니면 UTF-16BE <hex> */
export function pdfString(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// ── 모양 없는 글꼴 ───────────────────────────────────────────────
const EM = 1000, ADV = 500, ASC = 800, DESC = -200;

/** 글리프 2개(0 .notdef, 1 빈 글자, 폭 500/1000)짜리 TrueType */
export function glyphlessFont(): Uint8Array {
  const t = (n: number, f: (v: DataView) => void) => {
    const b = new Uint8Array(n);
    f(new DataView(b.buffer));
    return b;
  };
  const head = t(54, (v) => {
    v.setUint32(0, 0x00010000);
    v.setUint32(4, 0x00010000);
    v.setUint32(12, 0x5f0f3cf5);
    v.setUint16(16, 0x000b);
    v.setUint16(18, EM);
    v.setInt16(38, DESC);
    v.setInt16(40, ADV);
    v.setInt16(42, ASC);
    v.setUint16(46, 8);
    v.setInt16(48, 2);
  });
  const hhea = t(36, (v) => {
    v.setUint32(0, 0x00010000);
    v.setInt16(4, ASC);
    v.setInt16(6, DESC);
    v.setUint16(10, ADV);
    v.setInt16(16, ADV);
    v.setInt16(18, 1);
    v.setUint16(34, 2);
  });
  const maxp = t(32, (v) => {
    v.setUint32(0, 0x00010000);
    v.setUint16(4, 2);
    v.setUint16(14, 1);
  });
  const hmtx = t(8, (v) => {
    v.setUint16(0, ADV);
    v.setUint16(4, ADV);
  });
  const loca = new Uint8Array(6);
  const glyf = new Uint8Array(4);
  const post = t(32, (v) => v.setUint32(0, 0x00030000));
  return buildSfnt(0x00010000, [
    { tag: 'head', data: head },
    { tag: 'hhea', data: hhea },
    { tag: 'maxp', data: maxp },
    { tag: 'hmtx', data: hmtx },
    { tag: 'loca', data: loca },
    { tag: 'glyf', data: glyf },
    { tag: 'post', data: post },
  ]);
}

/** CIDToGIDMap: 모든 글자 코드(0–FFFF) → 글리프 1. 0x00 0x01을 65536번 = zlib(고정 허프만, 길이 258·거리 2 반복) */
export function cidToGid1Stream(): Uint8Array {
  const out: number[] = [0x78, 0x01];
  let acc = 0, nbits = 0;
  const bits = (v: number, n: number) => {
    acc |= v << nbits;
    nbits += n;
    while (nbits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      nbits -= 8;
    }
  };
  const code = (c: number, n: number) => {
    let r = 0;
    for (let i = 0; i < n; i++) r |= ((c >> i) & 1) << (n - 1 - i);
    bits(r, n);
  };
  const lit = (b: number) => code(0x30 + b, 8);
  bits(1, 1); // 마지막 블록
  bits(1, 2); // 고정 허프만
  lit(0);
  lit(1);
  let left = 131072 - 2;
  while (left >= 258) {
    code(0xc5, 8); // 길이 258 (기호 285)
    code(1, 5); // 거리 2
    left -= 258;
  }
  if (left) {
    // 길이 3–10: 기호 257–264 (7비트, 0000001부터)
    code(left - 2, 7);
    code(1, 5);
  }
  code(0, 7); // 블록 끝 (256)
  if (nbits) bits(0, 8 - nbits);
  let a = 1, b = 0;
  for (let i = 0; i < 131072; i++) {
    a = (a + (i & 1)) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out.push(adler >>> 24, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(out);
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();

/** 글자 → 글자 코드 (BMP 밖 글자는 D800부터 배정) */
class CodeMap {
  astral = new Map<number, number>();
  next = 0xd800;
  encode(s: string): string {
    let h = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x10000) {
        h += hex4(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
        continue;
      }
      let c = this.astral.get(cp);
      if (c === undefined) {
        c = this.next <= 0xdfff ? this.next++ : 0xfffd;
        if (c !== 0xfffd) this.astral.set(cp, c);
      }
      h += hex4(c);
    }
    return h;
  }
  toUnicode(): string {
    const lines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /SlideLab-UCS def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    lines.push('2 beginbfrange', '<0000> <D7FF> <0000>', '<E000> <FFFF> <E000>', 'endbfrange');
    const astral = [...this.astral];
    for (let i = 0; i < astral.length; i += 100) {
      const part = astral.slice(i, i + 100);
      lines.push(`${part.length} beginbfchar`);
      for (const [cp, c] of part) {
        const u = cp - 0x10000;
        lines.push(`<${hex4(c)}> <${hex4(0xd800 + (u >> 10))}${hex4(0xdc00 + (u & 0x3ff))}>`);
      }
      lines.push('endbfchar');
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    return lines.join('\n');
  }
}

/** 페이지의 글자 층 내용 (보이지 않음, 3 Tr) */
function textLayer(p: PdfPage, codes: CodeMap): string {
  const ops: string[] = [];
  for (const r of p.text ?? []) {
    const chars = [...r.text];
    if (!chars.length || r.height <= 0 || r.width <= 0) continue;
    const size = r.height;
    // 글기준선: 글꼴 상자(ASC..DESC = 글자 크기)가 줄 상자와 겹치도록 아래에서 DESC만큼 올림
    const baseline = p.height - (r.y + r.height) - (DESC / EM) * size;
    if (r.boxes && r.boxes.length === chars.length) {
      // 글자마다 제자리·제폭 (라틴 글자와 한글처럼 폭이 다른 글자가 섞여도 선택 영역이 그림과 맞음)
      const parts = [`/F1 ${num(size)} Tf`];
      chars.forEach((ch, k) => {
        const [x0, x1] = r.boxes![k];
        if (!(x1 > x0)) return;
        parts.push(`${num((100 * (x1 - x0)) / ((size * ADV) / EM))} Tz 1 0 0 1 ${num(x0)} ${num(baseline)} Tm <${codes.encode(ch)}> Tj`);
      });
      ops.push(parts.join('\n'));
      continue;
    }
    const natural = (chars.length * size * ADV) / EM;
    const tz = (100 * r.width) / natural;
    ops.push(`/F1 ${num(size)} Tf ${num(tz)} Tz 1 0 0 1 ${num(r.x)} ${num(baseline)} Tm <${codes.encode(r.text)}> Tj`);
  }
  return ops.length ? `BT 3 Tr\n${ops.join('\n')}\nET` : '';
}

export function buildPdf(pages: PdfPage[], info: PdfInfo = {}, now = new Date()): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: string | Uint8Array) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const obj = (id: number, body: string | (() => void)) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  const stream = (dict: string, data: Uint8Array) => () => {
    push(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    push(data);
    push('\nendstream');
  };
  const codes = new CodeMap();
  const layers = pages.map((p) => textLayer(p, codes));
  const hasText = layers.some((l) => l);
  // 번호: 1 카탈로그, 2 페이지 목록, 3 정보, (글자 층이 있으면 4–9 글꼴), 그 뒤 페이지마다 [페이지, 내용, 그림]
  const first = hasText ? 10 : 4;
  const pageIds = pages.map((_, i) => first + i * 3);
  chunks.push(new Uint8Array([...enc.encode('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  length = chunks[0].length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  obj(3, `<< /Producer (SlideLab) /CreationDate (${pdfDate(now)})${info.title ? ` /Title ${pdfString(info.title)}` : ''}${info.author ? ` /Author ${pdfString(info.author)}` : ''} >>`);
  if (hasText) {
    const font = glyphlessFont();
    obj(4, '<< /Type /Font /Subtype /Type0 /BaseFont /SlideLabTextLayer /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 9 0 R >>');
    obj(5, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SlideLabTextLayer /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW ${ADV} /CIDToGIDMap 8 0 R >>`);
    obj(6, `<< /Type /FontDescriptor /FontName /SlideLabTextLayer /Flags 5 /FontBBox [0 ${DESC} ${ADV} ${ASC}] /ItalicAngle 0 /Ascent ${ASC} /Descent ${DESC} /CapHeight ${ASC} /StemV 80 /FontFile2 7 0 R >>`);
    obj(7, stream(`/Length1 ${font.length}`, font));
    obj(8, stream('/Filter /FlateDecode', cidToGid1Stream()));
    obj(9, stream('', enc.encode(codes.toUnicode())));
  }
  pages.forEach((p, i) => {
    const id = pageIds[i];
    const content = `q ${num(p.width)} 0 0 ${num(p.height)} 0 0 cm /Im0 Do Q${layers[i] ? `\n${layers[i]}` : ''}`;
    const fonts = layers[i] ? ' /Font << /F1 4 0 R >>' : '';
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >>${fonts} >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, stream('', enc.encode(content)));
    obj(id + 2, stream(`/Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.jpeg));
  });
  const xref = length;
  const count = first + pages.length * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += offsets[i] === undefined ? '0000000000 65535 f \n' : `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** JPEG 픽셀 크기 (SOF 표지에서) */
export function jpegSize(b: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  throw new Error('JPEG 크기를 읽지 못했습니다.');
}
