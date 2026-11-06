/**
 * PPTX 포함 글꼴 (PowerPoint: 파일 › 옵션 › 저장 › "파일의 글꼴 포함").
 * - 내보내기: 문서에 쓰인 '내 글꼴'(직접 추가했거나 오프라인 보관한 글꼴)을 EOT(.fntdata)로 변환해 넣는다.
 *   글꼴 하나당 보통/굵게/기울임/굵은 기울임 4가지 스타일까지 (PowerPoint와 같은 구조: p:embeddedFont).
 * - 가져오기: p:embeddedFontLst의 .fntdata(압축 안 된 EOT, MTX 압축 EOT, XOR 암호화)를 TTF로 복원.
 * 포함이 제한된 글꼴(OS/2 fsType 2, 비트맵 전용 0x200)과 TrueType 윤곽선이 아닌 글꼴(CFF .otf)은 넣지 않는다.
 */
import { readEot, sfntTables, ttfToEot } from './eot';
import { hasTrueTypeOutlines, sfntInfo, toSfntFaces } from './sfnt';

export type FontSlot = 'regular' | 'bold' | 'italic' | 'boldItalic';
export const FONT_SLOTS: FontSlot[] = ['regular', 'bold', 'italic', 'boldItalic'];

export interface EmbedPlanFont {
  /** 문서의 글자에 쓰인 글꼴 이름 (p:font typeface) */
  typeface: string;
  /** 스타일별 EOT 바이트 */
  faces: Partial<Record<FontSlot, Uint8Array>>;
}

export interface EmbedSource {
  family: string;
  aliases: string[];
  weight: number;
  italic: boolean;
  data: Blob | ArrayBuffer | Uint8Array;
}

export const slotOf = (weight: number, italic: boolean): FontSlot => (weight >= 600 ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular');

/** 포함 권한: OS/2 fsType (OpenType 명세) */
export function embeddingAllowed(ttf: Uint8Array): boolean {
  const os2 = sfntTables(ttf).get('OS/2');
  if (!os2 || os2.byteLength < 10) return true;
  const fsType = os2.getUint16(8);
  if (fsType & 0x0200) return false; // 비트맵만 포함 가능
  // 0x0002 제한 라이선스 — 다른 권한 비트(4/8)가 함께 있으면 그 권한을 따름
  return !((fsType & 0x000f) === 0x0002);
}

async function bytesOf(d: EmbedSource['data']): Promise<ArrayBuffer> {
  if (d instanceof Uint8Array) return d.slice().buffer as ArrayBuffer;
  if (d instanceof ArrayBuffer) return d;
  return d.arrayBuffer();
}

/**
 * 쓰인 글꼴 이름 목록 + 내 글꼴 → 포함할 글꼴.
 * skipped: 넣지 못한 글꼴과 이유 (보고용)
 */
export async function planEmbeddedFonts(used: string[], sources: EmbedSource[]): Promise<{ fonts: EmbedPlanFont[]; skipped: string[]; bytes: number }> {
  const fonts: EmbedPlanFont[] = [];
  const skipped: string[] = [];
  let bytes = 0;
  const seen = new Set<string>();
  for (const name of used) {
    const low = name.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    const recs = sources.filter((s) => s.family.toLowerCase() === low || s.aliases.some((a) => a.toLowerCase() === low));
    if (!recs.length) continue;
    // 스타일마다 가장 가까운 굵기 (보통 400, 굵게 700)
    const best = new Map<FontSlot, EmbedSource>();
    for (const r of recs) {
      const slot = slotOf(r.weight, r.italic);
      const target = slot === 'bold' || slot === 'boldItalic' ? 700 : 400;
      const cur = best.get(slot);
      if (!cur || Math.abs(r.weight - target) < Math.abs(cur.weight - target)) best.set(slot, r);
    }
    const plan: EmbedPlanFont = { typeface: name, faces: {} };
    for (const slot of FONT_SLOTS) {
      const r = best.get(slot);
      if (!r) continue;
      let ttf: Uint8Array;
      try {
        ttf = (await toSfntFaces(await bytesOf(r.data)))[0];
      } catch {
        skipped.push(`${name}: 글꼴 파일을 읽지 못했습니다.`);
        continue;
      }
      if (!hasTrueTypeOutlines(ttf)) {
        skipped.push(`${name}: PostScript(CFF) 윤곽선 글꼴은 PowerPoint 파일에 포함할 수 없습니다.`);
        break;
      }
      if (!embeddingAllowed(ttf)) {
        skipped.push(`${name}: 글꼴 제작사가 문서 포함을 허용하지 않은 글꼴입니다.`);
        break;
      }
      const eot = ttfToEot(ttf);
      bytes += eot.byteLength;
      plan.faces[slot] = eot;
    }
    if (Object.keys(plan.faces).length) fonts.push(plan);
  }
  return { fonts, skipped: [...new Set(skipped)], bytes };
}

export interface ImportedEmbeddedFont {
  /** p:font typeface (문서가 쓰는 이름) */
  typeface: string;
  /** 글꼴 파일 안의 패밀리 이름 */
  family: string;
  aliases: string[];
  weight: number;
  italic: boolean;
  ttf: Uint8Array;
}

/** .fntdata(EOT) → TTF + 정보. 스타일 칸(slot)이 굵기 정보보다 우선 */
export function decodeEmbeddedFont(typeface: string, slot: FontSlot, fntdata: Uint8Array): ImportedEmbeddedFont {
  const eot = readEot(fntdata);
  const info = sfntInfo(eot.ttf, `${typeface}.ttf`);
  const bold = slot === 'bold' || slot === 'boldItalic';
  const italic = slot === 'italic' || slot === 'boldItalic';
  // 칸과 굵기가 어긋나면 칸을 따름 (PowerPoint는 칸으로 스타일을 정함)
  const weight = bold ? (info.weight >= 600 ? info.weight : 700) : info.weight >= 600 ? 400 : info.weight;
  const aliases = [...new Set([info.family, ...info.localNames].filter((n) => n && n.toLowerCase() !== typeface.toLowerCase()))];
  return { typeface, family: typeface, aliases, weight, italic, ttf: eot.ttf };
}
