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
  TableObject, TableCell, CellBorders, ChartObject, ChartType, MediaObject, MasterSlide, PlaceholderType, SlideTransition, Animation, EquationObject, SlideComment, ExtensionObject,
} from '../../types/model';
import { MATH_RUN_TEXT } from '../../types/model';
import type { Rel } from './ooxml';
import { contentFingerprint, mediaPlaybackSignature } from '../../core/document/fingerprint';
import { parseTiming, parseTransition } from './animImport';
import { parseCustomShows, parseShowPr } from '../export/showXml';
import { applyTableStyle } from '../../editors/table/table';
import { newId } from '../../utils/id';
import { MIME_BY_EXT, NS, OoxmlPackage, REL, WEB_IMAGE_EXT, boolAttr, descendants, kid, kids, numAttr, path, rAttr, serializeElement } from './ooxml';
import { highlightColor, parseFill, parseLine, resolveColor, type ColorCtx, type FillResult } from './drawingml';

const EMU_PER_PX = 9525;

export { summarizeReport } from './report';
export type { ImportReport } from './report';
import type { ImportReport } from './report';
import { decodeEmbeddedFont, FONT_SLOTS, type ImportedEmbeddedFont } from '../fonts/embed';
import { ommlToLatex, tidyLatex } from '../math/omml';
import { parseLegacyAuthors, parseLegacyComments, parseModernAuthors, parseModernComments, REL_COMMENT_AUTHORS, REL_COMMENTS, REL_MODERN_AUTHORS, REL_MODERN_COMMENTS } from '../export/commentsXml';
import { latexToMathml } from '../math/equation';

export interface ImportResult {
  doc: Presentation;
  report: ImportReport;
  /** 동영상/오디오 바이너리 (호출자가 IndexedDB blobs에 저장) */
  blobs: { key: string; data: Uint8Array; mime: string }[];
  /** 포함 글꼴 (호출자가 내 글꼴에 추가) */
  fonts: ImportedEmbeddedFont[];
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
  /** 현재 파트의 관계 (동기 해석용, parseSpTree에서 채움) */
  relMap?: Map<string, Rel>;
  blobs?: ImportResult['blobs'];
  tableStyles?: Map<string, Element>;
}

/* ───────────── 진입점 ───────────── */

export async function importPptx(data: ArrayBuffer | Uint8Array | Blob, fileName = 'presentation.pptx'): Promise<ImportResult> {
  const pkg = await OoxmlPackage.load(data);
  const report: ImportReport = { fileName, slides: 0, objects: 0, unsupported: {}, converted: {}, preservedTransitions: 0, preservedTimings: 0, approximated: [], warnings: [] };
  const blobs: ImportResult['blobs'] = [];

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
  // 표 스타일 정의 (ppt/tableStyles.xml)
  const tableStyles = new Map<string, Element>();
  const tsRel = [...presRels.values()].find((r) => r.type.endsWith('/tableStyles'));
  const tsDoc = tsRel ? await pkg.xml(tsRel.target) : null;
  if (tsDoc) for (const st of kids(tsDoc.documentElement, 'tblStyle')) tableStyles.set(st.getAttribute('styleId') ?? '', st);
  const defaultTextStyle = parseLstStyle(kid(pres, 'defaultTextStyle'), null);

  const masters = new Map<string, MasterInfo>();
  const layouts = new Map<string, PartInfo>();
  const layoutDefs: Record<string, LayoutDef> = {};
  const layoutOrder: string[] = [];
  let docMaster: MasterSlide | null = null;
  let docMasterPart: string | null = null;
  /** 첫 마스터를 doc.master로 (디자인 개체 + 개체 틀). 이 마스터면 true */
  const ensureMasterSlide = async (m: MasterInfo, ctx: ShapeCtx): Promise<boolean> => {
    if (!docMasterPart) {
      docMasterPart = m.part;
      const root = m.doc.documentElement;
      const bgFill = await parseBackground(path(root, 'cSld', 'bg'), ctx);
      docMaster = {
        id: 'master',
        kind: 'master',
        name: path(root, 'cSld')?.getAttribute('name') || '슬라이드 마스터',
        objects: await parseSpTree(path(root, 'cSld', 'spTree'), ctx, false),
        background: bgFill ? { fill: bgFill } : null,
        notes: '',
        layout: '',
      };
    }
    return docMasterPart === m.part;
  };
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
      // 레이아웃: 디자인 개체 + 개체 틀(ph). 마스터 디자인은 doc.master에서 상속
      const lroot = doc.documentElement;
      const ctxBase = (part: string, layoutInfo: PartInfo | null): ShapeCtx => ({
        pkg, part, color: { scheme: master.theme.scheme, clrMap: master.clrMap }, theme: master.theme, master, layout: layoutInfo, isSlide: false,
        defaultTextStyle, assets, assetByPath, report, blobs, tableStyles,
      });
      const primary = await ensureMasterSlide(master, ctxBase(master.part, null));
      const objects: SlideObject[] = [];
      let showMasterShapes = lroot.getAttribute('showMasterSp') !== '0';
      // 두 번째 이후 마스터에 속한 레이아웃: 그 마스터의 디자인을 레이아웃에 합침
      if (!primary && showMasterShapes) {
        objects.push(...(await parseSpTree(path(master.doc.documentElement, 'cSld', 'spTree'), ctxBase(master.part, null), true)));
        showMasterShapes = false;
      }
      objects.push(...(await parseSpTree(path(lroot, 'cSld', 'spTree'), ctxBase(layoutPath, layout), false)));
      const lbg = await parseBackground(path(lroot, 'cSld', 'bg'), ctxBase(layoutPath, null));
      const mbg = primary ? null : await parseBackground(path(master.doc.documentElement, 'cSld', 'bg'), ctxBase(master.part, null));
      const bgFill = lbg ?? mbg;
      layoutDefs[layoutPath] = {
        id: layoutPath,
        kind: 'layout',
        name: path(lroot, 'cSld')?.getAttribute('name') || layoutPath.split('/').pop()!,
        objects,
        background: bgFill ? { fill: bgFill } : null,
        notes: '',
        layout: '',
        ...(showMasterShapes ? {} : { showMasterShapes: false }),
      };
      layoutOrder.push(layoutPath);
    }
    return { layout, master };
  };

  // 슬라이드 순서
  const sldIds = kids(kid(pres, 'sldIdLst'), 'sldId');
  const slides: Slide[] = [];
  const idToSlide = new Map<string, string>();
  const ridToSlide = new Map<string, string>();
  let firstTheme: ThemeInfo | null = null;
  let firstMaster: MasterInfo | null = null;

  // 메모 작성자 (기존 메모: commentAuthors.xml, 최신 메모: authors.xml)
  const legacyAuthorsRel = [...presRels.values()].find((r) => r.type === REL_COMMENT_AUTHORS);
  const modernAuthorsRel = [...presRels.values()].find((r) => r.type === REL_MODERN_AUTHORS);
  const legacyAuthors = parseLegacyAuthors(legacyAuthorsRel ? await pkg.xml(legacyAuthorsRel.target) : null);
  const modernAuthors = parseModernAuthors(modernAuthorsRel ? await pkg.xml(modernAuthorsRel.target) : null);
  let commentCount = 0;

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
      defaultTextStyle, assets, assetByPath, report, blobs, tableStyles,
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
    let transition: SlideTransition | undefined;
    let animations: Animation[] | undefined;
    for (const c of kids(root)) {
      if (c.localName === 'transition' || (c.localName === 'AlternateContent' && descendants(c, 'transition').length)) {
        source.transitionXml = serializeElement(c);
        report.preservedTransitions++;
        transition = parseTransition(c) ?? undefined;
        if (transition) source.transitionFingerprint = JSON.stringify(transition);
      } else if (c.localName === 'timing') {
        source.timingXml = serializeElement(c);
        report.preservedTimings++;
        const r = parseTiming(c, objects, width, height);
        if (r.animations.length) animations = r.animations;
        // 미디어 자동 재생 / 쇼 중 숨기기 / 반복
        for (const o of objects) {
          const m = o.type === 'media' && o.sourceId !== undefined ? r.media.get(String(o.sourceId)) : undefined;
          if (!m || o.type !== 'media') continue;
          if (m.autoPlay) o.autoPlay = true;
          if (m.hideInShow) o.hideInShow = true;
          if (m.loop) o.loop = true;
        }
        source.animationFingerprint = JSON.stringify(r.animations);
        if (r.approximated) report.approximated.push('일부 애니메이션은 비슷한 효과로 표시됩니다 (내용을 바꾸지 않으면 저장 시 원본 유지).');
        if (r.skipped) report.approximated.push('그룹 안 개체나 텍스트 단락 등을 대상으로 한 애니메이션 일부는 편집 목록에 표시되지 않습니다 (저장 시 원본 유지).');
      }
    }

    source.mediaFingerprint = mediaPlaybackSignature(objects);
    const slide: Slide = {
      id: newId(),
      objects,
      background: bg ? { fill: bg } : null,
      notes,
      layout: layout.part,
      source,
      ...(transition && transition.type !== 'none' ? { transition } : transition ? { transition } : {}),
      ...(animations ? { animations } : {}),
      ...(root.getAttribute('show') === '0' ? { hidden: true } : {}),
      ...(root.getAttribute('showMasterSp') === '0' ? { showMasterShapes: false } : {}),
    };
    // 메모
    const comments: SlideComment[] = [];
    for (const r of (await pkg.rels(slidePath)).values()) {
      if (r.type !== REL_COMMENTS && r.type !== REL_MODERN_COMMENTS) continue;
      const cdoc = await pkg.xml(r.target);
      if (!cdoc) continue;
      if (r.type === REL_COMMENTS) comments.push(...parseLegacyComments(cdoc, legacyAuthors));
      else comments.push(...parseModernComments(cdoc, modernAuthors, (id) => objects.find((o) => String(o.sourceId) === id)?.id));
    }
    if (comments.length) {
      slide.comments = comments;
      commentCount += comments.length;
    }
    slides.push(slide);
    idToSlide.set(sid.getAttribute('id') ?? '', slide.id);
    ridToSlide.set(rAttr(sid, 'id') ?? '', slide.id);
    report.objects += countObjects(objects);
  }
  // 첫 마스터의 레이아웃 전체 (사용되지 않은 레이아웃도 새 슬라이드용으로 가져옴, 마스터의 순서대로)
  if (docMasterPart) {
    const mrels = await pkg.rels(docMasterPart);
    const mroot = (await pkg.xml(docMasterPart))!.documentElement;
    for (const lid of kids(kid(mroot, 'sldLayoutIdLst'), 'sldLayoutId')) {
      const r = mrels.get(rAttr(lid, 'id') ?? '');
      if (r && !layoutDefs[r.target]) await loadLayout(r.target);
    }
    // 마스터 순서로 정렬
    const order = kids(kid(mroot, 'sldLayoutIdLst'), 'sldLayoutId').map((lid) => mrels.get(rAttr(lid, 'id') ?? '')?.target).filter((x): x is string => !!x);
    layoutOrder.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
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
    defaultTextStyle, assets, assetByPath, report, blobs, tableStyles,
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

  // 재구성한 쇼 + 슬라이드 쇼 설정 (presProps.xml)
  const custom = parseCustomShows(pres, (rid) => ridToSlide.get(rid), newId);
  const propsRel = [...presRels.values()].find((r) => r.type.endsWith('/presProps'));
  const propsDoc = propsRel ? await pkg.xml(propsRel.target) : null;
  const showSettings = parseShowPr(kid(propsDoc?.documentElement ?? null, 'showPr'), custom.idMap, slides.length);

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
    layoutOrder,
    ...(docMaster ? { master: docMaster } : {}),
    ...(showSettings ? { showSettings } : {}),
    ...(custom.shows.length ? { customShows: custom.shows } : {}),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  // 포함 글꼴 (p:embeddedFontLst → ppt/fonts/*.fntdata)
  const fonts: ImportedEmbeddedFont[] = [];
  for (const ef of kids(kid(pres, 'embeddedFontLst'), 'embeddedFont')) {
    const typeface = kid(ef, 'font')?.getAttribute('typeface');
    if (!typeface) continue;
    for (const slot of FONT_SLOTS) {
      const rid = kid(ef, slot)?.getAttributeNS(NS.r, 'id');
      const rel = rid ? presRels.get(rid) : undefined;
      const bytes = rel ? await pkg.bytes(rel.target) : null;
      if (!bytes) continue;
      try {
        fonts.push(decodeEmbeddedFont(typeface, slot, bytes));
      } catch (e) {
        report.warnings.push(`포함 글꼴 '${typeface}'(${slot})을 읽지 못했습니다: ${(e as Error).message}`);
      }
    }
  }
  if (fonts.length) doc.embedFonts = true;
  else if (pres.getAttribute('embedTrueTypeFonts') === '1') doc.embedFonts = true;
  report.embeddedFonts = [...new Set(fonts.map((f) => f.typeface))];
  if (commentCount) report.comments = commentCount;
  report.approximated = [...new Set(report.approximated)];
  report.warnings = [...new Set(report.warnings)];
  return { doc, report, blobs, fonts };
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
      const hl = kid(rPr, 'hlinkClick');
      const rid = hl ? rAttr(hl, 'id') : undefined;
      const rel = rid ? ctx.relMap?.get(rid) : undefined;
      if (rel?.external && /^(https?:|mailto:)/i.test(rel.target)) run.link = rel.target;
      return run;
    };
    for (const c of kids(p)) {
      if (c.localName === 'r' || c.localName === 'fld') runs.push(toRun(kid(c, 'rPr'), kid(c, 't')?.textContent ?? ''));
      else if (c.localName === 'br') runs.push(toRun(kid(c, 'rPr'), '\n'));
      else if (c.localName === 'm') {
        // 문단 안 수식 (a14:m › m:oMath / m:oMathPara)
        for (const m of kids(c)) {
          if (m.localName !== 'oMathPara' && m.localName !== 'oMath') continue;
          const latex = tidyLatex(ommlToLatex(m));
          const { mathml } = latexToMathml(latex);
          runs.push({ ...toRun(descendants(m, 'rPr').find((x) => x.namespaceURI === NS.a) ?? kid(p, 'endParaRPr'), MATH_RUN_TEXT), math: { latex, mathml, sourceOmml: { xml: serializeElement(m), latex } } });
        }
      }
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
  !a.math && !b.math && a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && !!a.bold === !!b.bold && !!a.italic === !!b.italic &&
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
  ctx.relMap ??= await ctx.pkg.rels(ctx.part);
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
      if (descendants(el, 'oMath').length && !path(el, 'nvSpPr', 'nvPr', 'ph')) {
        const eq = parseEquation(el, ctx, tf);
        if (eq) return eq;
      }
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
      // 수식(a14:m)은 Choice에서 편집할 수 있는 수식으로
      const choice = kid(el, 'Choice');
      // PowerPoint 3D 모델(am3d:model3d): GLB + 대체 그림, 원본 XML 보존
      if (choice && descendants(choice, 'model3d').length) {
        const m = await parseModel3D(el, choice, ctx, tf);
        if (m) return m;
      }
      if (choice && descendants(choice, 'oMath').length) {
        for (const c of kids(choice)) {
          if (c.localName !== 'sp') continue;
          const eq = parseEquation(c, ctx, tf);
          if (eq) return eq;
          // 글자 + 문단 안 수식: Choice의 텍스트 상자 그대로
          const t = await parseSp(c, ctx, skipPlaceholders, tf, groupFill);
          if (t) return t;
        }
      }
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

const REL_MODEL3D = 'http://schemas.microsoft.com/office/2017/06/relationships/model3d';

/** am3d:trans/am3d:rot (60000분의 1도) → 회전 */
function readModelRotation(m3d: Element | undefined) {
  const rot = m3d ? descendants(m3d, 'rot')[0] : undefined;
  const deg = (k: string) => Math.round(((numAttr(rot ?? null, k) ?? 0) / 60000) * 100) / 100;
  return { rotX: deg('ax'), rotY: deg('ay'), rotZ: deg('az') };
}

/** PowerPoint 3D 모델 → 3D 모델 확장 개체 (GLB는 IndexedDB, 대체 그림은 Fallback 그림). 바꾸지 않으면 원본 XML 그대로 저장 */
async function parseModel3D(alt: Element, choice: Element, ctx: ShapeCtx, tf: Xform): Promise<ExtensionObject | null> {
  const gf = kids(choice).find((c) => c.localName === 'graphicFrame');
  const geo = gf ? readXfrm(kid(gf, 'xfrm'), tf) : null;
  const m3d = descendants(choice, 'model3d')[0];
  const rid = m3d ? rAttr(m3d, 'embed') : undefined;
  const rel = rid ? (await ctx.pkg.rels(ctx.part)).get(rid) : undefined;
  if (!gf || !geo || !rel || rel.external || (rel.type !== REL_MODEL3D && !/\.glb$/i.test(rel.target))) return null;
  const bytes = await ctx.pkg.bytes(rel.target);
  if (!bytes) return null;
  const base = baseProps(gf, 'nvGraphicFramePr', ctx);
  const blobKey = newId();
  ctx.blobs?.push({ key: blobKey, data: bytes, mime: 'model/gltf-binary' });
  const modelId = newId();
  ctx.assets[modelId] = { id: modelId, mime: 'model/gltf-binary', dataUrl: '', blobKey, name: rel.target.split('/').pop(), size: bytes.length };
  const blip = descendants(kid(alt, 'Fallback') ?? alt, 'blip')[0];
  const posterRid = blip ? rAttr(blip, 'embed') : undefined;
  const posterId = posterRid ? await assetFromRel(posterRid, ctx) : null;
  const obj: ExtensionObject = {
    id: newId(),
    type: 'extension',
    kind: 'model3d',
    name: base.name || '3D 모델',
    sourceId: base.sourceId,
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    // PowerPoint가 그린 대체 그림을 그대로 보여 줌 (회전을 바꾸면 SlideLab이 다시 그림)
    data: { ...readModelRotation(m3d), zoom: 1, usePoster: true },
    assetId: modelId,
    ...(posterId ? { posterId } : {}),
  };
  obj.preserved = { xml: serializeElement(alt), part: ctx.part, fingerprint: contentFingerprint(obj) };
  return obj;
}

/** 수식이 든 텍스트 상자 → 수식 개체 (문단 안의 보통 글자는 \text{}로) */
function parseEquation(sp: Element, ctx: ShapeCtx, tf: Xform): EquationObject | null {
  const geo = readXfrm(path(sp, 'spPr', 'xfrm'), tf);
  if (!geo) return null;
  const base = baseProps(sp, 'nvSpPr', ctx);
  const paras = descendants(sp, 'p').filter((p) => p.namespaceURI === NS.a);
  const lines: string[] = [];
  const mathEls: Element[] = [];
  let plainText = false;
  let align: EquationObject['align'] = 'center';
  for (const p of paras) {
    let line = '';
    const algn = path(p, 'pPr')?.getAttribute('algn');
    if (algn === 'l') align = 'left';
    else if (algn === 'r') align = 'right';
    for (const c of kids(p)) {
      if (c.localName === 'r') {
        const t = kid(c, 't')?.textContent ?? '';
        if (t.trim()) {
          line += `\\text{${t.replace(/[\\{}]/g, (x) => `\\${x}`)}}`;
          plainText = true;
        }
      } else if (c.localName === 'm') {
        for (const m of kids(c)) {
          if (m.localName !== 'oMathPara' && m.localName !== 'oMath') continue;
          mathEls.push(m);
          const jc = path(m, 'oMathParaPr', 'jc')?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'val');
          if (jc === 'left') align = 'left';
          else if (jc === 'right') align = 'right';
          line += ommlToLatex(m);
        }
      }
    }
    if (line.trim()) lines.push(line);
  }
  if (!mathEls.length) return null;
  // 글자와 수식이 섞인 텍스트 상자는 문단 안 수식이 있는 텍스트 상자로
  if (plainText) return null;
  const latex = tidyLatex(lines.join(' \\\\ '));
  const { mathml, error } = latexToMathml(latex);
  if (error) ctx.report.warnings.push(`수식 일부를 해석하지 못했습니다 (${base.name || '수식'}): ${error}`);
  const firstRun = descendants(sp, 'rPr').find((r) => r.namespaceURI === NS.a) ?? descendants(sp, 'endParaRPr')[0];
  const sz = numAttr(firstRun ?? null, 'sz');
  const color = resolveColor(kid(firstRun ?? null, 'solidFill'), ctx.color)?.hex ?? '#000000';
  return {
    id: newId(),
    type: 'equation',
    name: base.name || '수식',
    sourceId: base.sourceId,
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    latex,
    mathml,
    fontSize: sz ? sz / 100 : 18,
    color,
    align,
    // 수식 하나만 있으면 원본 OMML을 보관 (바꾸지 않으면 그대로 저장)
    ...(mathEls.length === 1 && !plainText ? { sourceOmml: { xml: new XMLSerializer().serializeToString(mathEls[0]), latex } } : {}),
  };
}

function baseProps(el: Element, nvName: string, ctx?: ShapeCtx) {
  const cNvPr = path(el, nvName, 'cNvPr');
  const hl = kid(cNvPr, 'hlinkClick');
  const rid = hl ? rAttr(hl, 'id') : undefined;
  const rel = rid ? ctx?.relMap?.get(rid) : undefined;
  return {
    name: cNvPr?.getAttribute('name') || '',
    sourceId: numAttr(cNvPr, 'id'),
    hidden: boolAttr(cNvPr, 'hidden') || undefined,
    link: rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : undefined,
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
  const base = baseProps(sp, 'nvSpPr', ctx);

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
    ...(base.link ? { link: base.link } : {}),
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
      ...(ph ? { ph: { type: (['title', 'ctrTitle', 'subTitle', 'body', 'dt', 'ftr', 'sldNum'].includes(phType!) ? phType : 'body') as PlaceholderType, ...(phIdx !== undefined ? { idx: Number(phIdx) } : {}) } } : {}),
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
  const base = baseProps(pic, 'nvPicPr', ctx);
  const nvPr = path(pic, 'nvPicPr', 'nvPr');
  if (kid(nvPr, 'videoFile') || kid(nvPr, 'audioFile') || descendants(nvPr ?? pic, 'media').length) {
    return (await parseMedia(pic, nvPr!, geo, base, ctx, tf)) ?? unsupported(pic, 'media', base.name || '미디어', ctx, tf, null);
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
    ...(base.link ? { link: base.link } : {}),
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
  const base = baseProps(gf, 'nvGraphicFramePr', ctx);
  try {
    if (kind === 'table') {
      const t = parseTable(gf, ctx, tf, base);
      if (t) return t;
    } else if (kind === 'chart' && uri.endsWith('/drawingml/2006/chart')) {
      const c = await parseChart(gf, ctx, tf, base);
      if (c) return c;
    }
  } catch (e) {
    ctx.report.warnings.push(`${match?.[2] ?? '개체'}를 편집 가능한 형식으로 바꾸지 못해 원본으로 보존했습니다: ${(e as Error).message}`);
  }
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

/* ───────────── 표 ───────────── */

type Geo = NonNullable<ReturnType<typeof readXfrm>>;

function preservedOf(el: Element, ctx: ShapeCtx) {
  return { xml: serializeElement(el), part: ctx.part };
}

/** 개체 생성 후 내용 지문을 기록 (저장 시 원본 복원 판단) */
function seal<T extends SlideObject>(o: T, xml: { xml: string; part: string }): T {
  o.preserved = { ...xml, fingerprint: '' };
  o.preserved.fingerprint = contentFingerprint(o);
  return o;
}

function frameGeo(gf: Element, tf: Xform): Geo | null {
  return readXfrm(kid(gf, 'xfrm'), tf);
}

const TABLE_STYLE_PARTS = ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'lastCol', 'firstCol', 'lastRow', 'firstRow'] as const;

function lineOf(ln: Element | null, ctx: ShapeCtx): Stroke | null | undefined {
  if (!ln) return undefined;
  const r = parseLine(ln, ctx.color);
  return r.stroke === undefined ? undefined : r.stroke;
}

function parseTable(gf: Element, ctx: ShapeCtx, tf: Xform, base: ReturnType<typeof baseProps>): TableObject | null {
  const tbl = descendants(gf, 'tbl')[0];
  const geo = frameGeo(gf, tf);
  if (!tbl || !geo) return null;
  const sx = tf.sx, sy = tf.sy;
  const tblPr = kid(tbl, 'tblPr');
  const flag = (n: string) => boolAttr(tblPr, n) ?? false;
  const flags = { firstRow: flag('firstRow'), lastRow: flag('lastRow'), firstCol: flag('firstCol'), lastCol: flag('lastCol'), bandRow: flag('bandRow'), bandCol: flag('bandCol') };
  const styleId = kid(tblPr, 'tableStyleId')?.textContent?.trim() ?? '';
  const styleEl = styleId ? ctx.tableStyles?.get(styleId) : undefined;
  const columns = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => (numAttr(g, 'w') ?? 0) * sx);
  const trs = kids(tbl, 'tr');
  const levels = mergeLevels(ctx.defaultTextStyle, emptyLevels());

  const rows = trs.map((tr) => ({
    height: (numAttr(tr, 'h') ?? 0) * sy,
    cells: kids(tr, 'tc').map((tc): TableCell & { _explicit: { fill: boolean; b: Partial<Record<keyof CellBorders, boolean>> } } => {
      const tcPr = kid(tc, 'tcPr');
      const body = buildTextBody(kid(tc, 'txBody'), { levels, body: {} }, ctx);
      body.padding = {
        left: (numAttr(tcPr, 'marL') ?? 91440) / EMU_PER_PX,
        right: (numAttr(tcPr, 'marR') ?? 91440) / EMU_PER_PX,
        top: (numAttr(tcPr, 'marT') ?? 45720) / EMU_PER_PX,
        bottom: (numAttr(tcPr, 'marB') ?? 45720) / EMU_PER_PX,
      };
      const anchor = tcPr?.getAttribute('anchor');
      body.vAlign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
      const fillRes = parseFill(tcPr, ctx.color);
      const fill: Fill = fillRes && fillRes.type !== 'blip' ? fillRes : { type: 'none' };
      const bl = { left: lineOf(kid(tcPr, 'lnL'), ctx), right: lineOf(kid(tcPr, 'lnR'), ctx), top: lineOf(kid(tcPr, 'lnT'), ctx), bottom: lineOf(kid(tcPr, 'lnB'), ctx) };
      const gridSpan = numAttr(tc, 'gridSpan');
      const rowSpan = numAttr(tc, 'rowSpan');
      return {
        text: body,
        fill,
        borders: { left: bl.left ?? null, right: bl.right ?? null, top: bl.top ?? null, bottom: bl.bottom ?? null },
        ...(gridSpan && gridSpan > 1 ? { colSpan: gridSpan } : {}),
        ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
        ...(boolAttr(tc, 'hMerge') || boolAttr(tc, 'vMerge') ? { merged: true } : {}),
        _explicit: { fill: !!fillRes, b: { left: bl.left !== undefined, right: bl.right !== undefined, top: bl.top !== undefined, bottom: bl.bottom !== undefined } },
      };
    }),
  }));
  const nRows = rows.length, nCols = columns.length;
  const t: TableObject = {
    id: newId(),
    type: 'table',
    name: base.name || '표',
    x: geo.x,
    y: geo.y,
    width: columns.reduce((a, b) => a + b, 0),
    height: rows.reduce((a, r) => a + r.height, 0),
    rotation: 0,
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    columns,
    rows: rows as TableObject['rows'],
  };

  // 표 스타일 적용 (명시적 셀 서식이 우선)
  if (styleEl) {
    rows.forEach((row, r) =>
      row.cells.forEach((cell, c) => {
        const parts: Element[] = [];
        const dataRow = r - (flags.firstRow ? 1 : 0);
        const dataCol = c - (flags.firstCol ? 1 : 0);
        for (const name of TABLE_STYLE_PARTS) {
          const ok =
            name === 'wholeTbl' ||
            (name === 'band1H' && flags.bandRow && dataRow >= 0 && dataRow % 2 === 0) ||
            (name === 'band2H' && flags.bandRow && dataRow >= 0 && dataRow % 2 === 1) ||
            (name === 'band1V' && flags.bandCol && dataCol >= 0 && dataCol % 2 === 0) ||
            (name === 'band2V' && flags.bandCol && dataCol >= 0 && dataCol % 2 === 1) ||
            (name === 'lastCol' && flags.lastCol && c === nCols - 1) ||
            (name === 'firstCol' && flags.firstCol && c === 0) ||
            (name === 'lastRow' && flags.lastRow && r === nRows - 1) ||
            (name === 'firstRow' && flags.firstRow && r === 0);
          const el = ok ? kid(styleEl, name) : null;
          if (el) parts.push(el);
        }
        for (const part of parts) {
          const tcStyle = kid(part, 'tcStyle');
          if (!cell._explicit.fill) {
            const fr = kid(tcStyle, 'fill');
            const fref = kid(tcStyle, 'fillRef');
            const f = fr ? parseFill(fr, ctx.color) : fref ? { type: 'solid' as const, color: resolveColor(fref, ctx.color)?.hex ?? '#FFFFFF' } : null;
            if (f && f.type !== 'blip') cell.fill = f;
          }
          const bdr = kid(tcStyle, 'tcBdr');
          const side = (n: string) => {
            const el = kid(bdr, n);
            if (!el) return undefined;
            const ln = kid(el, 'ln');
            return ln ? lineOf(ln, ctx) ?? null : el.firstElementChild ? null : undefined;
          };
          const apply = (k: keyof CellBorders, v: Stroke | null | undefined) => {
            if (v !== undefined && !cell._explicit.b[k]) cell.borders[k] = v;
          };
          apply('left', c === 0 ? side('left') : side('insideV') ?? side('left'));
          apply('right', c === nCols - 1 ? side('right') : side('insideV') ?? side('right'));
          apply('top', r === 0 ? side('top') : side('insideH') ?? side('top'));
          apply('bottom', r === nRows - 1 ? side('bottom') : side('insideH') ?? side('bottom'));
          const tx = kid(part, 'tcTxStyle');
          if (tx) {
            const bold = tx.getAttribute('b');
            const col = resolveColor(tx, ctx.color);
            for (const p of cell.text.paragraphs)
              for (const run of p.runs) {
                if (bold === 'on') run.bold = true;
                if (col) run.color = col.hex;
              }
          }
        }
      }),
    );
  } else if (styleId) {
    // 정의가 파일에 없는 기본 제공 스타일: 보통 스타일 2 근사 (PowerPoint 기본 표 스타일)
    t.style = { preset: 'medium2', accent: 1, firstRow: flags.firstRow, bandRows: flags.bandRow, firstCol: flags.firstCol, lastRow: flags.lastRow };
    const snapshot = rows.map((row) => row.cells.map((cell) => ({ fill: cell._explicit.fill ? cell.fill : null, b: { ...cell.borders }, eb: cell._explicit.b })));
    applyTableStyle(t, ctxTheme(ctx));
    rows.forEach((row, r) =>
      row.cells.forEach((cell, c) => {
        const snap = snapshot[r][c];
        if (snap.fill) cell.fill = snap.fill;
        (Object.keys(snap.eb) as (keyof CellBorders)[]).forEach((k) => snap.eb[k] && (cell.borders[k] = snap.b[k]));
      }),
    );
    if (styleId !== '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}') ctx.report.approximated.push('정의가 파일에 없는 기본 제공 표 스타일은 "보통 스타일 2"로 근사 표시됩니다 (저장 시 원래 스타일 유지).');
  }
  rows.forEach((row) => row.cells.forEach((cell) => delete (cell as Partial<typeof cell>)._explicit));
  ctx.report.converted.table = (ctx.report.converted.table ?? 0) + 1;
  return seal(t, preservedOf(gf, ctx));
}

/** 표 스타일 근사에 쓰는 테마 (가져오기 중 테마 객체) */
function ctxTheme(ctx: ShapeCtx): Theme {
  const sc = ctx.theme.scheme;
  return {
    id: 'tmp',
    name: '',
    colors: {
      dark1: sc.dk1 ?? '#000000', light1: sc.lt1 ?? '#FFFFFF', dark2: sc.dk2 ?? '#44546A', light2: sc.lt2 ?? '#E7E6E6',
      accent1: sc.accent1 ?? '#4472C4', accent2: sc.accent2 ?? '#ED7D31', accent3: sc.accent3 ?? '#A5A5A5', accent4: sc.accent4 ?? '#FFC000', accent5: sc.accent5 ?? '#5B9BD5', accent6: sc.accent6 ?? '#70AD47',
    },
    fonts: { heading: ctx.theme.majorLatin, body: ctx.theme.minorLatin },
    background: { type: 'none' },
  };
}

/* ───────────── 차트 ───────────── */

const CHART_TAGS: Record<string, ChartType | null> = {
  barChart: 'column',
  lineChart: 'line',
  pieChart: 'pie',
  doughnutChart: 'doughnut',
  areaChart: 'area',
  scatterChart: 'scatter',
};

function cacheValues(ref: Element | null): string[] {
  if (!ref) return [];
  const cache = descendants(ref, 'strCache')[0] ?? descendants(ref, 'numCache')[0] ?? kid(ref, 'strLit') ?? kid(ref, 'numLit');
  if (!cache) return [];
  const n = numAttr(kid(cache, 'ptCount'), 'val') ?? 0;
  const out: string[] = Array(n).fill('');
  for (const pt of kids(cache, 'pt')) {
    const i = numAttr(pt, 'idx') ?? 0;
    out[i] = kid(pt, 'v')?.textContent ?? '';
  }
  return out;
}

async function parseChart(gf: Element, ctx: ShapeCtx, tf: Xform, base: ReturnType<typeof baseProps>): Promise<ChartObject | null> {
  const geo = frameGeo(gf, tf);
  const chartRef = descendants(gf, 'chart')[0];
  const rid = chartRef ? rAttr(chartRef, 'id') : undefined;
  const rel = rid ? ctx.relMap?.get(rid) : undefined;
  if (!geo || !rel || rel.external) return null;
  const cdoc = await ctx.pkg.xml(rel.target);
  if (!cdoc) return null;
  const chartEl = kid(cdoc.documentElement, 'chart');
  const plot = kid(chartEl, 'plotArea');
  const typeEls = kids(plot).filter((e) => e.localName.endsWith('Chart'));
  if (typeEls.length !== 1 || !(typeEls[0].localName in CHART_TAGS)) return null; // 복합/3D/방사형 등 → 원본 보존
  const te = typeEls[0];
  let chartType = CHART_TAGS[te.localName]!;
  if (chartType === 'column' && kid(te, 'barDir')?.getAttribute('val') === 'bar') chartType = 'bar';
  const grouping = kid(te, 'grouping')?.getAttribute('val') ?? 'clustered';
  if (grouping === 'percentStacked') ctx.report.approximated.push('100% 누적 차트는 일반 누적으로 표시됩니다 (저장 시 원래 설정 유지).');
  const sers = kids(te, 'ser');
  if (!sers.length) return null;
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const categories = chartType === 'scatter' ? [] : cacheValues(kid(sers[0], 'cat'));
  const series = sers.map((ser, i) => {
    const name = cacheValues(kid(ser, 'tx')).join('') || kid(kid(ser, 'tx'), 'v')?.textContent || `계열 ${i + 1}`;
    const color = resolveColor(path(ser, 'spPr', 'solidFill'), ctx.color)?.hex ?? resolveColor(path(ser, 'spPr', 'ln', 'solidFill'), ctx.color)?.hex;
    if (chartType === 'scatter') {
      return { name, values: cacheValues(kid(ser, 'yVal')).map(num), xValues: cacheValues(kid(ser, 'xVal')).map(num), ...(color ? { color } : {}) };
    }
    return { name, values: cacheValues(kid(ser, 'val')).map(num), ...(color && chartType !== 'pie' && chartType !== 'doughnut' ? { color } : {}) };
  });
  // 원형: 데이터 요소별 색
  let colors: string[] | undefined;
  if (chartType === 'pie' || chartType === 'doughnut') {
    const dpts = kids(sers[0], 'dPt');
    if (dpts.length) {
      colors = [];
      for (const d of dpts) {
        const idx = numAttr(kid(d, 'idx'), 'val') ?? 0;
        const col = resolveColor(path(d, 'spPr', 'solidFill'), ctx.color)?.hex;
        if (col) colors[idx] = col;
      }
    }
  }
  const titleEl = kid(chartEl, 'title');
  const title = titleEl ? descendants(titleEl, 't').map((t) => t.textContent ?? '').join('') : '';
  const autoDeleted = kid(chartEl, 'autoTitleDeleted')?.getAttribute('val') === '1';
  const legend = kid(chartEl, 'legend');
  const sz = numAttr(descendants(cdoc.documentElement, 'defRPr')[0] ?? null, 'sz');
  const c: ChartObject = {
    id: newId(),
    type: 'chart',
    name: base.name || '차트',
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: 0,
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
    chartType,
    categories,
    series,
    title: title || (series.length === 1 && !autoDeleted && titleEl ? series[0].name : title),
    showTitle: !!titleEl || (!autoDeleted && series.length === 1 && (chartType === 'pie' || chartType === 'doughnut')),
    showLegend: !!legend,
    legendPos: (kid(legend, 'legendPos')?.getAttribute('val') as ChartObject['legendPos']) ?? 'r',
    showDataLabels: descendants(te, 'showVal').some((e) => e.getAttribute('val') === '1'),
    stacked: grouping === 'stacked' || grouping === 'percentStacked',
    ...(colors?.length ? { colors } : {}),
    fontSize: sz ? sz / 100 : 10,
  };
  if (c.showTitle && !c.title) c.title = series[0]?.name ?? '';
  ctx.report.converted.chart = (ctx.report.converted.chart ?? 0) + 1;
  return seal(c, preservedOf(gf, ctx));
}

/* ───────────── 미디어 ───────────── */

async function parseMedia(pic: Element, nvPr: Element, geo: Geo, base: ReturnType<typeof baseProps>, ctx: ShapeCtx, tf: Xform): Promise<MediaObject | null> {
  void tf;
  const kind: MediaObject['kind'] = kid(nvPr, 'audioFile') ? 'audio' : 'video';
  // p14:media r:embed (내장) 우선, 없으면 videoFile/audioFile r:link
  const mediaEl = descendants(nvPr, 'media')[0];
  const rid = (mediaEl && rAttr(mediaEl, 'embed')) || rAttr(kid(nvPr, kind === 'audio' ? 'audioFile' : 'videoFile'), 'link');
  const rel = rid ? ctx.relMap?.get(rid) : undefined;
  if (!rel || rel.external) {
    ctx.report.warnings.push('외부 링크로 연결된 미디어는 원본 그대로 보존했습니다.');
    return null;
  }
  const data = await ctx.pkg.bytes(rel.target);
  if (!data) return null;
  const ext = rel.target.split('.').pop()!.toLowerCase();
  const mime = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', wma: 'audio/x-ms-wma', ogg: 'audio/ogg' }[ext] ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  if (['wmv', 'avi', 'wma'].includes(ext)) ctx.report.approximated.push(`${ext.toUpperCase()} 미디어는 브라우저에서 재생되지 않을 수 있습니다 (저장 시 원본 유지).`);
  const blobKey = newId();
  const assetId = newId();
  ctx.blobs?.push({ key: blobKey, data, mime });
  ctx.assets[assetId] = { id: assetId, mime, dataUrl: '', blobKey, name: rel.target.split('/').pop(), size: data.length };
  const posterRid = rAttr(path(pic, 'blipFill', 'blip'), 'embed');
  const posterId = posterRid ? await assetFromRel(posterRid, ctx) : null;
  const m: MediaObject = {
    id: newId(),
    type: 'media',
    name: base.name || (kind === 'audio' ? '오디오' : '비디오'),
    kind,
    assetId,
    ...(posterId ? { posterId } : {}),
    x: geo.x,
    y: geo.y,
    width: Math.max(1, geo.width),
    height: Math.max(1, geo.height),
    rotation: geo.rotation,
    ...(base.sourceId !== undefined ? { sourceId: base.sourceId } : {}),
  };
  ctx.report.converted.media = (ctx.report.converted.media ?? 0) + 1;
  return seal(m, preservedOf(pic, ctx));
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

