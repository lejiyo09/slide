import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { produce } from 'immer';
import { createPresentation } from '../document/factory';
import { addSlide } from '../commands/commands';
import { addComment, adjacentComment, deleteAllComments, deleteComment, initialsOf, relativeTime, replyToComment, setResolved } from './comments';
import { exportPptxBytes } from '../../services/export/pptxExport';
import { importPptx } from '../../services/import/pptxImport';

function deck() {
  return produce(createPresentation('메모'), (d) => {
    addSlide(d, d.slides[0].id, 'blank');
    const [s1, s2] = d.slides;
    const c1 = addComment(d, s1.id, { author: '김민지', initials: '김민', text: '제목을 더 짧게 & <굵게>', x: 100, y: 50, created: '2026-11-01T09:00:00.000Z' });
    replyToComment(d, s1.id, c1, { author: 'Alex Kim', initials: 'AK', text: '좋아요, 고칠게요.' });
    addComment(d, s1.id, { author: 'Alex Kim', initials: 'AK', text: '그림 출처 넣기', x: 600, y: 300, created: '2026-11-02T10:30:00.000Z' });
    addComment(d, s2.id, { author: '김민지', initials: '김민', text: '빈 슬라이드?', x: 10, y: 10 });
  });
}

describe('메모 명령', () => {
  it('추가·답글(다시 열림)·해결·삭제·전체 삭제', () => {
    let d = deck();
    const s1 = d.slides[0];
    expect(s1.comments).toHaveLength(2);
    expect(s1.comments![0].replies).toHaveLength(1);
    d = produce(d, (x) => setResolved(x, s1.id, s1.comments![0].id, true));
    expect(d.slides[0].comments![0].resolved).toBe(true);
    d = produce(d, (x) => void replyToComment(x, s1.id, s1.comments![0].id, { author: 'A', initials: 'A', text: '다시' }));
    expect(d.slides[0].comments![0].resolved).toBe(false);
    d = produce(d, (x) => deleteComment(x, s1.id, s1.comments![0].id, d.slides[0].comments![0].replies[0].id));
    expect(d.slides[0].comments![0].replies.map((r) => r.text)).toEqual(['다시']);
    d = produce(d, (x) => deleteComment(x, s1.id, s1.comments![1].id));
    expect(d.slides[0].comments).toHaveLength(1);
    let n = 0;
    d = produce(d, (x) => void (n = deleteAllComments(x)));
    expect(n).toBe(2);
    expect(d.slides.every((s) => !s.comments)).toBe(true);
  });

  it('이전/다음 메모 (슬라이드를 넘어 순환)', () => {
    const d = deck();
    const [s1, s2] = d.slides;
    const a = s1.comments![0].id, b = s1.comments![1].id, c = s2.comments![0].id;
    expect(adjacentComment(d, { slideId: s1.id, commentId: a }, 1)).toEqual({ slideId: s1.id, commentId: b });
    expect(adjacentComment(d, { slideId: s1.id, commentId: b }, 1)).toEqual({ slideId: s2.id, commentId: c });
    expect(adjacentComment(d, { slideId: s2.id, commentId: c }, 1)).toEqual({ slideId: s1.id, commentId: a });
    expect(adjacentComment(d, { slideId: s1.id, commentId: a }, -1)).toEqual({ slideId: s2.id, commentId: c });
    expect(adjacentComment(d, { slideId: s2.id, commentId: null }, -1)).toEqual({ slideId: s2.id, commentId: c });
  });

  it('이니셜, 상대 시간', () => {
    expect(initialsOf('김민지')).toBe('김민');
    expect(initialsOf('alex de kim')).toBe('ADK');
    const now = Date.parse('2026-11-06T10:00:00Z');
    expect(relativeTime('2026-11-06T09:59:30Z', now)).toBe('방금');
    expect(relativeTime('2026-11-06T09:30:00Z', now)).toBe('30분 전');
    expect(relativeTime('2026-11-04T10:00:00Z', now)).toBe('2일 전');
  });
});

describe('PPTX 메모', () => {
  it('내보내기: commentAuthors + commentN (p15 답글) → 다시 가져오기', async () => {
    const doc = deck();
    const { bytes } = await exportPptxBytes(doc);
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/comments.pptx', bytes);
    const zip = await JSZip.loadAsync(bytes);
    const authors = await zip.file('ppt/commentAuthors.xml')!.async('string');
    expect(authors).toContain('<p:cmAuthor id="0" name="김민지" initials="김민" lastIdx="2" clrIdx="0"/>');
    expect(authors).toContain('<p:cmAuthor id="1" name="Alex Kim" initials="AK" lastIdx="2" clrIdx="1"/>');
    const c1 = await zip.file('ppt/comments/comment1.xml')!.async('string');
    expect(c1).toContain('<p:cm authorId="0" dt="2026-11-01T09:00:00.000" idx="1"><p:pos x="600" y="300"/><p:text>제목을 더 짧게 &amp; &lt;굵게&gt;</p:text></p:cm>');
    expect(c1).toMatch(/<p:cm authorId="1" dt="[^"]+" idx="1"><p:pos x="600" y="300"\/><p:text>좋아요, 고칠게요.<\/p:text><p:extLst><p:ext uri="\{C676402C-5697-4E1C-873F-D02D1690AC5C\}"><p15:threadingInfo [^>]*><p15:parentCm authorId="0" idx="1"\/>/);
    expect(zip.file('ppt/comments/comment2.xml')).toBeTruthy();
    expect(await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')).toMatch(/relationships\/commentAuthors" Target="commentAuthors.xml"/);
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toMatch(/relationships\/comments" Target="\.\.\/comments\/comment1.xml"/);
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('PartName="/ppt/comments/comment1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"');
    expect(ct).toContain('PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"');

    const back = await importPptx(bytes);
    const cm = back.doc.slides[0].comments!;
    expect(cm.map((c) => [c.author, c.text, Math.round(c.x), Math.round(c.y), c.replies.map((r) => r.text)])).toEqual([
      ['김민지', '제목을 더 짧게 & <굵게>', 100, 50, ['좋아요, 고칠게요.']],
      ['Alex Kim', '그림 출처 넣기', 600, 300, []],
    ]);
    expect(cm[0].created).toBe('2026-11-01T09:00:00.000Z');
    expect(back.doc.slides[1].comments).toHaveLength(1);
    expect(back.report.comments).toBe(3);
  });

  it('최신 메모(PowerPoint 365, p188) 가져오기: 답글·해결 상태·개체 연결', async () => {
    const src = await exportPptxBytes(produce(createPresentation('m'), () => {}));
    const zip = await JSZip.loadAsync(src.bytes);
    const P188 = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
    zip.file('ppt/authors.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p188:authorLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p188="${P188}"><p188:author id="{AAA}" name="박서준" initials="박서" userId="seojun@example.com" providerId="AD"/><p188:author id="{BBB}" name="Lee" initials="L" userId="lee" providerId="None"/></p188:authorLst>`);
    zip.file(
      'ppt/comments/modernComment_100_1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p188:cmLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p188="${P188}" xmlns:pc="http://schemas.microsoft.com/office/powerpoint/2013/main/command" xmlns:ac="http://schemas.microsoft.com/office/drawing/2013/main/command">` +
        `<p188:cm id="{C1}" authorId="{AAA}" created="2026-10-30T08:15:00.000" status="resolved"><pc:sldMkLst><pc:docMk/><pc:sldMk cId="0" sldId="256"/></pc:sldMkLst><p188:pos x="952500" y="476250"/>` +
        `<p188:replyLst><p188:reply id="{R1}" authorId="{BBB}" created="2026-10-30T09:00:00.000"><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Done</a:t></a:r></a:p></p188:txBody></p188:reply></p188:replyLst>` +
        `<p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>첫 줄</a:t></a:r></a:p><a:p><a:r><a:t>둘째 줄</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>`,
    );
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
    zip.file('ppt/_rels/presentation.xml.rels', presRels.replace('</Relationships>', '<Relationship Id="rIdAu" Type="http://schemas.microsoft.com/office/2018/10/relationships/authors" Target="authors.xml"/></Relationships>'));
    const sRels = zip.file('ppt/slides/_rels/slide1.xml.rels');
    const sr = sRels ? await sRels.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    zip.file('ppt/slides/_rels/slide1.xml.rels', sr.replace('</Relationships>', '<Relationship Id="rIdMc" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/modernComment_100_1.xml"/></Relationships>'));
    const r = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    const c = r.doc.slides[0].comments!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ author: '박서준', initials: '박서', text: '첫 줄\n둘째 줄', x: 100, y: 50, resolved: true, created: '2026-10-30T08:15:00.000Z' });
    expect(c[0].replies.map((x) => [x.author, x.text])).toEqual([['Lee', 'Done']]);
  });
});
