/**
 * 최소 PDF 작성기 (PDF 1.7): 페이지마다 JPEG 그림 하나 (DCTDecode 그대로 넣음).
 * 슬라이드를 그림으로 바꾼 PDF 파일을 바로 내려받을 때 쓴다. 글자를 선택·검색할 수 있는 벡터 PDF는 인쇄(브라우저 PDF로 저장)로 만든다.
 */

export interface PdfPage {
  /** 페이지 크기 (pt, 1pt = 1/72in) */
  width: number;
  height: number;
  jpeg: Uint8Array;
  /** 그림 픽셀 크기 */
  pixelWidth: number;
  pixelHeight: number;
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
  // 번호: 1 카탈로그, 2 페이지 목록, 3 정보, 그 뒤 페이지마다 [페이지, 내용, 그림]
  const pageIds = pages.map((_, i) => 4 + i * 3);
  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'.replace(/[\u0080-ÿ]/g, (c) => c)); // 이진 표시 (아래에서 바이트로 다시 씀)
  chunks[0] = new Uint8Array([...enc.encode('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  length = chunks[0].length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  obj(3, `<< /Producer (SlideLab) /CreationDate (${pdfDate(now)})${info.title ? ` /Title ${pdfString(info.title)}` : ''}${info.author ? ` /Author ${pdfString(info.author)}` : ''} >>`);
  pages.forEach((p, i) => {
    const id = pageIds[i];
    const content = `q ${num(p.width)} 0 0 ${num(p.height)} 0 0 cm /Im0 Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const xref = length;
  const count = 4 + pages.length * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
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
