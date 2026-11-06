/**
 * 글꼴 파일 정보 읽기 (TrueType/OpenType/TTC, WOFF): name 표의 글꼴 이름, OS/2 표의 굵기·기울임·포함 권한.
 * WOFF2는 Brotli 압축이라 브라우저에서 표를 직접 읽지 않고, 파일 이름에서 추정한다 (사용자가 이름을 고칠 수 있음).
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

/** sfnt 표 목록 → 표 이름별 바이트 */
async function tables(buf: ArrayBuffer, format: FontFormat): Promise<Map<string, DataView>> {
  const v = new DataView(buf);
  const out = new Map<string, DataView>();
  if (format === 'woff') {
    const num = v.getUint16(12);
    for (let i = 0; i < num; i++) {
      const o = 44 + i * 20;
      const t = tag(v, o);
      if (t !== 'name' && t !== 'OS/2') continue;
      const offset = v.getUint32(o + 4);
      const compLength = v.getUint32(o + 8);
      const origLength = v.getUint32(o + 12);
      const raw = new Uint8Array(buf, offset, compLength);
      if (compLength === origLength) out.set(t, new DataView(buf, offset, compLength));
      else out.set(t, new DataView(await inflate(raw)));
    }
    return out;
  }
  let base = 0;
  if (format === 'collection') base = v.getUint32(12); // 첫 글꼴
  const num = v.getUint16(base + 4);
  for (let i = 0; i < num; i++) {
    const o = base + 12 + i * 16;
    const t = tag(v, o);
    if (t === 'name' || t === 'OS/2') out.set(t, new DataView(buf, v.getUint32(o + 8), v.getUint32(o + 12)));
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
  if (!format) throw new Error(`${fileName}: 글꼴 파일(.ttf, .otf, .woff, .woff2)이 아닙니다.`);
  const guess = guessFromFileName(fileName);
  if (format === 'woff2') return { format, family: guess.family, localNames: [], subfamily: guess.subfamily, weight: guess.weight, italic: guess.italic, embedding: 'unknown', guessed: true };
  const t = await tables(buf, format);
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
