import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { readEot, sfntTables, ttfToEot } from './eot';
import { unpackMtx } from './mtx/lzcomp';
import { ctfToTtf } from './mtx/ctf';

const fx = (name: string) => new Uint8Array(readFileSync(`src/services/fonts/__fixtures__/${name}`));

async function boldonseFntdata() {
  const zip = await JSZip.loadAsync(fx('Boldonse.pptx'));
  return zip.file('ppt/fonts/font1.fntdata')!.async('uint8array');
}

const bytesOf = (v: DataView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** glyf 표에서 글리프 i의 바이트 */
function glyph(t: Map<string, DataView>, i: number): Uint8Array {
  const head = t.get('head')!;
  const loca = t.get('loca')!;
  const long = head.getInt16(50) === 1;
  const at = (k: number) => (long ? loca.getUint32(k * 4) : loca.getUint16(k * 2) * 2);
  const g = bytesOf(t.get('glyf')!);
  return g.subarray(at(i), at(i + 1));
}

describe('EOT / MTX', () => {
  it('PowerPoint의 MTX 압축 EOT(Boldonse)를 TTF로 복원 — libeot 결과와 표 단위로 같음', async () => {
    const eot = readEot(await boldonseFntdata());
    expect(eot).toMatchObject({ familyName: 'Boldonse', styleName: 'Regular', compressed: true });
    const ref = sfntTables(fx('Boldonse.libeot.ttf'));
    const mine = sfntTables(eot.ttf);
    // libeot도 hdmx·VDMX는 버림
    expect([...mine.keys()].sort()).toEqual([...ref.keys()].sort());
    for (const tag of mine.keys()) {
      if (tag === 'glyf' || tag === 'loca' || tag === 'head') continue;
      expect(bytesOf(mine.get(tag)!), tag).toEqual(bytesOf(ref.get(tag)!));
    }
    // head: checkSumAdjustment(8..12)만 다를 수 있음
    const h1 = bytesOf(mine.get('head')!), h2 = bytesOf(ref.get('head')!);
    expect([...h1.subarray(0, 8), ...h1.subarray(12)]).toEqual([...h2.subarray(0, 8), ...h2.subarray(12)]);
    // 글리프: 설치된 구버전 libeot는 합성 글리프의 명령어 길이(numInstr)를 빠뜨린다 → 그 2바이트만 차이
    const numGlyphs = mine.get('maxp')!.getUint16(4);
    let composite = 0;
    for (let i = 0; i < numGlyphs; i++) {
      const a = glyph(mine, i), b = glyph(ref, i);
      if (a.length === 0 || new DataView(a.buffer, a.byteOffset).getInt16(0) >= 0) {
        expect(a, `glyph ${i}`).toEqual(b);
        continue;
      }
      // 합성 글리프: 우리 쪽은 [구성요소…][numInstr 2바이트][명령어], 참조는 numInstr가 빠짐
      composite++;
      if (a.length === b.length) {
        expect(a).toEqual(b);
        continue;
      }
      let k = 0;
      while (a[k] === b[k]) k++;
      expect(a.length - b.length, `glyph ${i}`).toBe(2);
      expect([...a.subarray(0, k), ...a.subarray(k + 2)], `glyph ${i}`).toEqual([...b]);
    }
    expect(composite).toBeGreaterThan(0);
  });

  it('LZCOMP 블록 3개가 올바른 길이로 풀림', async () => {
    const f = await boldonseFntdata();
    const v = new DataView(f.buffer, f.byteOffset);
    const size = v.getUint32(0, true), dataSize = v.getUint32(4, true);
    const [a, b, c] = unpackMtx(f.subarray(size - dataSize, size));
    expect([a.length, b.length, c.length]).toEqual([51924, 6938, 7986]);
    expect(ctfToTtf([a, b, c]).length).toBeGreaterThan(70000);
  });

  it('TTF → EOT(LibreOffice 방식) → 다시 읽기', () => {
    const ttf = fx('TestSerif-BoldItalic.ttf');
    const eot = ttfToEot(ttf);
    const v = new DataView(eot.buffer);
    expect(v.getUint32(0, true)).toBe(eot.length);
    expect(v.getUint32(8, true)).toBe(0x00020002);
    expect(v.getUint16(34, true)).toBe(0x504c);
    const back = readEot(eot);
    expect(back).toMatchObject({ familyName: 'SlideLab Test Serif', styleName: 'Bold Italic', weight: 700, italic: true, compressed: false });
    expect(back.ttf).toEqual(ttf);
  });

  it('XOR 암호화 플래그 처리, 손상된 파일 거부', () => {
    const ttf = fx('TestSerif-Regular.ttf');
    const eot = ttfToEot(ttf);
    const hdr = eot.length - ttf.length;
    new DataView(eot.buffer).setUint32(12, 0x10000000, true);
    for (let i = hdr; i < eot.length; i++) eot[i] ^= 0x50;
    expect(readEot(eot).ttf).toEqual(ttf);
    expect(() => readEot(new Uint8Array(100))).toThrow();
  });
});
