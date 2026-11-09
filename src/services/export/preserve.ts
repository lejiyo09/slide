/**
 * PPTX 왕복 보존 후처리.
 *
 * pptxgenjs가 만든 패키지에 대해:
 *  1. 미지원 개체 자리 표시 도형(__SLIDELAB_KEEP__id)을 원본 XML로 교체하고 현재 위치/크기를 반영
 *  2. 원본 XML이 참조하는 파트(차트, 내장 통합 문서, 미디어 등)를 관계와 함께 재귀 복사
 *  3. 가져온 개체의 원래 도형 ID(cNvPr id)를 복원 → 애니메이션 대상 참조 유지
 *  4. 슬라이드 전환/애니메이션(timing) XML 재삽입 (대상이 사라진 애니메이션은 제외하고 경고)
 */
import JSZip from 'jszip';
import type { Animation, Fill } from '../../types/model';
import { buildTimingXml } from './animXml';
import { FONT_SLOTS, type EmbedPlanFont } from '../fonts/embed';
import { CT_COMMENT_AUTHORS, CT_COMMENTS, REL_COMMENT_AUTHORS, REL_COMMENTS, type LegacyCommentsXml } from './commentsXml';

export interface PreservedXml {
  xml: string;
  part: string;
  label: string;
  /** SlideLab이 만든 XML (원본 패키지 없이 씀): 그림 자리(r:embed 값) → PNG 바이트 */
  generated?: { images?: Record<string, Uint8Array>; files?: Record<string, GeneratedFile> };
}
import { NS, OoxmlPackage, kid, kids, path, relativePath, relsPathFor } from '../import/ooxml';

/** 직접 만든 XML이 참조하는 파일 (예: 3D 모델 GLB) */
export interface GeneratedFile {
  data: Uint8Array;
  ext: string;
  contentType: string;
  relType: string;
}

export const KEEP_PREFIX = '__SLIDELAB_KEEP__';

export interface SlidePlan {
  index: number;
  /** pptxgenjs에 추가한 순서대로 각 개체의 원본 도형 ID */
  emitted: (number | undefined)[];
  /** emitted와 같은 순서: pptxgenjs가 지원하지 않는 그라데이션 채우기 */
  fills: (Extract<Fill, { type: 'gradient' | 'pattern' }> | undefined)[];
  /** 그라데이션/무늬 슬라이드 배경 (pptxgenjs 미지원 → 후처리) */
  background?: Extract<Fill, { type: 'gradient' | 'pattern' }>;
  /** emitted와 같은 순서: SlideLab 개체 ID (애니메이션 대상 매핑) */
  objIds: string[];
  /** 모델에서 생성할 애니메이션 */
  animations?: Animation[];
  /** 자동 재생·쇼 중 숨기기·반복 미디어 (p:timing에 기록) */
  media?: { id: string; kind: 'audio' | 'video'; autoPlay: boolean; hideInShow: boolean; loop: boolean }[];
  slideSize?: { width: number; height: number };
  /** emitted와 같은 순서: 소속 그룹 경로 (바깥 → 안쪽) */
  groupPaths: { key: string; name: string; sourceId?: number }[][];
  markers: Map<string, PreservedXml>;
  transitionXml?: string;
  timingXml?: string;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const serialize = (d: Document) => XML_DECL + new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, '');

const SHAPE_TAGS = new Set(['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp', 'contentPart', 'AlternateContent']);

export async function postProcessPptx(bytes: Uint8Array, plans: SlidePlan[], source: OoxmlPackage | null, warn: (m: string) => void, pres?: PresentationPlan): Promise<Uint8Array> {
  // 스키마 정리(normalizeOoxml)는 항상 하므로 후처리를 늘 거침
  const out = await JSZip.loadAsync(bytes);
  const ctDoc = parse(await out.file('[Content_Types].xml')!.async('string'));
  const ctRoot = ctDoc.documentElement;
  const copied = new Map<string, string>();
  let counter = 0;

  const ensureContentType = async (srcPath: string, newPath: string) => {
    if (!source) return;
    const ct = await source.contentType(srcPath);
    if (!ct) return;
    const o = ctDoc.createElementNS(NS.ct, 'Override');
    o.setAttribute('PartName', `/${newPath}`);
    o.setAttribute('ContentType', ct);
    ctRoot.appendChild(o);
  };

  const ensureDefault = (ext: string, type: string) => {
    if (kids(ctRoot).some((c) => c.localName === 'Default' && c.getAttribute('Extension')?.toLowerCase() === ext)) return;
    const d = ctDoc.createElementNS(NS.ct, 'Default');
    d.setAttribute('Extension', ext);
    d.setAttribute('ContentType', type);
    ctRoot.insertBefore(d, kids(ctRoot).find((x) => x.localName === 'Override') ?? null);
  };

  /** 원본 파트를 새 패키지로 복사(관계 포함, 재귀). 새 경로 반환 */
  const copyPart = async (srcPath: string): Promise<string | null> => {
    if (!source) return null;
    const memo = copied.get(srcPath);
    if (memo) return memo;
    const data = await source.bytes(srcPath);
    if (!data) return null;
    const slash = srcPath.lastIndexOf('/');
    const dir = srcPath.slice(0, slash + 1);
    let newPath: string;
    do newPath = `${dir}sl${++counter}_${srcPath.slice(slash + 1)}`;
    while (out.file(newPath));
    copied.set(srcPath, newPath);
    out.file(newPath, data);
    await ensureContentType(srcPath, newPath);
    const rels = await source.rels(srcPath);
    if (rels.size) {
      const rdoc = parse(`<Relationships xmlns="${NS.pr}"/>`);
      for (const r of rels.values()) {
        const el = rdoc.createElementNS(NS.pr, 'Relationship');
        el.setAttribute('Id', r.id);
        el.setAttribute('Type', r.type);
        if (r.external) {
          el.setAttribute('Target', r.target);
          el.setAttribute('TargetMode', 'External');
        } else {
          const t = await copyPart(r.target);
          if (!t) continue;
          el.setAttribute('Target', relativePath(newPath, t));
        }
        rdoc.documentElement.appendChild(el);
      }
      out.file(relsPathFor(newPath), serialize(rdoc));
    }
    return newPath;
  };

  for (const plan of plans) {
    const slidePath = `ppt/slides/slide${plan.index + 1}.xml`;
    const file = out.file(slidePath);
    if (!file) continue;
    const sdoc = parse(await file.async('string'));
    const root = sdoc.documentElement;
    const relsPath = relsPathFor(slidePath);
    const relsFile = out.file(relsPath);
    const rdoc = parse(relsFile ? await relsFile.async('string') : `<Relationships xmlns="${NS.pr}"/>`);
    let relSeq = 0;
    const relMemo = new Map<string, string>();
    const spTree = path(root, 'cSld', 'spTree');
    if (!spTree) continue;
    const shapes = kids(spTree).filter((e) => SHAPE_TAGS.has(e.localName));

    // 0) pptxgenjs는 오디오도 a:videoFile로 기록 → 관계 형식이 audio면 a:audioFile로 (PowerPoint가 오디오로 인식)
    const audioRels = new Set(Array.from(rdoc.documentElement.children).filter((r) => (r.getAttribute('Type') ?? '').endsWith('/audio')).map((r) => r.getAttribute('Id')));
    if (audioRels.size) {
      for (const vf of Array.from(sdoc.getElementsByTagNameNS(NS.a, 'videoFile'))) {
        if (!audioRels.has(vf.getAttributeNS(NS.r, 'link'))) continue;
        const af = sdoc.createElementNS(NS.a, 'a:audioFile');
        for (const at of Array.from(vf.attributes)) af.setAttributeNS(at.namespaceURI, at.name, at.value);
        vf.parentNode!.replaceChild(af, vf);
      }
    }

    // 1) 도형 ID 복원
    const cNvPrOf = (e: Element) => e.getElementsByTagNameNS(NS.p, 'cNvPr')[0] ?? null;
    if (shapes.length === plan.emitted.length) {
      const used = new Set<number>([1]);
      const assigned = new Array<number | undefined>(shapes.length);
      plan.emitted.forEach((sid, i) => {
        if (sid !== undefined && sid > 1 && !used.has(sid)) {
          used.add(sid);
          assigned[i] = sid;
        }
      });
      let next = Math.max(1, ...used) + 1;
      shapes.forEach((e, i) => {
        const id = assigned[i] ?? next++;
        cNvPrOf(e)?.setAttribute('id', String(id));
        const g = plan.fills[i];
        if (g) replaceSolid(kid(e, 'spPr'), g);
      });
    } else if (plan.fills.some(Boolean)) {
      warn('일부 그라데이션 채우기를 단색으로 저장했습니다.');
    }
    if (shapes.length !== plan.emitted.length && plan.timingXml) {
      warn(`슬라이드 ${plan.index + 1}: 개체 대응을 확인할 수 없어 애니메이션을 저장하지 않았습니다.`);
      plan.timingXml = undefined;
    }
    let freshId = 100000 + plan.index * 1000;
    // 나중에 그룹으로 다시 묶기 위해 원래 요소 순서를 보관 (마커 교체 시 갱신)
    const elementAt = shapes.length === plan.emitted.length ? [...shapes] : null;

    // 2) 보존 개체 복원
    for (const marker of shapes) {
      const c = cNvPrOf(marker);
      const name = c?.getAttribute('name') ?? '';
      if (!name.startsWith(KEEP_PREFIX)) continue;
      const obj = plan.markers.get(name);
      if (obj?.generated) {
        // 수식 등 직접 만든 XML: 위치·크기는 XML에 이미 들어 있음, 그림만 새 미디어 파트로
        const node = sdoc.importNode(parse(obj.xml).documentElement, true) as Element;
        const id = c?.getAttribute('id') ?? String(freshId++);
        // Choice와 Fallback의 도형은 같은 도형이므로 같은 ID (PowerPoint·LibreOffice와 같음)
        for (const n of Array.from(node.getElementsByTagNameNS(NS.p, 'cNvPr'))) n.setAttribute('id', id);
        // 자리 표시 관계 ID(r:embed 등) → 새 파트 + 관계 (같은 자리는 한 번만: 3D 대체 그림은 raster와 Fallback이 같이 씀)
        const files: Record<string, GeneratedFile> = { ...(obj.generated.files ?? {}) };
        for (const [k, png] of Object.entries(obj.generated.images ?? {})) files[k] = { data: png, ext: 'png', contentType: 'image/png', relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' };
        const made = new Map<string, string>();
        for (const el of [node, ...Array.from(node.getElementsByTagName('*'))]) {
          for (const attr of Array.from(el.attributes)) {
            if (attr.namespaceURI !== NS.r) continue;
            const f = files[attr.value];
            if (!f) continue;
            let rid = made.get(attr.value);
            if (!rid) {
              let media: string;
              do media = `ppt/media/slGen${++counter}.${f.ext}`;
              while (out.file(media));
              out.file(media, f.data);
              rid = `rIdSL${++relSeq}`;
              const relEl = rdoc.createElementNS(NS.pr, 'Relationship');
              relEl.setAttribute('Id', rid);
              relEl.setAttribute('Type', f.relType);
              relEl.setAttribute('Target', relativePath(slidePath, media));
              rdoc.documentElement.appendChild(relEl);
              ensureDefault(f.ext, f.contentType);
              made.set(attr.value, rid);
            }
            attr.value = rid;
          }
        }
        spTree.replaceChild(node, marker);
        if (elementAt) elementAt[elementAt.indexOf(marker)] = node;
        continue;
      }
      if (!obj || !source) {
        warn('원본 PPTX 패키지를 찾을 수 없어 보존된 개체(표·차트 등)를 저장하지 못했습니다. 원본 파일을 다시 가져오세요.');
        spTree.removeChild(marker);
        continue;
      }
      const frag = parse(obj.xml).documentElement;
      const node = sdoc.importNode(frag, true) as Element;
      // 현재 위치/크기/회전 반영
      const mx = path(marker, 'spPr', 'xfrm');
      const xfrmOf = (n: Element) => (n.localName === 'graphicFrame' ? kid(n, 'xfrm') : n.localName === 'grpSp' ? path(n, 'grpSpPr', 'xfrm') : path(n, 'spPr', 'xfrm'));
      // mc:AlternateContent(3D 모델 등): Choice와 Fallback 안의 도형 모두
      const targets =
        node.localName === 'AlternateContent'
          ? kids(node)
              .filter((c) => c.localName === 'Choice' || c.localName === 'Fallback')
              .flatMap((c) => kids(c))
              .map((c) => ({ n: c, x: xfrmOf(c) }))
          : [{ n: node, x: xfrmOf(node) }];
      for (const { n, x: target } of targets) {
        if (!mx || !target) continue;
        const mo = kid(mx, 'off'), me = kid(mx, 'ext'), to = kid(target, 'off'), te = kid(target, 'ext');
        if (mo && to) (['x', 'y'] as const).forEach((k) => to.setAttribute(k, mo.getAttribute(k) ?? '0'));
        if (me && te) (['cx', 'cy'] as const).forEach((k) => te.setAttribute(k, me.getAttribute(k) ?? '0'));
        const rot = mx.getAttribute('rot');
        if (rot && n.localName !== 'graphicFrame') target.setAttribute('rot', rot);
        else target.removeAttribute('rot');
      }
      // ID: 최상위는 자리 표시 도형의 ID, 내부 cNvPr은 고유 ID
      const allNv = Array.from(node.getElementsByTagNameNS(NS.p, 'cNvPr'));
      const topId = c?.getAttribute('id') ?? String(freshId++);
      // AlternateContent: Choice·Fallback의 최상위 도형은 같은 도형이므로 같은 ID
      const tops = new Set(
        node.localName === 'AlternateContent'
          ? kids(node)
              .flatMap((x) => kids(x))
              .map((x) => x.getElementsByTagNameNS(NS.p, 'cNvPr')[0])
              .filter(Boolean)
          : [allNv[0]],
      );
      allNv.forEach((n) => n.setAttribute('id', tops.has(n) ? topId : String(freshId++)));
      // 관계 재매핑
      const srcRels = await source.rels(obj.part);
      for (const el of [node, ...Array.from(node.getElementsByTagName('*'))]) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.namespaceURI !== NS.r) continue;
          const key = `${obj.part}#${attr.value}`;
          let newRid = relMemo.get(key);
          if (!newRid) {
            const rel = srcRels.get(attr.value);
            if (!rel) {
              warn(`관계 ${attr.value}를 원본에서 찾지 못했습니다 (${obj.label}).`);
              continue;
            }
            newRid = `rIdSL${++relSeq}`;
            const relEl = rdoc.createElementNS(NS.pr, 'Relationship');
            relEl.setAttribute('Id', newRid);
            relEl.setAttribute('Type', rel.type);
            if (rel.external) {
              relEl.setAttribute('Target', rel.target);
              relEl.setAttribute('TargetMode', 'External');
            } else {
              const newTarget = await copyPart(rel.target);
              if (!newTarget) {
                warn(`원본 파트 ${rel.target}를 찾지 못했습니다.`);
                continue;
              }
              relEl.setAttribute('Target', relativePath(slidePath, newTarget));
              // SmartArt: 데이터 파트가 슬라이드 관계 ID(dsp:dataModelExt relId)로 그리기 캐시를 참조
              if (rel.type.endsWith('/diagramData')) await fixDiagramDrawingRef(newTarget, obj.part);
            }
            rdoc.documentElement.appendChild(relEl);
            relMemo.set(key, newRid);
          }
          attr.value = newRid;
        }
      }
      spTree.replaceChild(node, marker);
      if (elementAt) elementAt[elementAt.indexOf(marker)] = node;
    }

    // 2-1) 평탄화된 그룹을 p:grpSp로 다시 묶기
    let groupIds = new Map<string, number>();
    if (elementAt && plan.groupPaths.some((g) => g.length)) {
      const used = new Set(Array.from(sdoc.getElementsByTagNameNS(NS.p, 'cNvPr')).map((e) => Number(e.getAttribute('id'))));
      groupIds = regroup(sdoc, elementAt, plan.groupPaths, used, () => freshId++);
    } else if (plan.groupPaths.some((g) => g.length)) {
      warn('일부 그룹을 개별 개체로 풀어서 저장했습니다 (위치·모양은 유지).');
    }

    async function fixDiagramDrawingRef(dataPath: string, srcSlidePart: string) {
      const f = out.file(dataPath);
      if (!f || !source) return;
      const xml = await f.async('string');
      const m = xml.match(/relId="([^"]+)"/);
      if (!m) return;
      const rel = (await source.rels(srcSlidePart)).get(m[1]);
      if (!rel || rel.external) return;
      const drawing = await copyPart(rel.target);
      if (!drawing) return;
      const id = `rIdSL${++relSeq}`;
      const relEl = rdoc.createElementNS(NS.pr, 'Relationship');
      relEl.setAttribute('Id', id);
      relEl.setAttribute('Type', rel.type);
      relEl.setAttribute('Target', relativePath(slidePath, drawing));
      rdoc.documentElement.appendChild(relEl);
      out.file(dataPath, xml.replace(`relId="${m[1]}"`, `relId="${id}"`));
    }

    // 2-2) 그라데이션/무늬 배경
    if (plan.background) {
      const bgPr = path(root, 'cSld', 'bg', 'bgPr');
      if (bgPr) replaceSolid(bgPr, plan.background);
    }

    // 3) 전환/애니메이션
    const ids = new Set(Array.from(sdoc.getElementsByTagNameNS(NS.p, 'cNvPr')).map((e) => e.getAttribute('id')));
    let timing = plan.timingXml;
    // 모델 애니메이션 → p:timing (최종 도형 ID로)
    if (!timing && (plan.animations?.length || plan.media?.length) && elementAt) {
      const spidOf = (id: string) => {
        const gid = groupIds.get(id);
        if (gid !== undefined) return gid;
        const i = plan.objIds.indexOf(id);
        const v = i >= 0 ? Number(elementAt[i]?.getElementsByTagNameNS(NS.p, 'cNvPr')[0]?.getAttribute('id')) : NaN;
        return Number.isFinite(v) ? v : undefined;
      };
      const isTextShape = (id: string) => {
        const i = plan.objIds.indexOf(id);
        return i >= 0 && elementAt[i]?.localName === 'sp';
      };
      const media = (plan.media ?? []).flatMap((m) => {
        const spid = spidOf(m.id);
        return spid === undefined ? [] : [{ ...m, spid }];
      });
      timing = buildTimingXml(plan.animations, spidOf, plan.slideSize?.width ?? 1280, plan.slideSize?.height ?? 720, isTextShape, media);
    } else if (!timing && plan.animations?.length) warn(`슬라이드 ${plan.index + 1}: 개체 대응을 확인할 수 없어 애니메이션을 저장하지 않았습니다.`);
    if (timing) {
      const refs = [...timing.matchAll(/spid="(\d+)"/g)].map((m) => m[1]);
      const missing = refs.filter((r) => !ids.has(r));
      if (missing.length) {
        warn(`슬라이드 ${plan.index + 1}: 애니메이션 대상 개체가 삭제되었거나 그룹이 풀려 해당 슬라이드의 애니메이션을 저장하지 않았습니다.`);
        timing = undefined;
      }
    }
    const extras = [plan.transitionXml, timing].filter((x): x is string => !!x);
    if (extras.length) {
      // 기존(pptxgenjs가 만든) 전환/타이밍 제거 후 원본 삽입: cSld, clrMapOvr 뒤 / extLst 앞
      for (const c of kids(root)) if (c.localName === 'transition' || c.localName === 'timing') root.removeChild(c);
      const anchor = kids(root).find((c) => c.localName === 'extLst') ?? null;
      for (const x of extras) root.insertBefore(sdoc.importNode(parse(x).documentElement, true), anchor);
    }

    out.file(slidePath, serialize(sdoc));
    out.file(relsPath, serialize(rdoc));
  }
  // 4) 원본 테마 복원: 보존된 표·차트·SmartArt가 참조하는 테마 색(accent1 등)을 원본과 같게 유지
  const themeRestored = !!source && copied.size + plans.reduce((n, p) => n + p.markers.size, 0) > 0;
  if (themeRestored) await restoreTheme(out, source!, copyPart);
  // 테마의 한글 글꼴: 원본 테마를 복원하지 않았으면 SlideLab 테마 글꼴을 동아시아(ea)·한글(Hang) 글꼴에도 기록
  else if (pres?.themeEastAsian) await patchThemeEastAsian(out, pres.themeEastAsian);

  // 5) 쇼 설정(presProps.xml) / 재구성한 쇼(presentation.xml)
  if (pres) await writePresentationSettings(out, pres);
  // 6) 포함 글꼴 (ppt/fonts/*.fntdata + p:embeddedFontLst)
  if (pres?.embeddedFonts?.length) await writeEmbeddedFonts(out, ctDoc, pres.embeddedFonts);
  // 7) 메모 (ppt/commentAuthors.xml + ppt/comments/commentN.xml)
  if (pres?.comments) await writeComments(out, ctDoc, pres.comments);

  // 8) 스키마 정리: pptxgenjs가 만드는 순서·중복 오류 바로잡기 (Open XML SDK 스키마 검증으로 찾음)
  await normalizeOoxml(out);

  out.file('[Content_Types].xml', serialize(ctDoc));
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** CT_Presentation 자식 순서 (ECMA-376 Part 1 §19.2.1.26) */
const PRESENTATION_ORDER = ['sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst', 'sldIdLst', 'sldSz', 'notesSz', 'smartTags', 'embeddedFontLst', 'custShowLst', 'photoAlbum', 'custDataLst', 'kinsoku', 'defaultTextStyle', 'modifyVerifier', 'extLst'];

/**
 * pptxgenjs 출력의 스키마 위반 바로잡기
 *  - presentation.xml: p:notesMasterIdLst가 p:sldIdLst 뒤에 옴 → 스키마 순서로
 *  - 문단(a:p)마다 글자 묶음(a:r) 앞에 a:pPr를 여러 번 씀 (글머리 기호 문단에 서식이 다른 글자가 섞일 때) → 첫 a:pPr만
 */
export async function normalizeOoxml(out: JSZip) {
  const presPath = 'ppt/presentation.xml';
  const pf = out.file(presPath);
  if (pf) {
    const doc = parse(await pf.async('string'));
    const root = doc.documentElement;
    const rank = (e: Element) => {
      const i = PRESENTATION_ORDER.indexOf(e.localName);
      return i < 0 ? PRESENTATION_ORDER.length : i;
    };
    const kidsNow = kids(root);
    const sorted = [...kidsNow].sort((a, b) => rank(a) - rank(b));
    if (sorted.some((e, i) => e !== kidsNow[i])) {
      for (const e of sorted) root.appendChild(e);
      out.file(presPath, serialize(doc));
    }
  }
  for (const name of Object.keys(out.files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|notesSlides)\/[^/]+\.xml$/.test(n))) {
    const xml = await out.file(name)!.async('string');
    if (!/<a:pPr[\s>][\s\S]*?<a:pPr[\s>]/.test(xml)) continue;
    const doc = parse(xml);
    let changed = false;
    for (const p of Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))) {
      const pprs = kids(p).filter((c) => c.localName === 'pPr');
      for (const extra of pprs.slice(1)) {
        p.removeChild(extra);
        changed = true;
      }
      // a:pPr는 문단의 첫 자식이어야 함
      if (pprs[0] && p.firstElementChild !== pprs[0]) {
        p.insertBefore(pprs[0], p.firstElementChild);
        changed = true;
      }
    }
    if (changed) out.file(name, serialize(doc));
  }
}

/** 프레젠테이션 수준 설정: 쇼 설정 + 재구성한 쇼 */
export interface PresentationPlan {
  showPrXml: string;
  /** 재구성한 쇼: 슬라이드 인덱스(내보낸 순서) 목록 */
  customShows: { name: string; slides: number[] }[];
  /** 테마 제목/본문 글꼴 중 한글을 표시할 수 있는 것 (없으면 null → PowerPoint 기본 '맑은 고딕') */
  themeEastAsian?: { major: string | null; minor: string | null };
  /** 포함 글꼴 (EOT) */
  embeddedFonts?: EmbedPlanFont[];
  /** 메모 (기존 메모 형식) */
  comments?: LegacyCommentsXml | null;
}

async function addRel(out: JSZip, part: string, type: string, target: string) {
  const relsPath = relsPathFor(part);
  const rdoc = parse(out.file(relsPath) ? await out.file(relsPath)!.async('string') : `<Relationships xmlns="${NS.pr}"/>`);
  const used = new Set(Array.from(rdoc.documentElement.children).map((n) => n.getAttribute('Id')));
  let i = 1;
  while (used.has(`rIdCm${i}`)) i++;
  const el = rdoc.createElementNS(NS.pr, 'Relationship');
  el.setAttribute('Id', `rIdCm${i}`);
  el.setAttribute('Type', type);
  el.setAttribute('Target', relativePath(part, target));
  rdoc.documentElement.appendChild(el);
  out.file(relsPath, serialize(rdoc));
}

function addOverride(ctDoc: Document, part: string, type: string) {
  const o = ctDoc.createElementNS(NS.ct, 'Override');
  o.setAttribute('PartName', `/${part}`);
  o.setAttribute('ContentType', type);
  ctDoc.documentElement.appendChild(o);
}

async function writeComments(out: JSZip, ctDoc: Document, c: LegacyCommentsXml) {
  out.file('ppt/commentAuthors.xml', c.authorsXml);
  await addRel(out, 'ppt/presentation.xml', REL_COMMENT_AUTHORS, 'ppt/commentAuthors.xml');
  addOverride(ctDoc, 'ppt/commentAuthors.xml', CT_COMMENT_AUTHORS);
  for (let i = 0; i < c.slides.length; i++) {
    const xml = c.slides[i];
    const slidePath = `ppt/slides/slide${i + 1}.xml`;
    if (!xml || !out.file(slidePath)) continue;
    const part = `ppt/comments/comment${i + 1}.xml`;
    out.file(part, xml);
    await addRel(out, slidePath, REL_COMMENTS, part);
    addOverride(ctDoc, part, CT_COMMENTS);
  }
}

const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';

/** LibreOffice(oox/sd 내보내기)·PowerPoint와 같은 구조: ppt/fonts/fontN.fntdata, application/x-fontdata, p:embeddedFontLst */
async function writeEmbeddedFonts(out: JSZip, ctDoc: Document, fonts: EmbedPlanFont[]) {
  const presPath = 'ppt/presentation.xml';
  const relsPath = relsPathFor(presPath);
  if (!out.file(presPath) || !out.file(relsPath)) return;
  const pdoc = parse(await out.file(presPath)!.async('string'));
  const rdoc = parse(await out.file(relsPath)!.async('string'));
  const root = pdoc.documentElement;
  const used = new Set(Array.from(rdoc.documentElement.childNodes).map((n) => (n as Element).getAttribute?.('Id')));
  let seq = 0;
  const nextId = () => {
    let id: string;
    do id = `rIdFont${++seq}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  let fileNo = 0;
  for (const c of kids(root)) if (c.localName === 'embeddedFontLst') root.removeChild(c);
  const lst = pdoc.createElementNS(NS.p, 'p:embeddedFontLst');
  for (const f of fonts) {
    const ef = pdoc.createElementNS(NS.p, 'p:embeddedFont');
    const fontEl = pdoc.createElementNS(NS.p, 'p:font');
    fontEl.setAttribute('typeface', f.typeface);
    ef.appendChild(fontEl);
    for (const slot of FONT_SLOTS) {
      const data = f.faces[slot];
      if (!data) continue;
      let name: string;
      do name = `ppt/fonts/font${++fileNo}.fntdata`;
      while (out.file(name));
      out.file(name, data);
      const rid = nextId();
      const rel = rdoc.createElementNS(NS.pr, 'Relationship');
      rel.setAttribute('Id', rid);
      rel.setAttribute('Type', FONT_REL);
      rel.setAttribute('Target', name.slice('ppt/'.length));
      rdoc.documentElement.appendChild(rel);
      const el = pdoc.createElementNS(NS.p, `p:${slot}`);
      el.setAttributeNS(NS.r, 'r:id', rid);
      ef.appendChild(el);
    }
    lst.appendChild(ef);
  }
  // CT_Presentation 순서: ... notesSz, smartTags, embeddedFontLst, custShowLst, photoAlbum, ...
  const after = new Set(['custShowLst', 'photoAlbum', 'custDataLst', 'kinsoku', 'defaultTextStyle', 'modifyVerifier', 'extLst']);
  root.insertBefore(lst, kids(root).find((c) => after.has(c.localName)) ?? null);
  root.setAttribute('embedTrueTypeFonts', '1');
  out.file(presPath, serialize(pdoc));
  out.file(relsPath, serialize(rdoc));
  const ctRoot = ctDoc.documentElement;
  if (!kids(ctRoot).some((c) => c.localName === 'Default' && c.getAttribute('Extension')?.toLowerCase() === 'fntdata')) {
    const d = ctDoc.createElementNS(NS.ct, 'Default');
    d.setAttribute('Extension', 'fntdata');
    d.setAttribute('ContentType', 'application/x-fontdata');
    ctRoot.insertBefore(d, kids(ctRoot).find((c) => c.localName === 'Override') ?? null);
  }
}

/** pptxgenjs 테마는 a:ea가 비어 있고 Hang이 '맑은 고딕'으로 고정 → 테마 글꼴이 한글 글꼴이면 그 글꼴로 */
async function patchThemeEastAsian(out: JSZip, fonts: { major: string | null; minor: string | null }) {
  const path = 'ppt/theme/theme1.xml';
  const f = out.file(path);
  if (!f) return;
  const doc = parse(await f.async('string'));
  const fontScheme = doc.getElementsByTagNameNS(NS.a, 'fontScheme')[0];
  for (const [tagName, font] of [['majorFont', fonts.major], ['minorFont', fonts.minor]] as const) {
    if (!font) continue;
    const el = fontScheme ? kids(fontScheme).find((c) => c.localName === tagName) : undefined;
    if (!el) continue;
    const ea = kids(el).find((c) => c.localName === 'ea');
    if (ea) ea.setAttribute('typeface', font);
    const hang = kids(el).find((c) => c.localName === 'font' && c.getAttribute('script') === 'Hang');
    if (hang) hang.setAttribute('typeface', font);
  }
  out.file(path, serialize(doc));
}

async function writePresentationSettings(out: JSZip, pres: PresentationPlan) {
  const presPath = 'ppt/presentation.xml';
  // 재구성한 쇼: p:custShowLst (sldIdLst의 r:id 참조)
  if (pres.customShows.length && out.file(presPath)) {
    const pdoc = parse(await out.file(presPath)!.async('string'));
    const root = pdoc.documentElement;
    const rids = Array.from(kids(kid(root, 'sldIdLst'), 'sldId')).map((e) => e.getAttributeNS(NS.r, 'id') ?? '');
    for (const c of kids(root)) if (c.localName === 'custShowLst') root.removeChild(c);
    const lst = pdoc.createElementNS(NS.p, 'p:custShowLst');
    pres.customShows.forEach((cs, i) => {
      const el = pdoc.createElementNS(NS.p, 'p:custShow');
      el.setAttribute('name', cs.name);
      el.setAttribute('id', String(i));
      const sl = pdoc.createElementNS(NS.p, 'p:sldLst');
      for (const n of cs.slides) {
        if (!rids[n]) continue;
        const s = pdoc.createElementNS(NS.p, 'p:sld');
        s.setAttributeNS(NS.r, 'r:id', rids[n]);
        sl.appendChild(s);
      }
      el.appendChild(sl);
      lst.appendChild(el);
    });
    // CT_Presentation 순서: ... sldSz, notesSz, smartTags, embeddedFontLst, custShowLst, photoAlbum, custDataLst, kinsoku, defaultTextStyle, ...
    const after = new Set(['photoAlbum', 'custDataLst', 'kinsoku', 'defaultTextStyle', 'modifyVerifier', 'extLst']);
    const anchor = kids(root).find((c) => after.has(c.localName)) ?? null;
    root.insertBefore(lst, anchor);
    out.file(presPath, serialize(pdoc));
  }
  // 쇼 설정: presProps.xml의 p:showPr (기존 확장 요소는 유지)
  const propsPath = 'ppt/presProps.xml';
  const f = out.file(propsPath);
  if (f) {
    const doc = parse(await f.async('string'));
    const root = doc.documentElement;
    for (const c of kids(root)) if (c.localName === 'showPr') root.removeChild(c);
    const showPr = doc.importNode(parse(pres.showPrXml).documentElement, true);
    // CT_PresentationProperties 순서: htmlPubPr, webPr, prnPr, showPr, clrMru, extLst
    const anchor = kids(root).find((c) => c.localName === 'clrMru' || c.localName === 'extLst') ?? null;
    root.insertBefore(showPr, anchor);
    out.file(propsPath, serialize(doc));
  }
}

/** 첫 단색 채우기를 그라데이션(a:gradFill) 또는 무늬(a:pattFill)로 교체 */
function replaceSolid(parent: Element | null, g: Extract<Fill, { type: 'gradient' | 'pattern' }>) {
  const solid = kid(parent, 'solidFill');
  if (!parent || !solid) return;
  const doc = parent.ownerDocument;
  const A = NS.a;
  const clr = (hex: string) => {
    const c = doc.createElementNS(A, 'a:srgbClr');
    c.setAttribute('val', hex.replace('#', '').toUpperCase());
    return c;
  };
  if (g.type === 'pattern') {
    const pf = doc.createElementNS(A, 'a:pattFill');
    pf.setAttribute('prst', g.preset);
    const fg = doc.createElementNS(A, 'a:fgClr');
    fg.appendChild(clr(g.fg));
    const bg = doc.createElementNS(A, 'a:bgClr');
    bg.appendChild(clr(g.bg));
    pf.append(fg, bg);
    parent.replaceChild(pf, solid);
    return;
  }
  const grad = doc.createElementNS(A, 'a:gradFill');
  grad.setAttribute('rotWithShape', '1');
  const lst = doc.createElementNS(A, 'a:gsLst');
  for (const st of g.stops) {
    const gs = doc.createElementNS(A, 'a:gs');
    gs.setAttribute('pos', String(Math.round(st.offset * 100000)));
    gs.appendChild(clr(st.color));
    lst.appendChild(gs);
  }
  grad.appendChild(lst);
  const lin = doc.createElementNS(A, 'a:lin');
  lin.setAttribute('ang', String(Math.round((((g.angle % 360) + 360) % 360) * 60000)));
  lin.setAttribute('scaled', '0');
  grad.appendChild(lin);
  parent.replaceChild(grad, solid);
}

/**
 * 연속된 요소들을 그룹 경로에 따라 p:grpSp로 감싼다 (안쪽 그룹부터).
 * 자식 좌표는 이미 절대 좌표이므로 chOff=off, chExt=ext(회전 0)로 두면 화면이 그대로 유지된다.
 */
function regroup(
  doc: Document,
  elements: Element[],
  paths: { key: string; name: string; sourceId?: number }[][],
  usedIds: Set<number>,
  fresh: () => number,
): Map<string, number> {
  const ids = new Map<string, number>();
  const P = NS.p, A = NS.a;
  const top = new Map<Element, Element>(elements.map((e) => [e, e]));
  const ranges = new Map<string, { key: string; start: number; end: number; depth: number; name: string; sourceId?: number }>();
  paths.forEach((gp, i) =>
    gp.forEach((g, depth) => {
      const r = ranges.get(g.key);
      if (r) r.end = i + 1;
      else ranges.set(g.key, { key: g.key, start: i, end: i + 1, depth, name: g.name, sourceId: g.sourceId });
    }),
  );
  const sorted = [...ranges.values()].sort((a, b) => b.depth - a.depth);
  for (const r of sorted) {
    const members: Element[] = [];
    for (let i = r.start; i < r.end; i++) {
      const t = top.get(elements[i])!;
      if (!members.includes(t)) members.push(t);
    }
    // 경계 상자: 자식 xfrm(off/ext)의 합집합
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      for (const x of Array.from(m.getElementsByTagNameNS(A, 'xfrm')).concat(Array.from(m.getElementsByTagNameNS(P, 'xfrm'))).slice(0, 1)) {
        const off = kid(x, 'off'), ext = kid(x, 'ext');
        const ox = Number(off?.getAttribute('x') ?? 0), oy = Number(off?.getAttribute('y') ?? 0);
        const cx = Number(ext?.getAttribute('cx') ?? 0), cy = Number(ext?.getAttribute('cy') ?? 0);
        minX = Math.min(minX, ox); minY = Math.min(minY, oy); maxX = Math.max(maxX, ox + cx); maxY = Math.max(maxY, oy + cy);
      }
    }
    if (!Number.isFinite(minX)) continue;
    const g = doc.createElementNS(P, 'p:grpSp');
    const nv = doc.createElementNS(P, 'p:nvGrpSpPr');
    const c = doc.createElementNS(P, 'p:cNvPr');
    let id = r.sourceId && !usedIds.has(r.sourceId) ? r.sourceId : fresh();
    while (usedIds.has(id)) id = fresh();
    usedIds.add(id);
    c.setAttribute('id', String(id));
    c.setAttribute('name', r.name || '그룹');
    nv.append(c, doc.createElementNS(P, 'p:cNvGrpSpPr'), doc.createElementNS(P, 'p:nvPr'));
    const pr = doc.createElementNS(P, 'p:grpSpPr');
    const xf = doc.createElementNS(A, 'a:xfrm');
    const mk = (name: string, a: string, av: number, b: string, bv: number) => {
      const e = doc.createElementNS(A, name);
      e.setAttribute(a, String(Math.round(av)));
      e.setAttribute(b, String(Math.round(bv)));
      return e;
    };
    xf.append(mk('a:off', 'x', minX, 'y', minY), mk('a:ext', 'cx', maxX - minX, 'cy', maxY - minY), mk('a:chOff', 'x', minX, 'y', minY), mk('a:chExt', 'cx', maxX - minX, 'cy', maxY - minY));
    pr.appendChild(xf);
    g.append(nv, pr);
    members[0].parentNode!.insertBefore(g, members[0]);
    for (const m of members) g.appendChild(m);
    for (let i = r.start; i < r.end; i++) top.set(elements[i], g);
    ids.set(r.key, id);
  }
  return ids;
}

async function restoreTheme(out: JSZip, source: OoxmlPackage, copyPart: (p: string) => Promise<string | null>) {
  const target = 'ppt/theme/theme1.xml';
  if (!out.file(target)) return;
  const presRel = [...(await source.rels('')).values()].find((r) => r.type.endsWith('/officeDocument'));
  const pres = presRel?.target ?? 'ppt/presentation.xml';
  const master = [...(await source.rels(pres)).values()].find((r) => r.type.endsWith('/slideMaster'));
  const theme = master && [...(await source.rels(master.target)).values()].find((r) => r.type.endsWith('/theme'));
  // 표 스타일 정의도 원본으로 (보존된 표의 tableStyleId가 참조)
  const tsRel = [...(await source.rels(pres)).values()].find((r) => r.type.endsWith('/tableStyles'));
  const ts = tsRel && (await source.text(tsRel.target));
  if (ts && out.file('ppt/tableStyles.xml')) out.file('ppt/tableStyles.xml', ts);
  const xml = theme && (await source.text(theme.target));
  if (!xml) return;
  out.file(target, xml);
  // 테마가 참조하는 파트(그림 채우기 등)
  const rels = await source.rels(theme!.target);
  if (rels.size) {
    const rdoc = parse(`<Relationships xmlns="${NS.pr}"/>`);
    for (const r of rels.values()) {
      const el = rdoc.createElementNS(NS.pr, 'Relationship');
      el.setAttribute('Id', r.id);
      el.setAttribute('Type', r.type);
      if (r.external) {
        el.setAttribute('Target', r.target);
        el.setAttribute('TargetMode', 'External');
      } else {
        const t = await copyPart(r.target);
        if (!t) continue;
        el.setAttribute('Target', relativePath(target, t));
      }
      rdoc.documentElement.appendChild(el);
    }
    out.file(relsPathFor(target), serialize(rdoc));
  }
}
