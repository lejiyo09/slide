/**
 * PPTX 가져오기: Open XML 패키지 → SlideLab 편집 가능 모델.
 *
 * - 슬라이드 크기/순서/구역/숨김, 테마 색·글꼴, 배경(슬라이드 → 레이아웃 → 마스터 상속)
 * - 도형(프리셋/사용자 지정 경로), 텍스트(문단·런 서식, 개체 틀 서식 상속), 그림(자르기), 연결선, 그룹
 * - 마스터/레이아웃 디자인 개체 → doc.layouts (슬라이드 뒤에 렌더링)
 * - 표·차트·SmartArt·미디어·OLE 등 미지원 요소 → UnsupportedObject(원본 XML 보존)
 * - 전환/애니메이션 XML → slide.source에 보존 (편집은 10단계)
 *
 * 이미지로 변환하지 않으며, 해석하지 못한 요소는 조용히 버리지 않고 보고서에 기록한다.
 */
import type {
  BulletType, CustomGeometry, Fill, GroupObject, HAlign, ImageObject, LayoutDef, LineObject, Paragraph, PathCommand, Presentation,
  Section, ShapeKind, ShapeObject, Slide, SlideObject, Stroke, TextBody, TextObject, TextRun, Theme, UnsupportedKind, UnsupportedObject, VAlign,
} from '../../types/model';
import { newId } from '../../utils/id';
import { MIME_BY_EXT, NS, OoxmlPackage, REL, WEB_IMAGE_EXT, boolAttr, descendants, kid, kids, numAttr, path, rAttr, serializeElement } from './ooxml';
import { highlightColor, parseFill, parseLine, resolveColor, type ColorCtx, type FillResult } from './drawingml';

const EMU_PER_PX = 9525;

export { summarizeReport } from './report';
export type { ImportReport } from './report';
import type { ImportReport } from './report';

export interface ImportResult {
  doc: Presentation;
  report: ImportReport;
}

/* ───────────── 텍스트 스타일 캐스케이드 ───────────── */

interface RunProps {
  sz?: number; // pt
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  latin?: string;
  ea?: string;
}

interface ParaProps {
  algn?: HAlign;
  bullet?: BulletType;
  buChar?: string;
  lnSpcPct?: number;
  lnSpcPts?: number;
  spcBefPts?: number;
  spcAftPts?: number;
  spcBefPct?: number;
  spcAftPct?: number;
  run: RunProps;
}

type LevelStyles = ParaProps[]; // 0..8

interface BodyProps {
  anchor?: VAlign;
  lIns?: number;
  tIns?: number;
  rIns?: number;
  bIns?: number;
  vert?: TextBody['direction'];
  wrap?: boolean;
  autoFit?: TextBody['autoFit'];
  fontScale?: number;
  lnSpcReduction?: number;
}

const ALGN: Record<string, HAlign> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify', thaiDist: 'justify' };

const mergeRun = (a: RunProps, b: RunProps): RunProps => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};
const mergePara = (a: ParaProps, b: Partial<ParaProps>): ParaProps => {
  const out: ParaProps = { ...a, run: mergeRun(a.run, b.run ?? {}) };
  for (const [k, v] of Object.entries(b)) if (k !== 'run' && v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
};

/* ───────────── 컨텍스트 ───────────── */

interface ThemeInfo {
  scheme: Record<string, string>;
  majorLatin: string;
  minorLatin: string;
  majorEa: string;
  minorEa: string;
  fillStyles: Element[];
  bgFillStyles: Element[];
  lineWidths: number[]; // pt
  name: string;
}

interface PlaceholderInfo {
  type: string;
  idx?: string;
  el: Element;
}

interface PartInfo {
  part: string;
  doc: Document;
  placeholders: PlaceholderInfo[];
  lstStyles: Map<Element, LevelStyles>;
}

interface MasterInfo extends PartInfo {
  clrMap: Record<string, string>;
  titleStyle: LevelStyles;
  bodyStyle: LevelStyles;
  otherStyle: LevelStyles;
  theme: ThemeInfo;
}

interface ShapeCtx {
  pkg: OoxmlPackage;
  part: string; // 현재 파트 (관계 해석용)
  color: ColorCtx;
  theme: ThemeInfo;
  master: MasterInfo;
  layout: PartInfo | null; // 슬라이드 파싱 시 레이아웃
  isSlide: boolean;
  defaultTextStyle: LevelStyles;
  assets: Presentation['assets'];
  assetByPath: Map<string, string>;
  report: ImportReport;
}

/* ───────────── 진입점 ───────────── */

export async function importPptx(data: ArrayBuffer | Uint8Array | Blob, fileName = 'presentation.pptx'): Promise<ImportResult> {
  const pkg = await OoxmlPackage.load(data);
  const report: ImportReport = { fileName, slides: 0, objects: 0, unsupported: {}, preservedTransitions: 0, preservedTimings: 0, approximated: [], warnings: [] };

  const rootRel = (await pkg.rels('')).size ? await pkg.relByType('', REL.officeDocument) : undefined;
  const presPath = rootRel?.target ?? 'ppt/presentation.xml';
  const presDoc = await pkg.xml(presPath);
  if (!presDoc) throw new Error('PowerPoint 프레젠테이션(.pptx) 파일이 아닙니다.');
  const pres = presDoc.documentElement;
  if (pres.namespaceURI !== NS.p) {
    if (pres.namespaceURI?.includes('purl.oclc.org')) throw new Error('Strict Open XML 형식은 아직 지원하지 않습니다. PowerPoint에서 "PowerPoint 프레젠테이션(.pptx)" 형식으로 다시 저장하세요.');
    throw new Error('알 수 없는 프레젠테이션 형식입니다.');
  }

  const sz = kid(pres, 'sldSz');
  const width = Math.round(((numAttr(sz, 'cx') ?? 9144000) / EMU_PER_PX) * 100) / 100;
  const height = Math.round(((numAttr(sz, 'cy') ?? 6858000) / EMU_PER_PX) * 100) / 100;
  const ratio = width / height;
  const preset = Math.abs(width - 1280) < 1 && Math.abs(height - 720) < 1 ? '16:9' : Math.abs(width - 960) < 1 && Math.abs(height - 720) < 1 ? '4:3' : 'custom';
  void ratio;

  const presRels = await pkg.rels(presPath);
  const defaultTextStyle = parseLstStyle(kid(pres, 'defaultTextStyle'), null);

  const masters = new Map<string, MasterInfo>();
  const layouts = new Map<string, PartInfo>();
  const layoutDefs: Record<string, LayoutDef> = {};
  const assets: Presentation['assets'] = {};
  const assetByPath = new Map<string, string>();

  const loadMaster = async (masterPath: string): Promise<MasterInfo> => {
    const cached = masters.get(masterPath);
    if (cached) return cached;
    const doc = (await pkg.xml(masterPath))!;
    const root = doc.documentElement;
    const themeRel = await pkg.relByType(masterPath, REL.theme);
    const theme = await loadTheme(pkg, themeRel?.target);
    const clrMapEl = kid(root, 'clrMap');
    const clrMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    if (clrMapEl) for (const a of Array.from(clrMapEl.attributes)) clrMap[a.name] = a.value;
    const colorCtx: ColorCtx = { scheme: theme.scheme, clrMap };
    const txStyles = kid(root, 'txStyles');
    const info: MasterInfo = {
      part: masterPath,
      doc,
      placeholders: collectPlaceholders(root),
      lstStyles: new Map(),
      clrMap,
      theme,
      titleStyle: parseLstStyle(kid(txStyles, 'titleStyle'), colorCtx),
      bodyStyle: parseLstStyle(kid(txStyles, 'bodyStyle'), colorCtx),
      otherStyle: parseLstStyle(kid(txStyles, 'otherStyle'), colorCtx),
    };
    masters.set(masterPath, info);
    return info;
  };

  const loadLayout = async (layoutPath: string): Promise<{ layout: PartInfo; master: MasterInfo }> => {
    const masterRel = await pkg.relByType(layoutPath, REL.slideMaster);
    const master = await loadMaster(masterRel?.target ?? 'ppt/slideMasters/slideMaster1.xml');
    let layout = layouts.get(layoutPath);
    if (!layout) {
      const doc = (await pkg.xml(layoutPath))!;
      layout = { part: layoutPath, doc, placeholders: collectPlaceholders(doc.documentElement), lstStyles: new Map() };
      layouts.set(layoutPath, layout);
      // 레이아웃 디자인 개체 (마스터 + 레이아웃의 개체 틀이 아닌 개체)
      const lroot = doc.documentElement;
      const ctxBase = (part: string): ShapeCtx => ({
        pkg, part, color: { scheme: master.theme.scheme, clrMap: master.clrMap }, theme: master.theme, master, layout: null, isSlide: false,
        defaultTextStyle, assets, assetByPath, report,
      });
      const objects: SlideObject[] = [];
      if (lroot.getAttribute('showMasterSp') !== '0') objects.push(...(await parseSpTree(path(master.doc.documentElement, 'cSld', 'spTree'), ctxBase(master.part), true)));
      objects.push(...(await parseSpTree(path(lroot, 'cSld', 'spTree'), ctxBase(layoutPath), true)));
      const lbg = await parseBackground(path(lroot, 'cSld', 'bg'), ctxBase(layoutPath));
      const mbg = await parseBackground(path(master.doc.documentElement, 'cSld', 'bg'), ctxBase(master.part));
      layoutDefs[layoutPath] = {
        id: layoutPath,
        name: path(lroot, 'cSld')?.getAttribute('name') || layoutPath.split('/').pop()!,
        objects,
        background: lbg ?? mbg ?? undefined,
      };
    }
    return { layout, master };
  };

  // 슬라이드 순서
  const sldIds = kids(kid(pres, 'sldIdLst'), 'sldId');
  const slides: Slide[] = [];
  const idToSlide = new Map<string, string>();
  let firstTheme: ThemeInfo | null = null;
  let firstMaster: MasterInfo | null = null;

  for (const sid of sldIds) {
    const rel = presRels.get(rAttr(sid, 'id') ?? '');
    if (!rel) continue;
    const slidePath = rel.target;
    const sdoc = await pkg.xml(slidePath);
    if (!sdoc) {
      report.warnings.push(`슬라이드 파트를 찾을 수 없어 건너뛰었습니다: ${slidePath}`);
      continue;
    }
    const layoutRel = await pkg.relByType(slidePath, REL.slideLayout);
    const { layout, master } = await loadLayout(layoutRel?.target ?? '');
    firstTheme ??= master.theme;
    firstMaster ??= master;
    const root = sdoc.documentElement;
    const ctx: ShapeCtx = {
      pkg, part: slidePath, color: { scheme: master.theme.scheme, clrMap: master.clrMap }, theme: master.theme, master, layout, isSlide: true,
      defaultTextStyle, assets, assetByPath, report,
    };
    // 슬라이드별 색 매핑 재정의
    const ovr = path(root, 'clrMapOvr', 'overrideClrMapping');
    if (ovr) {
      const m: Record<string, string> = {};
      for (const a of Array.from(ovr.attributes)) m[a.name] = a.value;
      ctx.color = { ...ctx.color, clrMap: m };
    }
    const objects = await parseSpTree(path(root, 'cSld', 'spTree'), ctx, false);
    const bg = await parseBackground(path(root, 'cSld', 'bg'), ctx);

    // 노트
    let notes = '';
    const notesRel = await pkg.relByType(slidePath, REL.notesSlide);
    if (notesRel) {
      const ndoc = await pkg.xml(notesRel.target);
      const body = ndoc && descendants(ndoc.documentElement, 'sp').find((sp) => path(sp, 'nvSpPr', 'nvPr', 'ph')?.getAttribute('type') === 'body');
      if (body) notes = kids(kid(body, 'txBody'), 'p').map((p) => descendants(p, 't').map((t) => t.textContent ?? '').join('')).join('\n').trim();
    }

    // 전환/애니메이션 원본 보존
    const source: Slide['source'] = { part: slidePath };
    for (const c of kids(root)) {
      if (c.localName === 'transition' || (c.localName === 'AlternateContent' && descendants(c, 'transition').length)) {
        source.transitionXml = serializeElement(c);
        report.preservedTransitions++;
      } else if (c.localName === 'timing') {
        source.timingXml = serializeElement(c);
        report.preservedTimings++;
      }
    }

    const slide: Slide = {
      id: newId(),
      objects,
      background: bg ? { fill: bg } : null,
      notes,
      layout: layout.part,
      source,
      ...(root.getAttribute('show') === '0' ? { hidden: true } : {}),
      ...(root.getAttribute('showMasterSp') === '0' ? { showMasterShapes: false } : {}),
    };
    slides.push(slide);
    idToSlide.set(sid.getAttribute('id') ?? '', slide.id);
    report.objects += countObjects(objects);
  }
  report.slides = slides.length;
  if (!slides.length) throw new Error('슬라이드가 없는 프레젠테이션입니다.');

  // 구역 (p14:sectionLst)
  const sections: Section[] = [];
  const sectionLst = descendants(pres, 'sectionLst')[0];
  if (sectionLst) {
    for (const sec of kids(sectionLst, 'section')) {
      const first = descendants(sec, 'sldId').map((s) => idToSlide.get(s.getAttribute('id') ?? '')).find(Boolean);
      if (first) sections.push({ id: newId(), name: sec.getAttribute('name') ?? '구역', startSlideId: first });
    }
  }

  const t = firstTheme!;
  const masterBg = await parseBackground(path(firstMaster!.doc.documentElement, 'cSld', 'bg'), {
    pkg, part: firstMaster!.part, color: { scheme: t.scheme, clrMap: firstMaster!.clrMap }, theme: t, master: firstMaster!, layout: null, isSlide: false,
    defaultTextStyle, assets, assetByPath, report,
  });
  const theme: Theme = {
    id: `imported-${newId()}`,
    name: t.name || '가져온 테마',
    colors: {
      dark1: t.scheme.dk1 ?? '#000000', light1: t.scheme.lt1 ?? '#FFFFFF', dark2: t.scheme.dk2 ?? '#44546A', light2: t.scheme.lt2 ?? '#E7E6E6',
      accent1: t.scheme.accent1 ?? '#4472C4', accent2: t.scheme.accent2 ?? '#ED7D31', accent3: t.scheme.accent3 ?? '#A5A5A5',
      accent4: t.scheme.accent4 ?? '#FFC000', accent5: t.scheme.accent5 ?? '#5B9BD5', accent6: t.scheme.accent6 ?? '#70AD47',
    },
    fonts: { heading: t.majorEa || t.majorLatin || 'Malgun Gothic', body: t.minorEa || t.minorLatin || 'Malgun Gothic' },
    background: masterBg && masterBg.type !== 'image' ? masterBg : { type: 'solid', color: t.scheme.lt1 ?? '#FFFFFF' },
  };

  const now = Date.now();
  const doc: Presentation = {
    id: newId(),
    title: fileName.replace(/\.pptx$/i, '') || '가져온 프레젠테이션',
    size: { width, height, preset },
    slides,
    sections,
    assets,
    theme,
    layouts: layoutDefs,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  report.approximated = [...new Set(report.approximated)];
  report.warnings = [...new Set(report.warnings)];
  return { doc, report };
}

function countObjects(objs: SlideObject[]): number {
  return objs.reduce((n, o) => n + 1 + (o.type === 'group' ? countObjects(o.children) : 0), 0);
}

/* ───────────── 테마 ───────────── */

async function loadTheme(pkg: OoxmlPackage, themePath: string | undefined): Promise<ThemeInfo> {
  const info: ThemeInfo = { scheme: {}, majorLatin: '', minorLatin: '', majorEa: '', minorEa: '', fillStyles: [], bgFillStyles: [], lineWidths: [], name: '' };
  const doc = themePath ? await pkg.xml(themePath) : null;
  if (!doc) return info;
  const root = doc.documentElement;
  info.name = root.getAttribute('name') ?? '';
  const te = kid(root, 'themeElements');
  const clr = kid(te, 'clrScheme');
  const blank: ColorCtx = { scheme: {}, clrMap: {} };
  for (const c of kids(clr)) {
    const col = resolveColor(c, blank);
    if (col) info.scheme[c.localName] = col.hex;
  }
  const fonts = kid(te, 'fontScheme');
  info.majorLatin = path(fonts, 'majorFont', 'latin')?.getAttribute('typeface') ?? '';
  info.minorLatin = path(fonts, 'minorFont', 'latin')?.getAttribute('typeface') ?? '';
  info.majorEa = path(fonts, 'majorFont', 'ea')?.getAttribute('typeface') ?? '';
  info.minorEa = path(fonts, 'minorFont', 'ea')?.getAttribute('typeface') ?? '';
  // 한글 스크립트 글꼴 (ea가 비어 있으면 <a:font script="Hang">)
  const hang = (n: string) => kids(kid(fonts, n), 'font').find((f) => f.getAttribute('script') === 'Hang')?.getAttribute('typeface') ?? '';
  info.majorEa ||= hang('majorFont');
  info.minorEa ||= hang('minorFont');
  const fmt = kid(te, 'fmtScheme');
  info.fillStyles = kids(kid(fmt, 'fillStyleLst'));
  info.bgFillStyles = kids(kid(fmt, 'bgFillStyleLst'));
  info.lineWidths = kids(kid(fmt, 'lnStyleLst'), 'ln').map((l) => (numAttr(l, 'w') ?? 9525) / 12700);
  return info;
}

/* ───────────── 배경 ───────────── */

async function parseBackground(bg: Element | null, ctx: ShapeCtx): Promise<Fill | null> {
  if (!bg) return null;
  const bgPr = kid(bg, 'bgPr');
  if (bgPr) return finalizeFill(parseFill(bgPr, ctx.color), ctx);
  const ref = kid(bg, 'bgRef');
  if (ref) {
    const idx = numAttr(ref, 'idx') ?? 0;
    const col = resolveColor(ref, ctx.color);
    const style = idx >= 1001 ? ctx.theme.bgFillStyles[idx - 1001] : ctx.theme.fillStyles[idx - 1];
    if (style) {
      const wrapper = style.ownerDocument.createElement('w');
      wrapper.appendChild(style.cloneNode(true));
      const f = parseFill(wrapper, { ...ctx.color, phClr: col?.hex });
      return finalizeFill(f, ctx);
    }
    if (col) return { type: 'solid', color: col.hex };
  }
  return null;
}

/** blipFill → 자산 등록 */
async function finalizeFill(f: FillResult, ctx: ShapeCtx): Promise<Fill | null> {
  if (!f) return null;
  if (f.type === 'blip') {
    const assetId = await assetFromRel(f.rId, ctx);
    if (!assetId) return { type: 'none' };
    return { type: 'image', assetId, ...(f.opacity !== undefined ? { opacity: f.opacity } : {}) };
  }
  return f;
}

async function assetFromRel(rId: string, ctx: ShapeCtx): Promise<string | null> {
  const rel = (await ctx.pkg.rels(ctx.part)).get(rId);
  if (!rel || rel.external) return null;
  const cached = ctx.assetByPath.get(rel.target);
  if (cached) return cached;
  const ext = rel.target.split('.').pop()!.toLowerCase();
  if (!WEB_IMAGE_EXT.has(ext)) return null;
  const b64 = await ctx.pkg.base64(rel.target);
  if (!b64) return null;
  const id = newId();
  const mime = MIME_BY_EXT[ext] ?? 'image/png';
  ctx.assets[id] = { id, mime, dataUrl: `data:${mime};base64,${b64}`, name: rel.target.split('/').pop() };
  ctx.assetByPath.set(rel.target, id);
  return id;
}

/* ───────────── 개체 틀 ───────────── */

function collectPlaceholders(root: Element): PlaceholderInfo[] {
  const out: PlaceholderInfo[] = [];
  for (const sp of descendants(root, 'sp')) {
    const ph = path(sp, 'nvSpPr', 'nvPr', 'ph');
    if (ph) out.push({ type: ph.getAttribute('type') ?? 'body', idx: ph.getAttribute('idx') ?? undefined, el: sp });
  }
  return out;
}

const normPhType = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);

function findPlaceholder(list: PlaceholderInfo[] | undefined, type: string, idx: string | undefined): PlaceholderInfo | undefined {
  if (!list) return undefined;
  if (idx !== undefined) {
    const byIdx = list.find((p) => p.idx === idx);
    if (byIdx) return byIdx;
  }
  return list.find((p) => p.type === type) ?? list.find((p) => normPhType(p.type) === normPhType(type));
}

/* ───────────── 스타일 해석 ───────────── */

function parseRunProps(rPr: Element | null, color: ColorCtx | null): RunProps {
  if (!rPr) return {};
  const out: RunProps = {};
  const sz = numAttr(rPr, 'sz');
  if (sz !== undefined) out.sz = sz / 100;
  const b = rPr.getAttribute('b');
  if (b !== null) out.b = b === '1' || b === 'true';
  const i = rPr.getAttribute('i');
  if (i !== null) out.i = i === '1' || i === 'true';
  const u = rPr.getAttribute('u');
  if (u !== null) out.u = u !== 'none';
  const st = rPr.getAttribute('strike');
  if (st !== null) out.strike = st !== 'noStrike';
  if (color) {
    const fill = kid(rPr, 'solidFill');
    if (fill) {
      const c = resolveColor(fill, color);
      if (c) out.color = c.hex;
    }
    const gfill = kid(rPr, 'gradFill');
    if (gfill && !fill) {
      const c = resolveColor(kid(kid(gfill, 'gsLst'), 'gs'), color);
      if (c) out.color = c.hex;
    }
    const hl = highlightColor(kid(rPr, 'highlight'), color);
    if (hl) out.highlight = hl;
  }
  const latin = kid(rPr, 'latin')?.getAttribute('typeface');
  if (latin) out.latin = latin;
  const ea = kid(rPr, 'ea')?.getAttribute('typeface');
  if (ea) out.ea = ea;
  return out;
}

function parseParaProps(pPr: Element | null, color: ColorCtx | null): Partial<ParaProps> {
  if (!pPr) return {};
  const out: Partial<ParaProps> = {};
  const algn = pPr.getAttribute('algn');
  if (algn && ALGN[algn]) out.algn = ALGN[algn];
  if (kid(pPr, 'buNone')) out.bullet = 'none';
  else if (kid(pPr, 'buAutoNum')) out.bullet = 'number';
  else if (kid(pPr, 'buChar') || kid(pPr, 'buBlip')) {
    out.bullet = 'bullet';
    const ch = kid(pPr, 'buChar')?.getAttribute('char');
    if (ch) out.buChar = ch;
  }
  const lnPct = numAttr(path(pPr, 'lnSpc', 'spcPct'), 'val');
  if (lnPct !== undefined) out.lnSpcPct = lnPct / 100000;
  const lnPts = numAttr(path(pPr, 'lnSpc', 'spcPts'), 'val');
  if (lnPts !== undefined) out.lnSpcPts = lnPts / 100;
  const bef = numAttr(path(pPr, 'spcBef', 'spcPts'), 'val');
  if (bef !== undefined) out.spcBefPts = bef / 100;
  const aft = numAttr(path(pPr, 'spcAft', 'spcPts'), 'val');
  if (aft !== undefined) out.spcAftPts = aft / 100;
  const befPct = numAttr(path(pPr, 'spcBef', 'spcPct'), 'val');
  if (befPct !== undefined) out.spcBefPct = befPct / 100000;
  const aftPct = numAttr(path(pPr, 'spcAft', 'spcPct'), 'val');
  if (aftPct !== undefined) out.spcAftPct = aftPct / 100000;
  out.run = parseRunProps(kid(pPr, 'defRPr'), color);
  return out;
}

function parseLstStyle(el: Element | null, color: ColorCtx | null): LevelStyles {
  const levels: LevelStyles = [];
  for (let i = 0; i < 9; i++) {
    const lvl = kid(el, `lvl${i + 1}pPr`);
    levels.push(mergePara({ run: {} }, parseParaProps(lvl, color)));
  }
  return levels;
}

const emptyLevels = (): LevelStyles => Array.from({ length: 9 }, () => ({ run: {} }));

function mergeLevels(...lists: (LevelStyles | null | undefined)[]): LevelStyles {
  return Array.from({ length: 9 }, (_, i) => lists.reduce<ParaProps>((acc, l) => (l ? mergePara(acc, l[i]) : acc), { run: {} }));
}

function parseBodyPr(bodyPr: Element | null): BodyProps {
  if (!bodyPr) return {};
  const out: BodyProps = {};
  const anchor = bodyPr.getAttribute('anchor');
  if (anchor) out.anchor = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
  for (const k of ['lIns', 'tIns', 'rIns', 'bIns'] as const) {
    const v = numAttr(bodyPr, k);
    if (v !== undefined) out[k] = v / EMU_PER_PX;
  }
  const vert = bodyPr.getAttribute('vert');
  if (vert) out.vert = vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVertRtl' ? 'vertical' : vert === 'vert270' ? 'vertical270' : 'horizontal';
  const wrap = bodyPr.getAttribute('wrap');
  if (wrap) out.wrap = wrap !== 'none';
  if (kid(bodyPr, 'spAutoFit')) out.autoFit = 'resize';
  else if (kid(bodyPr, 'noAutofit')) out.autoFit = 'none';
  const norm = kid(bodyPr, 'normAutofit');
  if (norm) {
    out.autoFit = 'shrink';
    const fs = numAttr(norm, 'fontScale');
    if (fs !== undefined) out.fontScale = fs / 100000;
    const lr = numAttr(norm, 'lnSpcReduction');
    if (lr !== undefined) out.lnSpcReduction = lr / 100000;
  }
  return out;
}

const mergeBody = (...bs: BodyProps[]): BodyProps => bs.reduce((acc, b) => {
  const out = { ...acc };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}, {} as BodyProps);

const HANGUL_CJK = /[ᄀ-ᇿ　-鿿가-힯豈-﫿]/;

function resolveTypeface(face: string | undefined, theme: ThemeInfo): string | undefined {
  if (!face) return undefined;
  switch (face) {
    case '+mj-lt': return theme.majorLatin || undefined;
    case '+mn-lt': return theme.minorLatin || undefined;
    case '+mj-ea': return theme.majorEa || theme.majorLatin || undefined;
    case '+mn-ea': return theme.minorEa || theme.minorLatin || undefined;
    case '+mj-cs':
    case '+mn-cs': return undefined;
  }
  return face;
}

/* ───────────── 텍스트 본문 ───────────── */

interface TextStyleChain {
  levels: LevelStyles;
  body: BodyProps;
  /** 도형 스타일(fontRef)의 글자색 */
  fontRefColor?: string;
}

function buildTextBody(txBody: Element | null, chain: TextStyleChain, ctx: ShapeCtx): TextBody {
  const body = mergeBody(chain.body, parseBodyPr(kid(txBody, 'bodyPr')));
  const own = parseLstStyle(kid(txBody, 'lstStyle'), ctx.color);
  const levels = mergeLevels(chain.levels, own);
  const scale = body.fontScale ?? 1;
  const paragraphs: Paragraph[] = [];

  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = Math.max(0, Math.min(8, numAttr(pPr, 'lvl') ?? 0));
    const pp = mergePara(levels[lvl], parseParaProps(pPr, ctx.color));
    const runs: TextRun[] = [];
    const toRun = (rPr: Element | null, text: string): TextRun => {
      const ownRun = parseRunProps(rPr, ctx.color);
      const rp = mergeRun(pp.run, ownRun);
      const ea = resolveTypeface(rp.ea, ctx.theme);
      const latin = resolveTypeface(rp.latin, ctx.theme);
      // 런에 직접 지정한 라틴 글꼴은 우선 (한글 글리프는 CSS 대체 글꼴로 표시),
      // 상속된 경우 한글/한자가 있으면 동아시아 글꼴 사용
      const family = (ownRun.latin && !ownRun.ea && latin) || (HANGUL_CJK.test(text) && ea) || latin || ea || ctx.theme.minorLatin || 'Malgun Gothic';
      const run: TextRun = {
        text,
        fontFamily: family,
        fontSize: Math.round((rp.sz ?? 18) * scale * 10) / 10,
        color: rp.color ?? chain.fontRefColor ?? ctx.color.scheme[ctx.color.clrMap.tx1 ?? 'dk1'] ?? '#000000',
      };
      if (rp.b) run.bold = true;
      if (rp.i) run.italic = true;
      if (rp.u) run.underline = true;
      if (rp.strike) run.strike = true;
      if (rp.highlight) run.highlight = rp.highlight;
      return run;
    };
    for (const c of kids(p)) {
      if (c.localName === 'r' || c.localName === 'fld') runs.push(toRun(kid(c, 'rPr'), kid(c, 't')?.textContent ?? ''));
      else if (c.localName === 'br') runs.push(toRun(kid(c, 'rPr'), '\n'));
    }
    // 연속된 같은 서식 런 병합
    const merged: TextRun[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && sameRunStyle(last, r)) last.text += r.text;
      else merged.push(r);
    }
    if (!merged.length) merged.push(toRun(kid(p, 'endParaRPr'), ''));
    const fontSize = merged[0].fontSize ?? 18;
    let lineSpacing = pp.lnSpcPct ?? (pp.lnSpcPts ? pp.lnSpcPts / (fontSize * 1.2) : 1);
    if (body.lnSpcReduction) lineSpacing = Math.max(0.5, lineSpacing - body.lnSpcReduction);
    paragraphs.push({
      runs: merged,
      align: pp.algn ?? 'left',
      lineSpacing: Math.round(lineSpacing * 100) / 100,
      bullet: pp.bullet ?? 'none',
      ...(pp.bullet === 'bullet' && pp.buChar && pp.buChar !== '•' ? { bulletChar: pp.buChar } : {}),
      level: lvl,
      // 줄 단위(%) 간격은 글꼴 크기 × 1.2 기준으로 pt 환산
      ...(pp.spcBefPts || pp.spcBefPct ? { spaceBefore: Math.round((pp.spcBefPts ?? (pp.spcBefPct ?? 0) * fontSize * 1.2) * 10) / 10 } : {}),
      ...(pp.spcAftPts || pp.spcAftPct ? { spaceAfter: Math.round((pp.spcAftPts ?? (pp.spcAftPct ?? 0) * fontSize * 1.2) * 10) / 10 } : {}),
    });
  }
  if (!paragraphs.length) {
    const rp = levels[0].run;
    paragraphs.push({ runs: [{ text: '', fontSize: rp.sz ?? 18, fontFamily: ctx.theme.minorLatin || 'Malgun Gothic', color: rp.color ?? '#000000' }], align: levels[0].algn ?? 'left', lineSpacing: 1, bullet: 'none', level: 0 });
  }
  return {
    paragraphs,
    vAlign: body.anchor ?? 'top',
    direction: body.vert ?? 'horizontal',
    padding: { left: body.lIns ?? 9.6, top: body.tIns ?? 4.8, right: body.rIns ?? 9.6, bottom: body.bIns ?? 4.8 },
    autoFit: body.autoFit === 'shrink' ? 'none' : body.autoFit ?? 'none', // 축소 배율은 이미 글꼴 크기에 반영
    wrap: body.wrap ?? true,
  };
}

const sameRunStyle = (a: TextRun, b: TextRun) =>
  a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && !!a.bold === !!b.bold && !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline && !!a.strike === !!b.strike && a.color === b.color && a.highlight === b.highlight;

/* ───────────── 기하 ───────────── */

interface Xform {
  ox: number; // 부모 좌표계 원점 (EMU)
  oy: number;
  sx: number; // EMU → px 배율
  sy: number;
}

const TOP: Xform = { ox: 0, oy: 0, sx: 1 / EMU_PER_PX, sy: 1 / EMU_PER_PX };

function readXfrm(xfrm: Element | null, tf: Xform) {
  if (!xfrm) return null;
  const off = kid(xfrm, 'off');
  const ext = kid(xfrm, 'ext');
  const x = numAttr(off, 'x') ?? 0;
  const y = numAttr(off, 'y') ?? 0;
  const cx = numAttr(ext, 'cx') ?? 0;
  const cy = numAttr(ext, 'cy') ?? 0;
  return {
    x: (x - tf.ox) * tf.sx,
    y: (y - tf.oy) * tf.sy,
    width: cx * tf.sx,
    height: cy * tf.sy,
    rotation: ((numAttr(xfrm, 'rot') ?? 0) / 60000 + 360) % 360,
    flipH: boolAttr(xfrm, 'flipH') ?? false,
    flipV: boolAttr(xfrm, 'flipV') ?? false,
    raw: { x, y, cx, cy },
    chOff: kid(xfrm, 'chOff'),
    chExt: kid(xfrm, 'chExt'),
  };
}

const PRESET_MAP: Record<string, ShapeKind> = {
  rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'rightTriangle', diamond: 'diamond',
  pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', star5: 'star5', rightArrow: 'rightArrow', leftArrow: 'leftArrow',
  upArrow: 'upArrow', downArrow: 'downArrow', chevron: 'chevron', parallelogram: 'parallelogram', trapezoid: 'trapezoid',
  heart: 'heart', cloud: 'cloud', plus: 'plus', flowChartProcess: 'rect', flowChartAlternateProcess: 'roundRect',
  flowChartDecision: 'diamond', flowChartConnector: 'ellipse', snip1Rect: 'rect', round1Rect: 'roundRect', round2SameRect: 'roundRect',
};

const LINE_PRESETS = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5']);

/** custGeom → 정규화 경로 */
function parseCustGeom(cg: Element, w: number, h: number, ctx: ShapeCtx): CustomGeometry {
  const paths: CustomGeometry['paths'] = [];
  let unresolved = false;
  for (const p of kids(kid(cg, 'pathLst'), 'path')) {
    const pw = numAttr(p, 'w') || w || 1;
    const ph = numAttr(p, 'h') || h || 1;
    const cmds: PathCommand[] = [];
    let cur = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };
    const pt = (el: Element | null) => {
      const x = numAttr(el, 'x');
      const y = numAttr(el, 'y');
      if (x === undefined || y === undefined) unresolved = true;
      return { x: (x ?? 0) / pw, y: (y ?? 0) / ph };
    };
    for (const c of kids(p)) {
      switch (c.localName) {
        case 'moveTo': {
          const a = pt(kid(c, 'pt'));
          cmds.push({ c: 'M', ...a });
          cur = a;
          start = a;
          break;
        }
        case 'lnTo': {
          const a = pt(kid(c, 'pt'));
          cmds.push({ c: 'L', ...a });
          cur = a;
          break;
        }
        case 'cubicBezTo': {
          const [p1, p2, p3] = kids(c, 'pt').map(pt);
          if (p3) {
            cmds.push({ c: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y });
            cur = p3;
          }
          break;
        }
        case 'quadBezTo': {
          const [q1, q2] = kids(c, 'pt').map(pt);
          if (q2) {
            cmds.push({ c: 'C', x1: cur.x + (2 / 3) * (q1.x - cur.x), y1: cur.y + (2 / 3) * (q1.y - cur.y), x2: q2.x + (2 / 3) * (q1.x - q2.x), y2: q2.y + (2 / 3) * (q1.y - q2.y), x: q2.x, y: q2.y });
            cur = q2;
          }
          break;
        }
        case 'arcTo': {
          const wR = (numAttr(c, 'wR') ?? 0) / pw;
          const hR = (numAttr(c, 'hR') ?? 0) / ph;
          const st = ((numAttr(c, 'stAng') ?? 0) / 60000) * (Math.PI / 180);
          const sw = ((numAttr(c, 'swAng') ?? 0) / 60000) * (Math.PI / 180);
          const cx = cur.x - wR * Math.cos(st);
          const cy = cur.y - hR * Math.sin(st);
          const segs = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
          const d = sw / segs;
          let a0 = st;
          for (let i = 0; i < segs; i++) {
            const a1 = a0 + d;
            const k = (4 / 3) * Math.tan(d / 4);
            const x0 = cx + wR * Math.cos(a0), y0 = cy + hR * Math.sin(a0);
            const x3 = cx + wR * Math.cos(a1), y3 = cy + hR * Math.sin(a1);
            cmds.push({
              c: 'C',
              x1: x0 - k * wR * Math.sin(a0), y1: y0 + k * hR * Math.cos(a0),
              x2: x3 + k * wR * Math.sin(a1), y2: y3 - k * hR * Math.cos(a1),
              x: x3, y: y3,
            });
            a0 = a1;
            cur = { x: x3, y: y3 };
          }
          break;
        }
        case 'close':
          cmds.push({ c: 'Z' });
          cur = start;
          break;
      }
    }
    paths.push({ cmds, fill: p.getAttribute('fill') !== 'none', stroke: p.getAttribute('stroke') !== '0' && p.getAttribute('stroke') !== 'false' });
  }
  if (unresolved) ctx.report.approximated.push('수식(가이드)을 사용하는 자유형 도형 일부가 근사 표시됩니다.');
  return { paths };
}

/* ───────────── 도형 트리 ───────────── */

async function parseSpTree(tree: Element | null, ctx: ShapeCtx, skipPlaceholders: boolean, tf: Xform = TOP, groupFill?: Fill): Promise<SlideObject[]> {
  const out: SlideObject[] = [];
  for (const el of kids(tree)) {
    try {
      const o = await parseElement(el, ctx, skipPlaceholders, tf, groupFill);
      if (o) out.push(o);
    } catch (e) {
      ctx.report.warnings.push(`개체를 해석하지 못했습니다 (${el.localName}): ${(e as Error).message}`);
    }
  }
  return out;
}

async function parseElement(el: Element, ctx: ShapeCtx, skipPlaceholders: boolean, tf: Xform, groupFill?: Fill): Promise<SlideObject | null> {
  switch (el.localName) {
    case 'sp':
      return parseSp(el, ctx, skipPlaceholders, tf, groupFill);
    case 'cxnSp':
      return parseConnector(el, ctx, tf);
    case 'pic':
      return parsePic(el, ctx, tf);
    case 'grpSp':
      return parseGroup(el, ctx, skipPlaceholders, tf, groupFill);
    case 'graphicFrame':
      return parseGraphicFrame(el, ctx, tf);
    case 'AlternateContent': {
      // 호환 대체 콘텐츠: Fallback(가장 호환성 높은 표현)을 사용
      const fb = kid(el, 'Fallback') ?? kid(el, 'Choice');
      for (const c of kids(fb)) {
        const o = await parseElement(c, ctx, skipPlaceholders, tf, groupFill);
        if (o) return o;
      }
      return null;
    }
    case 'contentPart':
      return unsupported(el, 'other', '잉크/콘텐츠 파트', ctx, tf, null);
    case 'nvGrpSpPr':
    case 'grpSpPr':
    case 'extLst':
      return null;
    default:
      ctx.report.warnings.push(`알 수 없는 요소 '${el.localName}'를 원본 그대로 보존했습니다.`);
      return unsupported(el, 'other', el.localName, ctx, tf, null);
  }
}

function baseProps(el: Element, nvName: string) {
  const cNvPr = path(el, nvName, 'cNvPr');
  return {
    name: cNvPr?.getAttribute('name') || '',
    sourceId: numAttr(cNvPr, 'id'),
    hidden: boolAttr(cNvPr, 'hidden') || undefined,
  };
}

const PH_PROMPTS: Record<string, string> = {
  title: '제목을 입력하십시오',
  ctrTitle: '제목을 입력하십시오',
  subTitle: '부제목을 입력하십시오',
  body: '텍스트를 입력하십시오',
  obj: '텍스트를 입력하십시오',
};

async function parseSp(sp: Element, ctx: ShapeCtx, skipPlaceholders: boolean, tf: Xform, groupFill?: Fill): Promise<SlideObject | null> {
  const ph = path(sp, 'nvSpPr', 'nvPr', 'ph');
  if (ph && skipPlaceholders) return null; // 레이아웃/마스터의 개체 틀은 디자인 개체가 아님
  const phType = ph ? ph.getAttribute('type') ?? 'obj' : null;
  const phIdx = ph?.getAttribute('idx') ?? undefined;
  // 슬라이드의 날짜/바닥글/번호 개체 틀은 텍스트가 있을 때만
  const spPr = kid(sp, 'spPr');
  const base = baseProps(sp, 'nvSpPr');

  // 개체 틀 상속: 레이아웃 → 마스터
  const layoutPh = ph && ctx.layout ? findPlaceholder(ctx.layout.placeholders, phType!, phIdx) : undefined;
  const masterPh = ph ? findPlaceholder(ctx.master.placeholders, layoutPh?.type ?? phType!, undefined) : undefined;

  let geo = readXfrm(kid(spPr, 'xfrm'), tf);
  if (!geo && layoutPh) geo = readXfrm(path(layoutPh.el, 'spPr', 'xfrm'), tf);
  if (!geo && masterPh) geo = readXfrm(path(masterPh.el, 'spPr', 'xfrm'), tf);
  if (!geo) return null;

  const prstGeom = kid(spPr, 'prstGeom') ?? (layoutPh ? path(layoutPh.el, 'spPr', 'prstGeom') : null);
  const custGeom = kid(spPr, 'custGeom');
  const prst = prstGeom?.getAttribute('prst') ?? (custGeom ? null : 'rect');

  // 선 모양 프리셋은 선 개체로
  if (prst && LINE_PRESETS.has(prst)) return parseConnector(sp, ctx, tf, 'nvSpPr');

  // 스타일 참조 (p:style)
  const style = kid(sp, 'style');
  const fillRefColor = resolveColor(kid(style, 'fillRef'), ctx.color)?.hex;
  const lnRef = kid(style, 'lnRef');
  const lnRefColor = resolveColor(lnRef, ctx.color)?.hex;
  const lnRefIdx = numAttr(lnRef, 'idx') ?? 0;
  const fontRefColor = resolveColor(kid(style, 'fontRef'), ctx.color)?.hex;

  let fill = await finalizeFill(parseFill(spPr, ctx.color, groupFill), ctx);
  if (!fill && layoutPh) fill = await finalizeFill(parseFill(path(layoutPh.el, 'spPr'), ctx.color), ctx);
  if (!fill) {
    const idx = numAttr(kid(style, 'fillRef'), 'idx') ?? 0;
    const fs = idx > 0 ? ctx.theme.fillStyles[idx - 1] : undefined;
    if (fs && fillRefColor) {
      const w = fs.ownerDocument.createElement('w');
      w.appendChild(fs.cloneNode(true));
      fill = await finalizeFill(parseFill(w, { ...ctx.color, phClr: fillRefColor }), ctx);
    }
  }
  fill ??= { type: 'none' };

  const lnRes = parseLine(kid(spPr, 'ln'), ctx.color, lnRefIdx > 0 ? lnRefColor : undefined, ctx.theme.lineWidths[lnRefIdx - 1]);
  let stroke: Stroke | null = lnRes.stroke ?? null;
  if (lnRes.stroke === undefined && lnRefIdx > 0 && lnRefColor) stroke = { color: lnRefColor, width: ctx.theme.lineWidths[lnRefIdx - 1] ?? 0.75, dash: 'solid' };

  // 텍스트 스타일 체인
  let levels: LevelStyles;
  let bodyChain: BodyProps = {};
  if (ph) {
    const t = normPhType(layoutPh?.type ?? phType!);
    const master = t === 'title' ? ctx.master.titleStyle : ['dt', 'ftr', 'sldNum'].includes(t) ? ctx.master.otherStyle : ctx.master.bodyStyle;
    levels = mergeLevels(
      master,
      masterPh ? parseLstStyle(path(masterPh.el, 'txBody', 'lstStyle'), ctx.color) : null,
      layoutPh ? parseLstStyle(path(layoutPh.el, 'txBody', 'lstStyle'), ctx.color) : null,
    );
    bodyChain = mergeBody(parseBodyPr(path(masterPh?.el, 'txBody', 'bodyPr')), parseBodyPr(path(layoutPh?.el, 'txBody', 'bodyPr')));
  } else {
    levels = mergeLevels(ctx.defaultTextStyle, emptyLevels());
  }
  const txBody = kid(sp, 'txBody');
  const text = buildTextBody(txBody, { levels, body: bodyChain, fontRefColor }, ctx);
  const isEmpty = text.paragraphs.every((p) => p.runs.every((r) => !r.text));
  if (ph && isEmpty && ['dt', 'ftr', 'sldNum', 'hdr'].includes(phType!)) return null;

  const common = {
    id: newId(),
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    ...(geo.flipH ? { flipH: true } : {}),
    ...(geo.flipV ? { flipV: true } : {}),
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    ...(base.hidden ? { hidden: true } : {}),
  };

  const isTextBox = boolAttr(path(sp, 'nvSpPr', 'cNvSpPr'), 'txBox') || !!ph;
  if ((prst === 'rect' || !prst) && !custGeom && isTextBox) {
    const obj: TextObject = {
      ...common,
      type: 'text',
      name: base.name || (ph ? '개체 틀' : '텍스트 상자'),
      text,
      fill,
      stroke,
      ...(ph && PH_PROMPTS[phType!] ? { placeholder: PH_PROMPTS[phType!] } : {}),
    };
    return obj;
  }

  let kind: ShapeKind = 'rect';
  let geometry: CustomGeometry | undefined;
  let sourcePreset: string | undefined;
  if (custGeom) {
    kind = 'custom';
    geometry = parseCustGeom(custGeom, geo.raw.cx, geo.raw.cy, ctx);
  } else if (prst && PRESET_MAP[prst]) {
    kind = PRESET_MAP[prst];
    if (PRESET_MAP[prst] !== prst && prst !== 'rtTriangle') sourcePreset = prst;
  } else if (prst) {
    sourcePreset = prst;
    ctx.report.approximated.push(`도형 '${prst}'은(는) 사각형으로 근사 표시되며, 저장 시 원래 도형으로 기록됩니다.`);
  }
  if (kids(kid(spPr, 'effectLst')).length || kid(spPr, 'scene3d') || kid(spPr, 'sp3d')) ctx.report.approximated.push('그림자·광선·3차원 등 도형 효과는 표시·저장되지 않습니다.');
  if (prstGeom && kids(kid(prstGeom, 'avLst')).length) ctx.report.approximated.push('도형 조정 핸들 값(모서리 반경 등)은 기본값으로 표시됩니다.');

  const obj: ShapeObject = {
    ...common,
    type: 'shape',
    name: base.name || '도형',
    shape: kind,
    ...(geometry ? { geometry } : {}),
    ...(sourcePreset ? { sourcePreset } : {}),
    fill,
    stroke,
    text,
  };
  return obj;
}

async function parseConnector(el: Element, ctx: ShapeCtx, tf: Xform, nv = 'nvCxnSpPr'): Promise<LineObject | null> {
  const spPr = kid(el, 'spPr');
  const geo = readXfrm(kid(spPr, 'xfrm'), tf);
  if (!geo) return null;
  const base = baseProps(el, nv);
  const style = kid(el, 'style');
  const lnRef = kid(style, 'lnRef');
  const lnRefIdx = numAttr(lnRef, 'idx') ?? 0;
  const lnRefColor = resolveColor(lnRef, ctx.color)?.hex;
  const res = parseLine(kid(spPr, 'ln'), ctx.color, lnRefColor, ctx.theme.lineWidths[lnRefIdx - 1]);
  const prst = path(spPr, 'prstGeom')?.getAttribute('prst');
  if (prst && prst !== 'line' && prst !== 'straightConnector1') ctx.report.approximated.push('꺾인/곡선 연결선은 직선으로 표시됩니다.');
  const stroke: Stroke = res.stroke ?? (lnRefColor ? { color: lnRefColor, width: ctx.theme.lineWidths[lnRefIdx - 1] ?? 0.75, dash: 'solid' } : { color: '#000000', width: 0.75, dash: 'solid' });
  return {
    id: newId(),
    type: 'line',
    name: base.name || '선',
    x: geo.x,
    y: geo.y,
    width: geo.width,
    height: geo.height,
    rotation: geo.rotation,
    ...(geo.flipH ? { flipH: true } : {}),
    ...(geo.flipV ? { flipV: true } : {}),
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    stroke,
    headStart: res.headStart,
    headEnd: res.headEnd,
  };
}

async function parsePic(pic: Element, ctx: ShapeCtx, tf: Xform): Promise<SlideObject | null> {
  const spPr = kid(pic, 'spPr');
  const geo = readXfrm(kid(spPr, 'xfrm'), tf);
  if (!geo) return null;
  const base = baseProps(pic, 'nvPicPr');
  const nvPr = path(pic, 'nvPicPr', 'nvPr');
  if (kid(nvPr, 'videoFile') || kid(nvPr, 'audioFile') || descendants(nvPr ?? pic, 'media').length) {
    return unsupported(pic, 'media', base.name || '미디어', ctx, tf, null);
  }
  const blipFill = kid(pic, 'blipFill');
  const blip = kid(blipFill, 'blip');
  const rId = rAttr(blip, 'embed');
  const assetId = rId ? await assetFromRel(rId, ctx) : null;
  if (!assetId) {
    // EMF/WMF/TIFF 등 브라우저가 표시할 수 없는 그림 → 원본 보존
    return unsupported(pic, 'image', base.name || '그림 (EMF/WMF 등)', ctx, tf, null);
  }
  const src = kid(blipFill, 'srcRect');
  const c = (k: string) => Math.max(0, (numAttr(src, k) ?? 0) / 100000);
  const asset = ctx.assets[assetId];
  const ln = parseLine(kid(spPr, 'ln'), ctx.color);
  const amt = numAttr(kid(blip, 'alphaModFix'), 'amt');
  const img: ImageObject = {
    id: newId(),
    type: 'image',
    name: base.name || '그림',
    assetId,
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    ...(geo.flipH ? { flipH: true } : {}),
    ...(geo.flipV ? { flipV: true } : {}),
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    ...(base.hidden ? { hidden: true } : {}),
    ...(amt !== undefined ? { opacity: amt / 100000 } : {}),
    crop: { left: c('l'), top: c('t'), right: c('r'), bottom: c('b') },
    stroke: ln.stroke ?? null,
    // 원본 비율: 자르기 전 표시 크기로 추정 (픽셀 크기는 렌더링에 필요하지 않음)
    naturalWidth: Math.round(Math.max(1, geo.width) / Math.max(0.05, 1 - c('l') - c('r'))),
    naturalHeight: Math.round(Math.max(1, geo.height) / Math.max(0.05, 1 - c('t') - c('b'))),
  };
  void asset;
  return img;
}

async function parseGroup(grp: Element, ctx: ShapeCtx, skipPlaceholders: boolean, tf: Xform, parentGroupFill?: Fill): Promise<GroupObject | null> {
  const grpSpPr = kid(grp, 'grpSpPr');
  const geo = readXfrm(kid(grpSpPr, 'xfrm'), tf);
  if (!geo) return null;
  const base = baseProps(grp, 'nvGrpSpPr');
  const chOffX = numAttr(geo.chOff, 'x') ?? geo.raw.x;
  const chOffY = numAttr(geo.chOff, 'y') ?? geo.raw.y;
  const chExtX = numAttr(geo.chExt, 'cx') || geo.raw.cx || 1;
  const chExtY = numAttr(geo.chExt, 'cy') || geo.raw.cy || 1;
  // 자식 좌표 → 그룹 왼쪽 위 기준 px
  const childTf: Xform = { ox: chOffX, oy: chOffY, sx: geo.width / chExtX, sy: geo.height / chExtY };
  const gfill = (await finalizeFill(parseFill(grpSpPr, ctx.color, parentGroupFill), ctx)) ?? parentGroupFill;
  const children = await parseSpTree(grp, ctx, skipPlaceholders, childTf, gfill ?? undefined);
  if (!children.length) return null;
  if (geo.flipH || geo.flipV) ctx.report.approximated.push('대칭된 그룹은 대칭 없이 표시됩니다.');
  return {
    id: newId(),
    type: 'group',
    name: base.name || '그룹',
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    children,
  };
}

const GRAPHIC_KINDS: [string, UnsupportedKind, string][] = [
  ['/drawingml/2006/table', 'table', '표'],
  ['/drawingml/2006/chart', 'chart', '차트'],
  ['/drawingml/2014/chartex', 'chart', '차트'],
  ['/drawingml/2006/diagram', 'smartart', 'SmartArt'],
  ['/presentationml/2006/ole', 'ole', 'OLE 개체'],
];

async function parseGraphicFrame(gf: Element, ctx: ShapeCtx, tf: Xform): Promise<SlideObject | null> {
  const uri = path(gf, 'graphic', 'graphicData')?.getAttribute('uri') ?? '';
  const match = GRAPHIC_KINDS.find(([u]) => uri.endsWith(u));
  const kind = match?.[1] ?? 'other';
  const base = baseProps(gf, 'nvGraphicFramePr');
  let preview: UnsupportedObject['preview'] = undefined;
  if (kind === 'table') {
    const tbl = descendants(gf, 'tbl')[0];
    if (tbl) {
      preview = {
        cols: kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => (numAttr(g, 'w') ?? 0) / EMU_PER_PX),
        rows: kids(tbl, 'tr').map((tr) => ({
          height: (numAttr(tr, 'h') ?? 0) / EMU_PER_PX,
          cells: kids(tr, 'tc').map((tc) => kids(kid(tc, 'txBody'), 'p').map((p) => descendants(p, 't').map((t) => t.textContent ?? '').join('')).join('\n')),
        })),
      };
    }
  }
  return unsupported(gf, kind, `${match?.[2] ?? '개체'}${base.name ? ` · ${base.name}` : ''}`, ctx, tf, preview ?? null);
}

function unsupported(el: Element, kind: UnsupportedKind, label: string, ctx: ShapeCtx, tf: Xform, preview: UnsupportedObject['preview'] | null): UnsupportedObject | null {
  // 위치: p:xfrm(graphicFrame) 또는 spPr/grpSpPr의 a:xfrm
  const xfrm = kid(el, 'xfrm') ?? path(el, 'spPr', 'xfrm') ?? path(el, 'grpSpPr', 'xfrm') ?? descendants(el, 'xfrm')[0] ?? null;
  const geo = readXfrm(xfrm, tf) ?? { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  const cNvPr = descendants(el, 'cNvPr')[0];
  ctx.report.unsupported[kind] = (ctx.report.unsupported[kind] ?? 0) + 1;
  return {
    id: newId(),
    type: 'unsupported',
    kind,
    label,
    name: cNvPr?.getAttribute('name') || label,
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    ...(numAttr(cNvPr, 'id') !== undefined ? { sourceId: numAttr(cNvPr, 'id') } : {}),
    sourceXml: serializeElement(el),
    sourcePart: ctx.part,
    ...(preview ? { preview } : {}),
  };
}

