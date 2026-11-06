/**
 * EOT(Embedded OpenType) 읽기·쓰기 — PPTX의 포함 글꼴(ppt/fonts/*.fntdata) 형식.
 * - 쓰기: LibreOffice(vcl/source/font/EOTConverter.cxx)와 같은 방식 — 버전 0x00020002, 압축·암호화 없음, 이름은 name 표의 영어 유니코드 이름
 * - 읽기: 버전 1/2/3, XOR 암호화(0x50), MTX 압축(PowerPoint가 쓰는 형식, mtx/ 디코더)
 * W3C EOT 제출 문서(https://www.w3.org/Submission/EOT/)의 헤더 구조를 따른다 (리틀 엔디언).
 */
import { unpackMtx } from './mtx/lzcomp';
import { ctfToTtf } from './mtx/ctf';

const TTEMBED_TTCOMPRESSED = 0x4;
const TTEMBED_XORENCRYPTDATA = 0x10000000;

export interface EotFont {
  ttf: Uint8Array;
  familyName: string;
  styleName: string;
  fullName: string;
  weight: number;
  italic: boolean;
  /** OS/2 fsType (포함 권한) */
  fsType: number;
  compressed: boolean;
}

/* ───────────── sfnt 표 읽기 도우미 ───────────── */

export function sfntTables(ttf: Uint8Array): Map<string, DataView> {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = v.getUint16(4);
  const out = new Map<string, DataView>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const off = v.getUint32(o + 8);
    const len = v.getUint32(o + 12);
    if (off + len <= ttf.byteLength) out.set(tag, new DataView(ttf.buffer, ttf.byteOffset + off, len));
  }
  return out;
}

/** name 표에서 영어(Windows, 0x409) 유니코드 문자열 */
export function englishName(name: DataView | undefined, id: number): string | null {
  if (!name) return null;
  const count = name.getUint16(2);
  const strOff = name.getUint16(4);
  let fallback: string | null = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = name.getUint16(o);
    const lang = name.getUint16(o + 4);
    if (name.getUint16(o + 6) !== id || (platform !== 3 && platform !== 0)) continue;
    const len = name.getUint16(o + 8);
    const off = strOff + name.getUint16(o + 10);
    if (off + len > name.byteLength) continue;
    let s = '';
    for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(name.getUint16(off + k));
    if (platform === 3 && lang === 0x409) return s;
    fallback ??= s;
  }
  return fallback;
}

/* ───────────── 쓰기 ───────────── */

/** TrueType/OpenType(sfnt) → EOT (압축 없음) */
export function ttfToEot(ttf: Uint8Array): Uint8Array {
  const t = sfntTables(ttf);
  const os2 = t.get('OS/2');
  const head = t.get('head');
  const name = t.get('name');
  const header = new Uint8Array(80);
  const h = new DataView(header.buffer);
  h.setUint32(4, ttf.byteLength, true); // FontDataSize
  h.setUint32(8, 0x00020002, true); // Version
  h.setUint32(12, 0, true); // Flags: 압축·암호화 없음
  if (os2 && os2.byteLength >= 78) {
    for (let i = 0; i < 10; i++) header[16 + i] = os2.getUint8(32 + i); // PANOSE
    header[26] = 0; // Charset (LibreOffice와 같음)
    header[27] = os2.getUint16(62) & 0x01; // Italic
    h.setUint32(28, os2.getUint16(4), true); // Weight
    h.setUint16(32, os2.getUint16(8), true); // fsType
    for (let i = 0; i < 4; i++) h.setUint32(36 + i * 4, os2.getUint32(42 + i * 4), true); // UnicodeRange1-4
    if (os2.getUint16(0) >= 1 && os2.byteLength >= 86) {
      h.setUint32(52, os2.getUint32(78), true); // CodePageRange1
      h.setUint32(56, os2.getUint32(82), true); // CodePageRange2
    }
  }
  h.setUint16(34, 0x504c, true); // MagicNumber
  if (head && head.byteLength >= 12) h.setUint32(60, head.getUint32(8), true); // CheckSumAdjustment
  const parts: number[] = Array.from(header);
  const str = (id: number) => {
    parts.push(0, 0); // Padding
    const s = englishName(name, id);
    if (s === null) {
      parts.push(0, 0);
      return;
    }
    const size = s.length * 2 + 2; // 끝의 null 포함 (LibreOffice와 같음)
    parts.push(size & 0xff, size >> 8);
    for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
    parts.push(0, 0);
  };
  str(1); // FamilyName
  str(2); // StyleName
  str(5); // VersionName
  str(4); // FullName
  parts.push(0, 0); // Padding5
  parts.push(0, 0); // RootStringSize
  parts.push(0x42, 0x53, 0x47, 0x50); // RootStringCheckSum (크기 0일 때)
  parts.push(0xe4, 0x04, 0x00, 0x00); // EUDCCodePage (1252)
  parts.push(0, 0); // Padding6
  parts.push(0, 0); // SignatureSize
  parts.push(0, 0, 0, 0); // EUDCFlags
  parts.push(0, 0, 0, 0); // EUDCFontSize
  const out = new Uint8Array(parts.length + ttf.byteLength);
  out.set(parts);
  out.set(ttf, parts.length);
  new DataView(out.buffer).setUint32(0, out.byteLength, true); // EOTSize
  return out;
}

/* ───────────── 읽기 ───────────── */

export function readEot(bytes: Uint8Array): EotFont {
  if (bytes.byteLength < 82) throw new Error('EOT 파일이 너무 짧습니다.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eotSize = v.getUint32(0, true);
  const fontDataSize = v.getUint32(4, true);
  const version = v.getUint32(8, true);
  const flags = v.getUint32(12, true);
  if (![0x00010000, 0x00020001, 0x00020002].includes(version)) throw new Error(`지원하지 않는 EOT 버전입니다 (0x${version.toString(16)}).`);
  if (v.getUint16(34, true) !== 0x504c) throw new Error('EOT 파일이 손상되었습니다 (MagicNumber).');
  if (eotSize > bytes.byteLength || fontDataSize > eotSize) throw new Error('EOT 파일이 잘렸습니다.');
  // 이름 문자열 (Padding 2 + Size 2 + UTF-16LE)
  let p = 80;
  const names: string[] = [];
  for (let k = 0; k < 4; k++) {
    p += 2;
    const size = v.getUint16(p, true);
    p += 2;
    let s = '';
    for (let i = 0; i + 1 < size; i += 2) s += String.fromCharCode(v.getUint16(p + i, true));
    names.push(s.replace(/\0+$/, ''));
    p += size;
  }
  let data = bytes.slice(eotSize - fontDataSize, eotSize);
  if (flags & TTEMBED_XORENCRYPTDATA) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  const compressed = !!(flags & TTEMBED_TTCOMPRESSED);
  if (compressed) data = ctfToTtf(unpackMtx(data)) as Uint8Array<ArrayBuffer>;
  return {
    ttf: data,
    familyName: names[0],
    styleName: names[1],
    fullName: names[3],
    weight: v.getUint32(28, true),
    italic: bytes[27] === 1,
    fsType: v.getUint16(32, true),
    compressed,
  };
}
