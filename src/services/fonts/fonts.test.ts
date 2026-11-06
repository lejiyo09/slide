import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { detectFormat, guessFromFileName, hasTrueTypeOutlines, readFontInfo, sfntInfo, toSfntFaces } from './sfnt';
import { WEB_FONTS, SYSTEM_FONTS, webFontCssUrl, isWebFont } from './catalog';
import { fontsUsed, replaceFontInDoc } from './docFonts';
import { createPresentation, createTextBox } from '../../core/document/factory';
import type { Presentation } from '../../types/model';

const fx = (name: string) => {
  const b = readFileSync(`src/services/fonts/__fixtures__/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('글꼴 파일 정보 읽기', () => {
  it('TTF: 영어/한국어 이름, 굵기, 기울임, 포함 권한', async () => {
    const r = await readFontInfo(fx('TestSerif-Regular.ttf'), 'TestSerif-Regular.ttf');
    expect(r).toMatchObject({ format: 'truetype', family: 'SlideLab Test Serif', weight: 400, italic: false, guessed: false });
    expect(r.localNames).toEqual(['슬라이드랩 테스트 명조']);
    expect(r.embedding).not.toBe('unknown');
    const b = await readFontInfo(fx('TestSerif-BoldItalic.ttf'), 'x.ttf');
    expect(b).toMatchObject({ family: 'SlideLab Test Serif', weight: 700, italic: true });
  });

  it('WOFF·WOFF2도 실제 name 표를 읽음 (파일 이름과 무관)', async () => {
    const w = await readFontInfo(fx('TestSerif-Regular.woff'), 'a.woff');
    expect(w).toMatchObject({ format: 'woff', family: 'SlideLab Test Serif', weight: 400, guessed: false });
    const w2 = await readFontInfo(fx('TestSerif-Regular.woff2'), 'NanumGothic-ExtraBold.woff2');
    expect(w2).toMatchObject({ format: 'woff2', family: 'SlideLab Test Serif', weight: 400, italic: false, guessed: false });
    expect(w2.localNames).toEqual(['슬라이드랩 테스트 명조']);
  });

  it('WOFF/WOFF2 → TTF 변환: 원본 TTF와 표 내용이 같음', async () => {
    const orig = new Uint8Array(fx('TestSerif-Regular.ttf'));
    const tablesOf = (b: Uint8Array) => {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const m = new Map<string, string>();
      for (let i = 0; i < v.getUint16(4); i++) {
        const o = 12 + i * 16;
        const t = String.fromCharCode(...b.subarray(o, o + 4));
        const d = b.subarray(v.getUint32(o + 8), v.getUint32(o + 8) + v.getUint32(o + 12));
        m.set(t, t === 'head' ? [...d.subarray(0, 8), ...d.subarray(12)].join() : d.join());
      }
      return m;
    };
    const fromWoff = (await toSfntFaces(fx('TestSerif-Regular.woff')))[0];
    expect(tablesOf(fromWoff)).toEqual(tablesOf(orig));
    const fromWoff2 = (await toSfntFaces(fx('TestSerif-Regular.woff2')))[0];
    // WOFF2는 glyf/loca를 변환 저장하므로 다시 만들어진 glyf/loca는 바이트가 다를 수 있음 → 나머지 표 비교
    const a = tablesOf(fromWoff2), b = tablesOf(orig);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    // head.flags 11번 비트: WOFF2 명세상 복원기가 켬 (변환된 글꼴 표시)
    const headFlags = (h: string) => h.split(',').map((x, i) => (i === 12 ? String(Number(x) & ~0x08) : x)).join();
    for (const k of a.keys()) if (k !== 'glyf' && k !== 'loca') expect(k === 'head' ? headFlags(a.get(k)!) : a.get(k), k).toBe(k === 'head' ? headFlags(b.get(k)!) : b.get(k));
    // 브라우저 없이도 결과가 올바른 sfnt인지: 체크섬 합 = 0xB1B0AFBA
    expect(hasTrueTypeOutlines(fromWoff2)).toBe(true);
  });

  it('TTC(글꼴 모음) → 글꼴마다 독립된 TTF', async () => {
    const buf = fx('TestSerif.ttc');
    expect(detectFormat(buf)).toBe('collection');
    const faces = await toSfntFaces(buf);
    expect(faces).toHaveLength(2);
    expect(sfntInfo(faces[0], 'x.ttc')).toMatchObject({ family: 'SlideLab Test Serif', weight: 400, italic: false });
    expect(sfntInfo(faces[1], 'x.ttc')).toMatchObject({ family: 'SlideLab Test Serif', weight: 700, italic: true });
    // 독립 파일의 checkSumAdjustment가 올바른지
    let sum = 0;
    const f = faces[1];
    for (let i = 0; i < f.length; i += 4) sum = (sum + (((f[i] << 24) | (f[i + 1] << 16) | (f[i + 2] << 8) | f[i + 3]) >>> 0)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it('형식 판별과 파일 이름 추정', async () => {
    expect(detectFormat(fx('TestSerif-Regular.woff2'))).toBe('woff2');
    expect(detectFormat(new TextEncoder().encode('hello world!!').buffer as ArrayBuffer)).toBeNull();
    await expect(readFontInfo(new TextEncoder().encode('not a font file').buffer as ArrayBuffer, 'a.txt')).rejects.toThrow(/글꼴 파일/);
    expect(guessFromFileName('Pretendard-SemiBold.otf')).toMatchObject({ family: 'Pretendard', weight: 600, italic: false });
    expect(guessFromFileName('OpenSans-BoldItalic.ttf')).toMatchObject({ family: 'Open Sans', weight: 700, italic: true });
    expect(guessFromFileName('MyFont.ttf')).toMatchObject({ family: 'My Font', weight: 400 });
  });
});

describe('글꼴 목록', () => {
  it('웹 글꼴: 한글 글꼴 포함, 이름 중복 없음, CSS 주소', () => {
    expect(WEB_FONTS.filter((f) => f.korean).length).toBeGreaterThanOrEqual(30);
    expect(new Set(WEB_FONTS.map((f) => f.family)).size).toBe(WEB_FONTS.length);
    expect(isWebFont('noto sans kr')).toBe(true);
    expect(webFontCssUrl('Noto Sans KR')).toBe('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:ital,wght@0,400;0,700;1,400;1,700&display=swap');
    expect(webFontCssUrl('Sunflower')).toContain('Sunflower:wght@300;500;700');
    expect(webFontCssUrl('Jua', 'Jua주아')).toBe('https://fonts.googleapis.com/css2?family=Jua&display=swap&text=Jua%EC%A3%BC%EC%95%84');
    // 400이 없는 글꼴은 미리 보기에도 축을 넣어야 함 (없으면 Google이 HTTP 400)
    expect(webFontCssUrl('Sunflower', 'Sunflower')).toBe('https://fonts.googleapis.com/css2?family=Sunflower:wght@300;500;700&display=swap&text=Sunflower');
    expect(SYSTEM_FONTS.some((f) => f.family === 'Malgun Gothic')).toBe(true);
  });
});

describe('문서의 글꼴', () => {
  const make = () =>
    produce(createPresentation(), (d) => {
      d.theme.fonts = { heading: 'Old Font', body: 'Malgun Gothic' };
      d.slides[0].objects.push(createTextBox({ x: 0, y: 0, text: '가', style: { fontFamily: 'Old Font' } }));
      d.slides[0].objects.push(createTextBox({ x: 0, y: 0, text: '나', style: { fontFamily: '@heading' } }));
      d.slides[0].objects.push(createTextBox({ x: 0, y: 0, text: '다', style: { fontFamily: 'Arial' } }));
    });
  it('사용 글꼴 (테마 토큰은 테마 글꼴로)', () => {
    const m = fontsUsed(make());
    expect(m.get('Old Font')).toBe(2);
    expect(m.get('Arial')).toBe(1);
    expect(m.has('Malgun Gothic')).toBe(true);
  });
  it('글꼴 바꾸기: 글자와 테마 글꼴 모두 (마스터·레이아웃 포함)', () => {
    let n = 0;
    const out = produce(make(), (d) => void (n = replaceFontInDoc(d as Presentation, 'old font', 'Noto Sans KR')));
    expect(n).toBe(2);
    expect(out.theme.fonts.heading).toBe('Noto Sans KR');
    const m = fontsUsed(out);
    expect(m.has('Old Font')).toBe(false);
    expect(m.get('Noto Sans KR')).toBe(2);
  });
});

describe('PPTX 테마의 한글 글꼴', () => {
  it('테마 글꼴이 한글 글꼴이면 ea·Hang에도 기록, 영문 글꼴이면 기본(맑은 고딕) 유지', async () => {
    const { exportPptxBytes } = await import('../export/pptxExport');
    const JSZip = (await import('jszip')).default;
    const doc = produce(createPresentation(), (d) => void (d.theme.fonts = { heading: 'Noto Sans KR', body: 'Arial' }));
    const { bytes } = await exportPptxBytes(doc);
    const xml = await (await JSZip.loadAsync(bytes)).file('ppt/theme/theme1.xml')!.async('string');
    const major = xml.slice(xml.indexOf('<a:majorFont>'), xml.indexOf('</a:majorFont>'));
    const minor = xml.slice(xml.indexOf('<a:minorFont>'), xml.indexOf('</a:minorFont>'));
    expect(major).toContain('<a:latin typeface="Noto Sans KR"/>');
    expect(major).toContain('<a:ea typeface="Noto Sans KR"/>');
    expect(major).toContain('<a:font script="Hang" typeface="Noto Sans KR"/>');
    expect(minor).toContain('<a:latin typeface="Arial"/>');
    expect(minor).toContain('<a:font script="Hang" typeface="맑은 고딕"/>');
  });
});

describe('내 글꼴 라이브러리 (IndexedDB)', () => {
  it('추가 → 별명으로 찾기 → 한글 글꼴 판정 → 이름 바꾸기 → .slidelab 포함/복원 → 삭제', async () => {
    const lib = await import('./library');
    const { koreanCapable } = await import('./catalog');
    const files = ['TestSerif-Regular.ttf', 'TestSerif-BoldItalic.ttf'].map((n) => new File([readFileSync(`src/services/fonts/__fixtures__/${n}`)], n, { type: 'font/ttf' }));
    const r = await lib.addFontFiles(files);
    expect(r.errors).toEqual([]);
    expect(r.added.map((a) => [a.family, a.weight, a.italic])).toEqual([
      ['SlideLab Test Serif', 400, false],
      ['SlideLab Test Serif', 700, true],
    ]);
    // 같은 스타일을 다시 추가하면 바꿈 (중복 안 생김)
    const again = await lib.addFontFiles([files[0]]);
    expect(again.replaced).toBe(1);
    expect(lib.useFonts.getState().userFonts).toHaveLength(2);
    expect(koreanCapable('SlideLab Test Serif')).toBe(true);
    expect((await lib.userFontRecords(['슬라이드랩 테스트 명조'])).length).toBe(2);
    expect(lib.fontStatus('slidelab test serif')).toEqual({ source: 'user', available: true });

    await lib.renameFamily('SlideLab Test Serif', '내 명조');
    const st = lib.useFonts.getState().userFonts;
    expect(st.every((f) => f.family === '내 명조' && f.aliases.includes('SlideLab Test Serif'))).toBe(true);

    // .slidelab 가져오기: 들어 있는 글꼴을 라이브러리에 추가 (이미 있으면 건너뜀)
    const { importNative } = await import('../storage/files');
    const b64 = readFileSync('src/services/fonts/__fixtures__/TestSerif-Regular.woff').toString('base64');
    const doc = createPresentation();
    const native = new File([JSON.stringify({ format: 'slidelab', version: 1, doc, fonts: [{ family: '다른 글꼴', weight: 400, italic: false, fileName: 'x.woff', format: 'woff', dataUrl: `data:font/woff;base64,${b64}` }, { family: '내 명조', weight: 400, italic: false, fileName: 'y.ttf', format: 'truetype', dataUrl: `data:font/ttf;base64,${b64}` }] })], 'a.slidelab');
    await importNative(native);
    const fams = lib.useFonts.getState().userFonts.map((f) => f.family);
    expect(fams.filter((f) => f === '다른 글꼴')).toHaveLength(1);
    expect(fams.filter((f) => f === '내 명조')).toHaveLength(2);

    await lib.removeFonts(lib.useFonts.getState().userFonts.map((f) => f.id));
    expect(lib.useFonts.getState().userFonts).toHaveLength(0);
    expect(koreanCapable('내 명조')).toBe(true); // 이름에 한글
    expect(koreanCapable('SlideLab Test Serif')).toBe(false);
  });
});
