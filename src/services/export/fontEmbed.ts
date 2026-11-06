/**
 * 래스터화(SVG foreignObject → 그림)용 글꼴 CSS.
 * 그림으로 그릴 때는 문서에 FontFace로 등록한 글꼴을 쓸 수 없으므로, 슬라이드에 실제로 쓰인 글꼴만 @font-face(data: URL)로 넣는다.
 * - 내 글꼴: IndexedDB의 글꼴 파일 그대로
 * - 웹 글꼴(자체 호스팅): 쓰인 글자가 들어 있는 unicode-range 조각만
 * - 웹 글꼴(Google): 쓰인 글자만 담은 파일(text=)
 * - 시스템 글꼴: 그림 안에서도 그대로 쓰이므로 넣지 않음
 */
import { isWebFont, webFontByFamily, webFontCssUrl } from '../fonts/catalog';
import { fontStatus, selfHostedWebFonts, userFontRecords } from '../fonts/library';
import { MATH_FONT_FAMILY, MATH_FONT_URL } from '../../engines/rendering/mathFont';

/** 앱에 들어 있는 글꼴 (수식 글꼴) */
const APP_FONTS: Record<string, string> = { [MATH_FONT_FAMILY.toLowerCase()]: MATH_FONT_URL };

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial']);

/** font-family 목록 → 이름들 */
export function familyList(css: string): string[] {
  return css
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s && !GENERIC.has(s.toLowerCase()));
}

/** 문서에 등록된(스타일시트 또는 FontFace) 글꼴인지 */
function registered(family: string): boolean {
  const low = family.toLowerCase();
  for (const f of document.fonts) if (f.family.replace(/^["']|["']$/g, '').toLowerCase() === low) return true;
  return false;
}

/**
 * 대체 글꼴 목록에서 실제로 그려질 글꼴: 내 글꼴·웹 글꼴이면 그것을 넣고 멈춤,
 * 이 컴퓨터에 설치된 글꼴이면(그림 안에서도 그대로 쓰임) 멈춤, 없으면 다음 후보
 */
export function effectiveFamilies(families: string[]): string[] {
  const out: string[] = [];
  for (const f of families) {
    if (APP_FONTS[f.toLowerCase()]) {
      out.push(f);
      break;
    }
    const st = fontStatus(f);
    if (st.source === 'user') {
      out.push(f);
      break;
    }
    // 웹 글꼴은 화면에서 실제로 불러온 경우에만 (안 불러온 대체 글꼴 후보는 화면에서도 건너뜀)
    if (st.source === 'web') {
      if (registered(f)) {
        out.push(f);
        break;
      }
      continue;
    }
    if (st.available) break;
  }
  return out;
}

/** 노드 아래 글자를 (실제로 그려질) 글꼴 이름별로 모음 */
export function collectText(root: Element, pick: (families: string[]) => string[] = effectiveFamilies): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const styleCache = new Map<Element, string>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (!text.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    let fam = styleCache.get(el);
    if (fam === undefined) {
      fam = getComputedStyle(el).fontFamily;
      styleCache.set(el, fam);
    }
    for (const f of pick(familyList(fam))) {
      let set = out.get(f.toLowerCase());
      if (!set) out.set(f.toLowerCase(), (set = new Set()));
      for (const ch of text) set.add(ch);
    }
  }
  return out;
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });
}

/** unicode-range: U+AC00-D7A3, U+20 … 에 글자가 하나라도 있는지 */
export function rangeHits(range: string, cps: number[]): boolean {
  const parts = range.split(',').map((p) => p.trim().replace(/^U\+/i, ''));
  for (const p of parts) {
    let lo: number, hi: number;
    if (p.includes('?')) {
      lo = parseInt(p.replace(/\?/g, '0'), 16);
      hi = parseInt(p.replace(/\?/g, 'F'), 16);
    } else if (p.includes('-')) {
      const [a, b] = p.split('-');
      lo = parseInt(a, 16);
      hi = parseInt(b, 16);
    } else lo = hi = parseInt(p, 16);
    if (cps.some((c) => c >= lo && c <= hi)) return true;
  }
  return false;
}

/** 캐시: 같은 글꼴·글자 조합은 다시 받지 않음 (내보내기 한 번 동안 여러 슬라이드에서 재사용) */
export class FontEmbedder {
  private dataUrls = new Map<string, Promise<string>>();
  private cssCache = new Map<string, Promise<string>>();

  private fetchDataUrl(url: string): Promise<string> {
    let p = this.dataUrls.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then(toDataUrl);
      this.dataUrls.set(url, p);
      p.catch(() => this.dataUrls.delete(url));
    }
    return p;
  }

  private fetchText(url: string): Promise<string> {
    let p = this.cssCache.get(url);
    if (!p) {
      p = fetch(url).then((r) => (r.ok ? r.text() : ''));
      this.cssCache.set(url, p);
      p.catch(() => this.cssCache.delete(url));
    }
    return p;
  }

  /** @font-face 블록들의 url()을 data: URL로 (기준 주소 base) */
  private async inline(css: string, base: string, filter?: (block: string) => boolean): Promise<string> {
    const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    const out: string[] = [];
    for (const b of blocks) {
      if (filter && !filter(b)) continue;
      const urls = [...b.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)];
      let block = b;
      for (const m of urls) {
        try {
          const abs = new URL(m[2], base).href;
          block = block.replace(m[0], `url("${await this.fetchDataUrl(abs)}")`);
        } catch {
          /* 못 받은 조각은 건너뜀 (시스템 대체 글꼴로 그려짐) */
        }
      }
      out.push(block);
    }
    return out.join('\n');
  }

  /** 노드에 쓰인 글꼴의 @font-face CSS */
  async cssFor(root: Element): Promise<string> {
    const used = collectText(root);
    if (!used.size) return '';
    const parts: string[] = [];
    // 앱 글꼴 (수식)
    for (const low of used.keys()) {
      const url = APP_FONTS[low];
      if (url) parts.push(`@font-face{font-family:"${MATH_FONT_FAMILY}";src:url("${await this.fetchDataUrl(new URL(url, location.href).href)}") format("woff2");}`);
    }
    // 내 글꼴
    const recs = await userFontRecords([...used.keys()]);
    const covered = new Set<string>();
    for (const r of recs) {
      const names = [r.family, ...r.aliases].filter((n) => used.has(n.toLowerCase()));
      if (!names.length) continue;
      const key = `user:${r.id}`;
      let url = this.dataUrls.get(key);
      if (!url) this.dataUrls.set(key, (url = toDataUrl(r.data)));
      const src = await url;
      const weight = r.weightRange ? `${r.weightRange[0]} ${r.weightRange[1]}` : r.weight;
      for (const n of names) {
        covered.add(n.toLowerCase());
        parts.push(`@font-face{font-family:"${n.replace(/"/g, '\\"')}";src:url("${src}");font-weight:${weight};font-style:${r.italic ? 'italic' : 'normal'};}`);
      }
    }
    // 웹 글꼴
    const manifest = await selfHostedWebFonts();
    for (const [low, chars] of used) {
      if (covered.has(low) || !isWebFont(low)) continue;
      const f = webFontByFamily.get(low)!;
      const entry = manifest?.families[f.family];
      const cps = [...chars].map((c) => c.codePointAt(0)!);
      if (entry) {
        const base = new URL(`${import.meta.env.BASE_URL ?? '/'}webfonts/`, location.href).href;
        const css = await this.fetchText(new URL(`${entry.css}?v=${entry.hash}`, base).href);
        parts.push(await this.inline(css, base, (b) => {
          const m = b.match(/unicode-range:\s*([^;]+);/);
          return !m || rangeHits(m[1], cps);
        }));
      } else {
        // Google: 쓰인 글자만 담은 파일 (굵기·기울임 모두)
        const text = [...chars].sort().join('');
        const url = webFontCssUrl(f.family).replace('&display=swap', `&display=swap&text=${encodeURIComponent(text)}`);
        const css = await this.fetchText(url).catch(() => '');
        parts.push(await this.inline(css, url));
      }
    }
    return parts.filter(Boolean).join('\n');
  }
}
