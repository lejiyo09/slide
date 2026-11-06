/** 문서에 쓰인 글꼴 찾기 / 글꼴 바꾸기 (PowerPoint 홈 › 바꾸기 › 글꼴 바꾸기) */
import type { Presentation, SlideObject, TextBody } from '../../types/model';

function bodies(o: SlideObject): TextBody[] {
  if (o.type === 'text' || o.type === 'shape') return [o.text];
  if (o.type === 'group') return o.children.flatMap(bodies);
  if (o.type === 'table') return o.rows.flatMap((r) => r.cells.map((c) => c.text));
  return [];
}

function allObjects(doc: Presentation): SlideObject[] {
  return [...doc.slides.flatMap((s) => s.objects), ...(doc.master?.objects ?? []), ...Object.values(doc.layouts ?? {}).flatMap((l) => l.objects)];
}

/** 글꼴별 사용 횟수 (테마 토큰은 테마 글꼴로 계산, 테마 글꼴 자체도 포함) */
export function fontsUsed(doc: Presentation): Map<string, number> {
  const m = new Map<string, number>();
  const add = (f: string | undefined, n = 1) => {
    if (!f) return;
    const name = f === '@heading' ? doc.theme.fonts.heading : f === '@body' ? doc.theme.fonts.body : f;
    m.set(name, (m.get(name) ?? 0) + n);
  };
  add(doc.theme.fonts.heading, 0);
  add(doc.theme.fonts.body, 0);
  // 횟수는 슬라이드의 글자만, 마스터·레이아웃 글꼴은 목록에만 (0회)
  const designObjs = [...(doc.master?.objects ?? []), ...Object.values(doc.layouts ?? {}).flatMap((l) => l.objects)];
  for (const o of designObjs) for (const b of bodies(o)) for (const p of b.paragraphs) for (const r of p.runs) if (r.text) add(r.fontFamily ?? '@body', 0);
  for (const o of doc.slides.flatMap((s) => s.objects)) for (const b of bodies(o)) for (const p of b.paragraphs) for (const r of p.runs) if (r.text) add(r.fontFamily ?? '@body');
  return m;
}

/** 글꼴 바꾸기: 모든 슬라이드·마스터·레이아웃·테마에서 from → to. 바꾼 글자 묶음 수 반환 */
export function replaceFontInDoc(d: Presentation, from: string, to: string): number {
  const low = from.toLowerCase();
  let n = 0;
  if (d.theme.fonts.heading.toLowerCase() === low) {
    d.theme.fonts.heading = to;
    n++;
  }
  if (d.theme.fonts.body.toLowerCase() === low) {
    d.theme.fonts.body = to;
    n++;
  }
  for (const o of allObjects(d)) {
    for (const b of bodies(o))
      for (const p of b.paragraphs)
        for (const r of p.runs)
          if (r.fontFamily && r.fontFamily.toLowerCase() === low) {
            r.fontFamily = to;
            n++;
          }
  }
  return n;
}
