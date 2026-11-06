/**
 * 글꼴 파일 정보 읽기 (TrueType/OpenType/TTC, WOFF, WOFF2): name 표의 글꼴 이름, OS/2 표의 굵기·기울임·포함 권한.
 * 형식 변환: WOFF → sfnt(표 다시 조립), WOFF2 → sfnt(woff2-encoder의 WebAssembly 복원기, 필요할 때만 불러옴),
 * TTC(글꼴 모음) → 글꼴마다 독립된 sfnt 파일.
 */

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2' | 'collection';

export interface FontInfo {
  format: FontFormat;
  /** 영어(또는 첫) 글꼴 패밀리 이름 */
  family: string;
  /** 다른 언어 이름 (예: 한국어 '맑은 고딕') */
  localNames: string[];
  subfamily: string;
  /** 100~900 */
  weight: number;
  italic: boolean;
  /** OS/2 fsType: 0 = 설치 가능, 2 = 포함 제한 */
  embedding: 'installable' | 'restricted' | 'preview' | 'editable' | 'unknown';
  /** 정보를 파일 이름에서 추정했는지 */
  guessed: boolean;
}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function detectFormat(buf: ArrayBuffer): FontFormat | null {
  if (buf.byteLength < 12) return null;
  const t = tag(new DataView(buf), 0);
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'OTTO') return 'opentype';
  if (t === 'ttcf') return 'collection';
  if (t === 'true' || new DataView(buf).getUint32(0) === 0x00010000) return 'truetype';
  return null;
}

/* ───────────── sfnt 조립 / 변환 ───────────── */

function checksum(data: Uint8Array): number {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const w = ((data[i] << 24) | ((i + 1 < n ? data[i + 1] : 0) << 16) | ((i + 2 < n ? data[i + 2] : 0) << 8) | (i + 3 < n ? data[i + 3] : 0)) >>> 0;
    sum = (sum + w) >>> 0;
  }
  return sum;
}

/** 표 목록 → sfnt 파일 (표 디렉터리, 4바이트 정렬, 체크섬, head.checkSumAdjustment) */
export function buildSfnt(flavor: number, tableList: { tag: string; data: Uint8Array }[]): Uint8Array {
  const list = [...tableList].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = list.length;
  let size = 12 + n * 16;
  for (const t of list) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, flavor);
  v.setUint16(4, n);
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  v.setUint16(6, (1 << es) * 16);
  v.setUint16(8, es);
  v.setUint16(10, n * 16 - (1 << es) * 16);
  let off = 12 + n * 16;
  let headOff = -1;
  list.forEach((t, i) => {
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[d + k] = t.tag.charCodeAt(k);
    let data = t.data;
    if (t.tag === 'head' && data.length >= 12) {
      data = data.slice();
      data.fill(0, 8, 12); // checkSumAdjustment은 마지막에 계산
      headOff = off;
    }
    v.setUint32(d + 4, checksum(data));
    v.setUint32(d + 8, off);
    v.setUint32(d + 12, data.length);
    out.set(data, off);
    off += (data.length + 3) & ~3;
  });
  if (headOff >= 0) v.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** WOFF → sfnt */
export async function woffToSfnt(buf: ArrayBuffer): Promise<Uint8Array> {
  const v = new DataView(buf);
  const flavor = v.getUint32(4);
  const num = v.getUint16(12);
  const list: { tag: string; data: Uint8Array }[] = [];
  for (let i = 0; i < num; i++) {
    const o = 44 + i * 20;
    const offset = v.getUint32(o + 4);
    const compLength = v.getUint32(o + 8);
    const origLength = v.getUint32(o + 12);
    const raw = new Uint8Array(buf, offset, compLength);
    const data = compLength === origLength ? raw : new Uint8Array(await inflate(raw));
    if (data.length !== origLength) throw new Error('WOFF 표의 길이가 맞지 않습니다.');
    list.push({ tag: tag(v, o), data });
  }
  return buildSfnt(flavor, list);
}

/** WOFF2 → sfnt (Brotli + 표 변환; WebAssembly 복원기는 처음 쓸 때 불러옴) */
export async function woff2ToSfnt(buf: ArrayBuffer): Promise<Uint8Array> {
  const { default: decompress } = await import('woff2-encoder/decompress');
  return decompress(new Uint8Array(buf));
}

/** TTC(글꼴 모음) → 글꼴마다 독립된 sfnt */
export function splitCollection(buf: ArrayBuffer): Uint8Array[] {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const count = v.getUint32(8);
  if (count > 256) throw new Error('글꼴 모음의 글꼴 수가 너무 많습니다.');
  const faces: Uint8Array[] = [];
  for (let f = 0; f < count; f++) {
    const base = v.getUint32(12 + f * 4);
    const num = v.getUint16(base + 4);
    const list: { tag: string; data: Uint8Array }[] = [];
    for (let i = 0; i < num; i++) {
      const o = base + 12 + i * 16;
      const off = v.getUint32(o + 8);
      const len = v.getUint32(o + 12);
      if (off + len > buf.byteLength) throw new Error('글꼴 모음 파일이 손상되었습니다.');
      list.push({ tag: tag(v, o), data: bytes.subarray(off, off + len) });
    }
    faces.push(buildSfnt(v.getUint32(base), list));
  }
  return faces;
}

/** 어떤 글꼴 파일이든 sfnt(TrueType/OpenType) 글꼴 목록으로 (모음이면 여러 개) */
export async function toSfntFaces(buf: ArrayBuffer): Promise<Uint8Array[]> {
  const format = detectFormat(buf);
  if (format === 'woff') return [await woffToSfnt(buf)];
  if (format === 'woff2') return [await woff2ToSfnt(buf)];
  if (format === 'collection') return splitCollection(buf);
  if (format) return [new Uint8Array(buf)];
  throw new Error('글꼴 파일이 아닙니다.');
}

/** TrueType 윤곽선(glyf)인지 — PPTX(EOT) 포함은 TrueType 윤곽선만 가능 */
export function hasTrueTypeOutlines(sfnt: Uint8Array): boolean {
  return sfntTableMap(sfnt).has('glyf');
}

/** sfnt 표 목록 → 표 이름별 바이트 */
function sfntTableMap(sfnt: Uint8Array): Map<string, DataView> {
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const out = new Map<string, DataView>();
  const num = v.getUint16(4);
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const off = v.getUint32(o + 8);
    const len = v.getUint32(o + 12);
    if (off + len <= sfnt.byteLength) out.set(tag(v, o), new DataView(sfnt.buffer, sfnt.byteOffset + off, len));
  }
  return out;
}

/** WOFF 표는 zlib(deflate) 압축 */
async function inflate(data: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

interface NameRec {
  platform: number;
  lang: number;
  id: number;
  value: string;
}

function readNames(v: DataView): NameRec[] {
  const count = v.getUint16(2);
  const strOff = v.getUint16(4);
  const recs: NameRec[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = v.getUint16(o);
    const encoding = v.getUint16(o + 2);
    const lang = v.getUint16(o + 4);
    const id = v.getUint16(o + 6);
    const len = v.getUint16(o + 8);
    const off = strOff + v.getUint16(o + 10);
    if (off + len > v.byteLength) continue;
    let value = '';
    if (platform === 3 || platform === 0) {
      for (let k = 0; k + 1 < len; k += 2) value += String.fromCharCode(v.getUint16(off + k));
    } else if (platform === 1 && encoding === 0) {
      for (let k = 0; k < len; k++) value += String.fromCharCode(v.getUint8(off + k));
    } else continue;
    recs.push({ platform, lang, id, value: value.replace(/\0/g, '').trim() });
  }
  return recs;
}

const SUBFAMILY_WEIGHT: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra[-\s]?light|ultra[-\s]?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi[-\s]?bold|demi[-\s]?bold/i, 600],
  [/extra[-\s]?bold|ultra[-\s]?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

export function weightFromName(name: string): number {
  for (const [re, w] of SUBFAMILY_WEIGHT) if (re.test(name)) return w;
  return 400;
}

/** 파일 이름 → 패밀리/스타일 추정: "NanumGothic-ExtraBold.woff2" → "NanumGothic", 800 */
export function guessFromFileName(fileName: string): { family: string; weight: number; italic: boolean; subfamily: string } {
  const base = fileName.replace(/\.(ttf|otf|ttc|woff2?|)$/i, '');
  const m = base.match(/^(.*?)[-_ ]?((?:thin|hairline|extra[-_ ]?light|ultra[-_ ]?light|light|regular|book|normal|medium|semi[-_ ]?bold|demi[-_ ]?bold|extra[-_ ]?bold|ultra[-_ ]?bold|bold|black|heavy)?[-_ ]?(?:italic|oblique)?)$/i);
  const family = (m?.[1] || base).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || base;
  const sub = m?.[2]?.replace(/[-_]/g, ' ').trim() || 'Regular';
  return { family, weight: weightFromName(sub), italic: /italic|oblique/i.test(sub), subfamily: sub };
}

export async function readFontInfo(buf: ArrayBuffer, fileName: string): Promise<FontInfo> {
  const format = detectFormat(buf);
  if (!format) throw new Error(`${fileName}: 글꼴 파일(.ttf, .otf, .ttc, .woff, .woff2)이 아닙니다.`);
  let sfnt: Uint8Array;
  try {
    sfnt = (await toSfntFaces(buf))[0];
  } catch {
    throw new Error(`${fileName}: 글꼴 파일이 손상되었습니다.`);
  }
  return { ...sfntInfo(sfnt, fileName), format };
}

/** sfnt 한 글꼴의 정보 */
export function sfntInfo(sfnt: Uint8Array, fileName: string): FontInfo {
  const guess = guessFromFileName(fileName);
  const format: FontFormat = new DataView(sfnt.buffer, sfnt.byteOffset).getUint32(0) === 0x4f54544f ? 'opentype' : 'truetype';
  const t = sfntTableMap(sfnt);
  const nameView = t.get('name');
  const names = nameView ? readNames(nameView) : [];
  const pick = (id: number) => {
    const c = names.filter((n) => n.id === id);
    return c.find((n) => n.platform === 3 && n.lang === 0x409) ?? c.find((n) => n.platform === 3) ?? c[0];
  };
  // 글꼴 패밀리: 16(타이포그래픽) 우선, 없으면 1
  const fam = pick(16) ?? pick(1);
  const sub = pick(17) ?? pick(2);
  const famIds = names.filter((n) => n.id === (pick(16) ? 16 : 1)).map((n) => n.value);
  const family = fam?.value || guess.family;
  const localNames = [...new Set(famIds.filter((n) => n && n !== family))];
  let weight = weightFromName(sub?.value ?? '');
  let italic = /italic|oblique/i.test(sub?.value ?? '');
  let embedding: FontInfo['embedding'] = 'unknown';
  const os2 = t.get('OS/2');
  if (os2 && os2.byteLength >= 64) {
    const w = os2.getUint16(4);
    if (w >= 100 && w <= 1000) weight = Math.round(w / 100) * 100;
    italic = italic || (os2.getUint16(62) & 0x01) === 1;
    const fsType = os2.getUint16(8) & 0x000f;
    embedding = fsType === 0 ? 'installable' : fsType & 0x0002 ? 'restricted' : fsType & 0x0008 ? 'editable' : fsType & 0x0004 ? 'preview' : 'unknown';
  }
  return { format, family, localNames, subfamily: sub?.value || (italic ? 'Italic' : 'Regular'), weight, italic, embedding, guessed: !fam };
}
