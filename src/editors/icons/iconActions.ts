/**
 * 아이콘 삽입: lucide 아이콘(ISC 라이선스, 이미 의존성)을 SVG로 만들어 그림 개체로 삽입.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons } from 'lucide-react';
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import { createImage } from '../../core/document/factory';
import { newId } from '../../utils/id';

export const ICON_NAMES = Object.keys(icons);

export function iconSvg(name: string, color: string, strokeWidth = 2): string | null {
  const Icon = (icons as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[name];
  if (!Icon) return null;
  const markup = renderToStaticMarkup(createElement(Icon, { size: 96, color, strokeWidth }));
  return markup.includes('xmlns=') ? markup : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

export function insertIcon(name: string, color: string) {
  const svg = iconSvg(name, color);
  if (!svg) return;
  const s = useEditor.getState();
  const assetId = newId();
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const img = createImage(assetId, 96, 96, s.doc.size);
  img.width = img.height = 144;
  img.x = (s.doc.size.width - 144) / 2;
  img.y = (s.doc.size.height - 144) / 2;
  img.name = `아이콘: ${name}`;
  s.commit('아이콘 삽입', (d) => {
    d.assets[assetId] = { id: assetId, mime: 'image/svg+xml', dataUrl, name: `${name}.svg` };
    C.addObjects(d, getActiveSlide().id, [img]);
  });
  useEditor.getState().select([img.id]);
}
