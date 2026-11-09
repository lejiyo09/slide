/**
 * OOXML 스키마 검증 (테스트 전용).
 * Open XML SDK의 스키마 정의(JSON, ECMA-376 + Microsoft 확장에서 생성)로 요소의 자식 순서·개수와 필수 속성·허용 속성을 확인한다.
 * - 입자: Sequence / Choice / Group(=Sequence) / Any / 요소, Occurs 없으면 1번, 있으면 Min 기본 0·Max 기본 무한
 * - mc:AlternateContent: Choice와 Fallback의 내용을 각각 부모 자리에 넣어 검사
 * - 정의를 모르는 이름공간의 요소는 건너뛰고 따로 알려 줌
 */
import { readFileSync, readdirSync } from 'node:fs';

interface Occ {
  Min?: number;
  Max?: number;
}
interface Particle {
  Kind?: 'Sequence' | 'Choice' | 'Group' | 'Any' | 'All';
  Name?: string;
  Occurs?: Occ[];
  Items?: Particle[];
}
interface Attr {
  QName: string;
  Validators?: { Name: string }[];
}
interface TypeDef {
  Name: string;
  ClassName?: string;
  BaseClass?: string;
  Attributes?: Attr[];
  Particle?: Particle;
}

const DIR = 'src/test/ooxml-schemas';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

let loaded: { prefixToNs: Map<string, string>; types: Map<string, TypeDef>; byElement: Map<string, TypeDef[]>; knownNs: Set<string> } | null = null;

function load() {
  if (loaded) return loaded;
  const prefixToNs = new Map<string, string>();
  for (const n of JSON.parse(readFileSync(`${DIR}/namespaces.json`, 'utf8')) as { Prefix: string; Uri: string }[]) prefixToNs.set(n.Prefix, n.Uri);
  const types = new Map<string, TypeDef>();
  const byElement = new Map<string, TypeDef[]>();
  const knownNs = new Set<string>();
  for (const f of readdirSync(DIR).filter((x) => x.startsWith('schemas_'))) {
    const d = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as { TargetNamespace: string; Types: TypeDef[] };
    if (!Array.isArray(d.Types)) continue;
    knownNs.add(d.TargetNamespace);
    for (const t of d.Types) {
      types.set(t.Name, t);
      const el = t.Name.split('/')[1];
      if (el) byElement.set(el, [...(byElement.get(el) ?? []), t]);
    }
  }
  // 파생 타입(예: a:ext, p:notesSz)은 추상 기본 타입(BaseClass = C# 클래스 이름)의 속성·내용을 물려받음
  const byClass = new Map<string, TypeDef>();
  for (const t of types.values()) if (t.ClassName) byClass.set(t.ClassName, t);
  for (const t of types.values()) {
    let base = t.BaseClass ? byClass.get(t.BaseClass) : undefined;
    let guard = 0;
    while (base && guard++ < 5) {
      if (!t.Attributes && base.Attributes) t.Attributes = base.Attributes;
      else if (t.Attributes && base.Attributes) t.Attributes = [...t.Attributes, ...base.Attributes.filter((a) => !t.Attributes!.some((x) => x.QName === a.QName))];
      if (!t.Particle && base.Particle) t.Particle = base.Particle;
      base = base.BaseClass ? byClass.get(base.BaseClass) : undefined;
    }
  }
  loaded = { prefixToNs, types, byElement, knownNs };
  return loaded;
}

/** 'p:CT_Shape/p:sp' → {ns, local} */
function elementOf(name: string): { ns: string; local: string } | null {
  const { prefixToNs } = load();
  const el = name.split('/')[1];
  if (!el) return null;
  const [prefix, local] = el.includes(':') ? el.split(':') : ['', el];
  return { ns: prefixToNs.get(prefix) ?? '', local };
}

const occ = (p: Particle) => (p.Occurs ? { min: p.Occurs[0].Min ?? 0, max: p.Occurs[0].Max ?? Infinity } : { min: 1, max: 1 });

export interface SchemaIssue {
  path: string;
  message: string;
}

/** 요소 목록(kids)에서 입자를 i번부터 맞춰 볼 때 끝날 수 있는 위치들. matched: 위치 → 그 요소의 타입 이름 */
function matchParticle(p: Particle, kids: Element[], i: number, out: Map<number, string>[]): Set<number> {
  const { min, max } = occ(p);
  let current = new Set<number>([i]);
  const results = new Set<number>();
  const assign: Map<number, string>[] = [];
  if (min === 0) results.add(i);
  for (let n = 1; n <= Math.min(max, kids.length - i + 1) && current.size; n++) {
    const next = new Set<number>();
    for (const pos of current) for (const e of matchOnce(p, kids, pos, assign)) next.add(e);
    // 빈 내용으로 맞으면(선택 항목뿐) 남은 최소 반복도 비워서 채울 수 있음 → 그 위치에서 끝날 수 있음
    for (const x of current) if (next.has(x)) results.add(x);
    // 진전 없는 반복 방지
    for (const x of current) next.delete(x);
    if (n >= min) for (const e of next) results.add(e);
    current = next;
  }
  for (const a of assign) out.push(a);
  return results;
}

function matchOnce(p: Particle, kids: Element[], i: number, assign: Map<number, string>[]): Set<number> {
  if (!p.Kind) {
    // 요소
    const el = p.Name ? elementOf(p.Name) : null;
    const k = kids[i];
    if (el && k && (k.namespaceURI ?? '') === el.ns && k.localName === el.local) {
      assign.push(new Map([[i, p.Name!]]));
      return new Set([i + 1]);
    }
    return new Set();
  }
  if (p.Kind === 'Any') return kids[i] ? new Set([i + 1]) : new Set();
  const items = p.Items ?? [];
  if (p.Kind === 'Choice') {
    const out = new Set<number>();
    for (const it of items) for (const e of matchParticle(it, kids, i, assign)) out.add(e);
    return out;
  }
  // Sequence / Group / All(순서대로 근사)
  let pos = new Set<number>([i]);
  for (const it of items) {
    const next = new Set<number>();
    for (const x of pos) for (const e of matchParticle(it, kids, x, assign)) next.add(e);
    pos = next;
    if (!pos.size) break;
  }
  return pos;
}

/** mc:AlternateContent를 Choice(또는 Fallback)의 내용으로 펼침 */
function expand(kids: Element[], use: 'Choice' | 'Fallback'): Element[] {
  const out: Element[] = [];
  for (const k of kids) {
    if (k.namespaceURI === MC && k.localName === 'AlternateContent') {
      const branch = Array.from(k.children).find((c) => c.localName === use) ?? Array.from(k.children).find((c) => c.localName === 'Fallback');
      if (branch) out.push(...Array.from(branch.children));
    } else out.push(k);
  }
  return out;
}

export function validateElement(el: Element, typeName: string, path = '', issues: SchemaIssue[] = [], unknown = new Set<string>()): { issues: SchemaIssue[]; unknown: Set<string> } {
  const { types, knownNs, prefixToNs } = load();
  const t = types.get(typeName);
  const here = `${path}/${el.prefix ? `${el.prefix}:` : ''}${el.localName}`;
  if (!t) {
    unknown.add(typeName);
    return { issues, unknown };
  }
  // 속성
  const declared = new Map<string, Attr>();
  for (const a of t.Attributes ?? []) {
    const [pfx, local] = a.QName.split(':');
    declared.set(`${pfx ? prefixToNs.get(pfx) ?? pfx : ''}|${local}`, a);
  }
  for (const a of t.Attributes ?? []) {
    if (!a.Validators?.some((v) => v.Name === 'RequiredValidator')) continue;
    const [pfx, local] = a.QName.split(':');
    const ns = pfx ? prefixToNs.get(pfx) ?? null : null;
    if (!(ns ? el.hasAttributeNS(ns, local) : el.hasAttribute(local))) issues.push({ path: here, message: `필수 속성 ${a.QName.replace(/^:/, '')} 없음` });
  }
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'xmlns' || a.prefix === 'xmlns' || a.namespaceURI === MC || a.namespaceURI === 'http://www.w3.org/XML/1998/namespace') continue;
    const key = `${a.namespaceURI ?? ''}|${a.localName}`;
    if (!declared.has(key) && (a.namespaceURI === null || knownNs.has(a.namespaceURI))) issues.push({ path: here, message: `알 수 없는 속성 ${a.name}` });
  }
  // 자식
  const children = Array.from(el.children);
  // SDK는 a14:m(문단 안 수식)을 내용 없는 요소로 단순화했지만 MS-ODRAWXML에서는 OMML(m:oMathPara/m:oMath)을 담음 → OMML 스키마로 검사
  if (typeName === 'a14:CT_TextMath/a14:m') {
    for (const k of children) {
      const tn = load().byElement.get(`m:${k.localName}`)?.find((c) => elementOf(c.Name)?.ns === k.namespaceURI)?.Name;
      if (tn && (k.localName === 'oMathPara' || k.localName === 'oMath')) validateElement(k, tn, here, issues, unknown);
      else issues.push({ path: here, message: `a14:m 안에는 m:oMathPara/m:oMath만: ${k.localName}` });
    }
    return { issues, unknown };
  }
  if (!t.Particle) {
    if (children.length && !children.every((c) => c.namespaceURI === MC)) issues.push({ path: here, message: '자식 요소가 없어야 함' });
    return { issues, unknown };
  }
  for (const use of children.some((c) => c.namespaceURI === MC && c.localName === 'AlternateContent') ? (['Choice', 'Fallback'] as const) : (['Choice'] as const)) {
    const kids = expand(children, use);
    const assign: Map<number, string>[] = [];
    const ends = matchParticle(t.Particle, kids, 0, assign);
    if (!ends.has(kids.length)) {
      issues.push({ path: here, message: `자식 순서·개수가 스키마와 맞지 않음: [${kids.map((k) => `${k.prefix ? `${k.prefix}:` : ''}${k.localName}`).join(', ')}]` });
      continue;
    }
    // 자식마다 타입을 정해 재귀 (Any로 맞춘 요소는 그 요소 이름으로 찾음)
    kids.forEach((k, idx) => {
      let tn: string | undefined;
      for (const a of assign) if (a.has(idx)) tn = a.get(idx);
      if (!tn) {
        const cands = load().byElement.get(`${k.prefix}:${k.localName}`);
        tn = cands?.[0]?.Name;
      }
      if (tn) validateElement(k, tn, here, issues, unknown);
      else if (k.namespaceURI && !knownNs.has(k.namespaceURI)) unknown.add(`${k.namespaceURI}|${k.localName}`);
    });
  }
  return { issues, unknown };
}

/** XML 문자열 검증: 뿌리 요소 이름으로 타입을 찾음 (예: p:sld, p:cmLst, p188:cmLst) */
export function validateXml(xml: string, rootTypeHint?: string): SchemaIssue[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const key = `${root.prefix}:${root.localName}`;
  const cands = load().byElement.get(key) ?? [];
  const tn = rootTypeHint ?? cands.find((c) => elementOf(c.Name)?.ns === root.namespaceURI)?.Name;
  if (!tn) return [{ path: key, message: '뿌리 요소의 스키마 정의를 찾지 못함' }];
  return validateElement(root, tn).issues;
}
