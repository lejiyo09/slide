import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildPdf, jpegSize, pdfString } from './pdf';

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
});
