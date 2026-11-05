import { useEffect, useState } from 'react';
import { useEditor } from '../core/store/editorStore';
import { findSlide } from '../core/document/query';
import { onEditorSelectionChange } from '../editors/text/editorSession';
import { currentSelectionStyle } from '../editors/text/formatting';
import { textBodies } from '../core/commands/commands';
import type { BulletType, HAlign, SlideObject, TextRunStyle } from '../types/model';

export type CurrentTextStyle = TextRunStyle & { align?: HAlign; bullet?: BulletType; lineSpacing?: number; hasText: boolean };

function firstTextObject(o: SlideObject | undefined): SlideObject | undefined {
  if (!o) return undefined;
  if (o.type === 'group') return o.children.map(firstTextObject).find(Boolean);
  return o.type === 'text' || o.type === 'shape' || o.type === 'table' ? o : undefined;
}

/** 리본/속성창 표시용 현재 텍스트 서식 */
export function useCurrentTextStyle(): CurrentTextStyle {
  const editingId = useEditor((s) => s.editingTextId);
  const obj = useEditor((s) => {
    const slide = findSlide(s.doc, s.activeSlideId);
    const id = s.editingTextId ?? s.selectedIds[0];
    return id ? firstTextObject(slide?.objects.find((o) => o.id === id)) : undefined;
  });
  const cellSel = useEditor((s) => s.cellSelection);
  const [tick, setTick] = useState(0);
  useEffect(() => onEditorSelectionChange(() => setTick((t) => t + 1)), []);
  void tick;

  if (editingId) {
    const cs = currentSelectionStyle();
    if (cs.fontFamily) return { ...cs, hasText: true };
  }
  if (!obj) return { hasText: false };
  const bodies = textBodies(obj, cellSel && cellSel.id === obj.id ? cellSel : null);
  if (!bodies.length) return { hasText: false };
  const p = bodies[0].paragraphs[0];
  const r = p?.runs[0] ?? {};
  const runs = bodies.flatMap((b) => b.paragraphs.flatMap((x) => x.runs));
  return {
    hasText: true,
    fontFamily: r.fontFamily,
    fontSize: r.fontSize,
    bold: runs.length > 0 && runs.every((x) => x.bold),
    italic: runs.length > 0 && runs.every((x) => x.italic),
    underline: runs.length > 0 && runs.every((x) => x.underline),
    strike: runs.length > 0 && runs.every((x) => x.strike),
    color: r.color,
    highlight: r.highlight,
    align: p?.align,
    bullet: p?.bullet,
    lineSpacing: p?.lineSpacing,
  };
}
