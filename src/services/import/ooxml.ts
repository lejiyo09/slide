/**
 * OOXML(Open Packaging Conventions) 패키지 읽기 도우미.
 * PPTX는 ZIP 안에 XML 파트와 관계(.rels)로 구성된다.
 */
import JSZip from 'jszip';

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};

export const REL = {
  officeDocument: '/officeDocument',
  slide: '/slide',
  slideLayout: '/slideLayout',
  slideMaster: '/slideMaster',
  theme: '/theme',
  notesSlide: '/notesSlide',
  image: '/image',
};

export interface Rel {
  id: string;
  type: string;
  target: string; // 내부: 패키지 절대 경로(선행 / 없음), 외부: 원본 URL
  external: boolean;
}

/** 경로 결합: base 파트의 디렉터리 기준으로 상대 대상 경로 해석 */
export function resolvePath(basePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePart.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** from 파트 기준으로 to 파트를 가리키는 상대 경로 */
export function relativePath(fromPart: string, toPart: string): string {
  const a = fromPart.split('/');
  a.pop();
  const b = toPart.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export const relsPathFor = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};

export class OoxmlPackage {
  private xmlCache = new Map<string, Document>();
  private relsCache = new Map<string, Map<string, Rel>>();
  private contentTypes: { defaults: Map<string, string>; overrides: Map<string, string> } | null = null;

  private constructor(readonly zip: JSZip) {}

  static async load(data: ArrayBuffer | Uint8Array | Blob): Promise<OoxmlPackage> {
    const zip = await JSZip.loadAsync(data);
    return new OoxmlPackage(zip);
  }

  has(path: string) {
    return !!this.zip.file(path);
  }

  async text(path: string): Promise<string | null> {
    const f = this.zip.file(path);
    return f ? f.async('string') : null;
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const f = this.zip.file(path);
    return f ? f.async('uint8array') : null;
  }

  async base64(path: string): Promise<string | null> {
    const f = this.zip.file(path);
    return f ? f.async('base64') : null;
  }

  async xml(path: string): Promise<Document | null> {
    const cached = this.xmlCache.get(path);
    if (cached) return cached;
    const t = await this.text(path);
    if (t === null) return null;
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`XML 해석 실패: ${path}`);
    this.xmlCache.set(path, doc);
    return doc;
  }

  async rels(part: string): Promise<Map<string, Rel>> {
    const cached = this.relsCache.get(part);
    if (cached) return cached;
    const map = new Map<string, Rel>();
    const doc = await this.xml(relsPathFor(part));
    if (doc) {
      for (const el of Array.from(doc.getElementsByTagNameNS(NS.pr, 'Relationship'))) {
        const external = el.getAttribute('TargetMode') === 'External';
        const target = el.getAttribute('Target') ?? '';
        map.set(el.getAttribute('Id') ?? '', {
          id: el.getAttribute('Id') ?? '',
          type: el.getAttribute('Type') ?? '',
          target: external ? target : resolvePath(part, target),
          external,
        });
      }
    }
    this.relsCache.set(part, map);
    return map;
  }

  async relByType(part: string, typeSuffix: string): Promise<Rel | undefined> {
    for (const r of (await this.rels(part)).values()) if (r.type.endsWith(typeSuffix)) return r;
    return undefined;
  }

  async contentType(path: string): Promise<string | undefined> {
    if (!this.contentTypes) {
      const defaults = new Map<string, string>();
      const overrides = new Map<string, string>();
      const doc = await this.xml('[Content_Types].xml');
      if (doc) {
        for (const d of Array.from(doc.getElementsByTagNameNS(NS.ct, 'Default'))) defaults.set((d.getAttribute('Extension') ?? '').toLowerCase(), d.getAttribute('ContentType') ?? '');
        for (const o of Array.from(doc.getElementsByTagNameNS(NS.ct, 'Override'))) overrides.set((o.getAttribute('PartName') ?? '').replace(/^\//, ''), o.getAttribute('ContentType') ?? '');
      }
      this.contentTypes = { defaults, overrides };
    }
    return this.contentTypes.overrides.get(path) ?? this.contentTypes.defaults.get(path.split('.').pop()!.toLowerCase());
  }
}

/* ───────────── DOM 도우미 (네임스페이스 접두사와 무관하게 localName으로 탐색) ───────────── */

export function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c);
  return out;
}

export function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}

/** 경로를 따라 내려감: path('spPr', 'xfrm', 'off') */
export function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null | undefined = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}

export function descendants(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);
}

export function numAttr(el: Element | null | undefined, name: string): number | undefined {
  const v = el?.getAttribute(name);
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function boolAttr(el: Element | null | undefined, name: string): boolean | undefined {
  const v = el?.getAttribute(name);
  if (v === null || v === undefined) return undefined;
  return v === '1' || v === 'true' || v === 'on';
}

/** r:id 류 속성 (네임스페이스 r) */
export function rAttr(el: Element | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  return el.getAttributeNS(NS.r, name) ?? el.getAttribute(`r:${name}`) ?? undefined;
}

/**
 * 요소를 독립된 XML 문자열로 직렬화 (필요한 네임스페이스 선언을 포함).
 * mc:Choice의 Requires 접두사처럼 속성 값에서만 쓰이는 접두사도 선언을 보충한다.
 */
export function serializeElement(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  // 원본 문서 루트의 네임스페이스 선언을 복사해 표준 접두사(r:, a: 등)를 유지
  const root = el.ownerDocument.documentElement;
  for (const a of Array.from(root.attributes)) {
    if ((a.name === 'xmlns' || a.name.startsWith('xmlns:')) && !clone.hasAttribute(a.name)) clone.setAttributeNS('http://www.w3.org/2000/xmlns/', a.name, a.value);
  }
  const fixRequires = (orig: Element, copy: Element) => {
    if (orig.localName === 'Choice' || orig.localName === 'AlternateContent') {
      const req = orig.getAttribute('Requires') ?? '';
      for (const prefix of req.split(/\s+/).filter(Boolean)) {
        const uri = orig.lookupNamespaceURI(prefix);
        if (uri && !copy.hasAttribute(`xmlns:${prefix}`)) copy.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${prefix}`, uri);
      }
    }
    const oc = kids(orig);
    const cc = kids(copy);
    oc.forEach((o, i) => cc[i] && fixRequires(o, cc[i]));
  };
  fixRequires(el, clone);
  return new XMLSerializer().serializeToString(clone);
}

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** 브라우저에서 직접 표시 가능한 이미지 형식 */
export const WEB_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);
