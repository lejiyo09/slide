import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildPdf, cidToGid1Stream, glyphlessFont, jpegSize, pdfString } from './pdf';

// 2x1 픽셀 JPEG (기준선, 3채널)
const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  ),
  (c) => c.charCodeAt(0),
);

describe('PDF 작성기', () => {
  it('JPEG 크기 읽기', () => {
    expect(jpegSize(JPEG)).toEqual({ width: 2, height: 1 });
  });

  it('문자열: 아스키는 리터럴(이스케이프), 한글은 UTF-16BE', () => {
    expect(pdfString('A (b) \\c')).toBe('(A \\(b\\) \\\\c)');
    expect(pdfString('가A')).toBe('<FEFFAC000041>');
  });

  it('페이지마다 그림 하나 — xref 오프셋이 정확하고 poppler(pdfinfo)가 읽음', () => {
    const page = { width: 960, height: 540, jpeg: JPEG, pixelWidth: 2, pixelHeight: 1 };
    const pdf = buildPdf([page, page, page], { title: '발표 자료' }, new Date(Date.UTC(2026, 10, 6)));
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.7\n%')).toBe(true);
    // xref의 각 오프셋이 'n 0 obj'를 가리키는지
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    const rows = text.slice(xrefAt).split('\n').slice(3, 3 + 12);
    rows.forEach((r, i) => expect(text.slice(Number(r.slice(0, 10)), Number(r.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/pdf-writer.pdf', pdf);
    const info = execFileSync('pdfinfo', ['test-output/pdf-writer.pdf'], { encoding: 'utf8' });
    expect(info).toMatch(/Pages:\s+3/);
    expect(info).toMatch(/Page size:\s+960 x 540 pts/);
    expect(info).toMatch(/Title:\s+발표 자료/);
    expect(info).toMatch(/Producer:\s+SlideLab/);
  });

  it('글자 층 글꼴: CIDToGIDMap(zlib)은 0x0001 × 65536, 모양 없는 TrueType', () => {
    const raw = inflateSync(cidToGid1Stream());
    expect(raw.length).toBe(131072);
    for (let i = 0; i < raw.length; i += 2) if (raw[i] !== 0 || raw[i + 1] !== 1) throw new Error(`위치 ${i}`);
    const f = glyphlessFont();
    expect(new DataView(f.buffer).getUint32(0)).toBe(0x00010000);
  });

  it('보이지 않는 글자 층: pdftotext로 한국어·영어·BMP 밖 글자를 찾고 위치가 줄 상자와 맞음, 글꼴은 포함(emb)', () => {
    const page = {
      width: 960,
      height: 540,
      jpeg: JPEG,
      pixelWidth: 2,
      pixelHeight: 1,
      text: [
        { x: 72, y: 50, width: 400, height: 40, text: '분기 실적 보고 Q3' },
        { x: 72, y: 300, width: 75, height: 20, text: '목표 😀 𝐀' },
      ],
    };
    const pdf = buildPdf([page, { ...page, text: [] }], { title: '글자 층' });
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/pdf-text.pdf', pdf);
    const txt = execFileSync('pdftotext', ['-f', '1', '-l', '1', 'test-output/pdf-text.pdf', '-'], { encoding: 'utf8' });
    expect(txt).toContain('분기 실적 보고 Q3');
    expect(txt).toContain('목표 😀 𝐀');
    expect(execFileSync('pdftotext', ['-f', '2', '-l', '2', 'test-output/pdf-text.pdf', '-'], { encoding: 'utf8' }).trim()).toBe('');
    const bbox = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', 'test-output/pdf-text.pdf', '-'], { encoding: 'utf8' });
    const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
    const first = words.find((w) => w.t === '분기')!, last = words.find((w) => w.t === 'Q3')!;
    expect(Math.abs(first.x0 - 72)).toBeLessThan(1);
    expect(Math.abs(last.x1 - 472)).toBeLessThan(1);
    expect(Math.abs(first.y0 - 50)).toBeLessThan(1);
    expect(Math.abs(first.y1 - 90)).toBeLessThan(1);
    const fonts = execFileSync('pdffonts', ['test-output/pdf-text.pdf'], { encoding: 'utf8' });
    expect(fonts).toMatch(/SlideLabTextLayer\s+CID TrueType\s+Identity-H\s+yes\s+no\s+yes/);
    // pdfinfo 오류 없음 (xref·글꼴 구조)
    execFileSync('pdfinfo', ['test-output/pdf-text.pdf'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('글자마다 상자가 있으면 그 자리·폭 그대로 (좁은 라틴 + 넓은 한글)', () => {
    // "Ab 가나": A 0–10, b 10–18, 공백 18–24, 가 24–44, 나 44–64
    const boxes: [number, number][] = [[100, 110], [110, 118], [118, 124], [124, 144], [144, 164]];
    const pdf = buildPdf([{ width: 400, height: 200, jpeg: JPEG, pixelWidth: 2, pixelHeight: 1, text: [{ x: 100, y: 20, width: 64, height: 20, text: 'Ab 가나', boxes }] }]);
    writeFileSync('test-output/pdf-text-boxes.pdf', pdf);
    const bbox = execFileSync('pdftotext', ['-bbox', 'test-output/pdf-text-boxes.pdf', '-'], { encoding: 'utf8' });
    const w = Object.fromEntries([...bbox.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]+)<\/word>/g)].map((m) => [m[3], [Math.round(+m[1]), Math.round(+m[2])]]));
    expect(w).toEqual({ Ab: [100, 118], 가나: [124, 164] });
  });
});
