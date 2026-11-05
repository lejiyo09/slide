/**
 * 슬라이드 쇼 설정 ↔ PPTX
 * - presProps.xml p:showPr (ECMA-376 CT_ShowProperties): loop / showNarration / showAnimation / useTimings,
 *   보기 형식(present|browse|kiosk), 표시 범위(sldAll|sldRg|custShow), 펜 색, 레이저 색(p14:laserClr 확장)
 * - presentation.xml p:custShowLst: 재구성한 쇼
 */
import type { CustomShow, Presentation, ShowSettings } from '../../types/model';
import { DEFAULT_SHOW_SETTINGS } from '../../engines/show/showModel';
import { kid, kids } from '../import/ooxml';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
/** p:showPr 확장: 레이저 포인터 색 */
export const LASER_EXT_URI = '{EC167BDD-8182-4AB7-AECC-EB403E3ABB37}';

const hex = (c: string) => c.replace('#', '').toUpperCase().slice(0, 6).padEnd(6, '0');

export function buildShowPrXml(st: ShowSettings, customShows: CustomShow[] = []): string {
  const attrs = [
    st.loop || st.showType === 'kiosk' ? 'loop="1"' : '',
    `showNarration="${st.noNarration ? 0 : 1}"`,
    st.noAnimation ? 'showAnimation="0"' : '',
    st.useTimings ? '' : 'useTimings="0"',
  ]
    .filter(Boolean)
    .join(' ');
  const type = st.showType === 'browsed' ? '<p:browse/>' : st.showType === 'kiosk' ? '<p:kiosk/>' : '<p:present/>';
  let range = '<p:sldAll/>';
  if (st.range.kind === 'range') range = `<p:sldRg st="${st.range.from}" end="${st.range.to}"/>`;
  else if (st.range.kind === 'custom') {
    const showId = st.range.showId;
    const i = customShows.findIndex((c) => c.id === showId);
    if (i >= 0) range = `<p:custShow id="${i}"/>`;
  }
  return (
    `<p:showPr xmlns:p="${P}" xmlns:a="${A}" ${attrs}>${type}${range}` +
    `<p:penClr><a:srgbClr val="${hex(st.penColor)}"/></p:penClr>` +
    `<p:extLst><p:ext uri="${LASER_EXT_URI}"><p14:laserClr xmlns:p14="${P14}"><a:srgbClr val="${hex(st.laserColor)}"/></p14:laserClr></p:ext></p:extLst>` +
    `</p:showPr>`
  );
}

function colorOf(el: Element | null): string | undefined {
  if (!el) return undefined;
  for (const c of kids(el)) {
    if (c.localName === 'srgbClr') return `#${(c.getAttribute('val') ?? '').toUpperCase()}`;
    if (c.localName === 'prstClr') return PRESET[c.getAttribute('val') ?? ''];
  }
  return undefined;
}
const PRESET: Record<string, string> = { red: '#FF0000', black: '#000000', white: '#FFFFFF', blue: '#0000FF', green: '#008000', yellow: '#FFFF00', lime: '#00FF00' };

/** p:showPr → 쇼 설정. 재구성한 쇼 id(숫자) → SlideLab 쇼 ID */
export function parseShowPr(showPr: Element | null, customIdMap: Map<string, string>, slideCount: number): ShowSettings | undefined {
  if (!showPr) return undefined;
  const on = (name: string, def: boolean) => {
    const v = showPr.getAttribute(name);
    return v === null ? def : v === '1' || v === 'true';
  };
  const st: ShowSettings = { ...DEFAULT_SHOW_SETTINGS };
  st.loop = on('loop', false);
  st.noNarration = !on('showNarration', false);
  st.noAnimation = !on('showAnimation', true);
  st.useTimings = on('useTimings', true);
  if (kid(showPr, 'browse')) st.showType = 'browsed';
  else if (kid(showPr, 'kiosk')) st.showType = 'kiosk';
  const rg = kid(showPr, 'sldRg');
  const cs = kid(showPr, 'custShow');
  if (rg) {
    const from = Number(rg.getAttribute('st')) || 1;
    const to = Number(rg.getAttribute('end')) || slideCount;
    st.range = { kind: 'range', from: Math.max(1, from), to: Math.max(from, Math.min(to, slideCount)) };
  } else if (cs) {
    const id = customIdMap.get(cs.getAttribute('id') ?? '');
    if (id) st.range = { kind: 'custom', showId: id };
  }
  st.penColor = colorOf(kid(showPr, 'penClr')) ?? st.penColor;
  for (const ext of kids(kid(showPr, 'extLst'), 'ext')) {
    const laser = kids(ext).find((c) => c.localName === 'laserClr');
    const c = colorOf(laser ?? null);
    if (c) st.laserColor = c;
  }
  return st;
}

/** p:custShowLst → 재구성한 쇼 (슬라이드 r:id → SlideLab 슬라이드 ID) */
export function parseCustomShows(pres: Element, slideOfRid: (rid: string) => string | undefined, newId: () => string): { shows: CustomShow[]; idMap: Map<string, string> } {
  const shows: CustomShow[] = [];
  const idMap = new Map<string, string>();
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  for (const c of kids(kid(pres, 'custShowLst'), 'custShow')) {
    const id = newId();
    idMap.set(c.getAttribute('id') ?? String(shows.length), id);
    const slideIds = kids(kid(c, 'sldLst'), 'sld')
      .map((s) => slideOfRid(s.getAttributeNS(R, 'id') ?? s.getAttribute('r:id') ?? ''))
      .filter((x): x is string => !!x);
    shows.push({ id, name: c.getAttribute('name') ?? `재구성한 쇼 ${shows.length + 1}`, slideIds });
  }
  return { shows, idMap };
}

/** 내보내기: 재구성한 쇼의 슬라이드 ID → 내보낸 슬라이드 순서(0부터) */
export function customShowPlan(doc: Presentation) {
  const index = new Map(doc.slides.map((s, i) => [s.id, i]));
  return (doc.customShows ?? []).map((c) => ({ name: c.name, slides: c.slideIds.map((id) => index.get(id)).filter((x): x is number => x !== undefined) }));
}
