/**
 * 텍스트 서식 적용 디스패처.
 * - 편집 모드: 선택 영역(없으면 커서 위치 단어)에 execCommand / DOM 조작으로 적용
 * - 객체 선택 모드: 선택된 객체의 모든 텍스트에 모델 명령으로 적용
 */
import type { BulletType, HAlign, TextDirection, TextRunStyle, VAlign } from '../../types/model';
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import { getEditorSession, restoreSelection, selectedParagraphs } from './editorSession';
import { ptToPx } from '../../utils/units';
import { FONT_SIZES, cssFontStack } from './fonts';
import { BULLET_INDENT_PX, INDENT_PX, LINE_HEIGHT_FACTOR } from './richText';

export type FormatAction =
  | { type: 'toggle'; key: 'bold' | 'italic' | 'underline' | 'strike' }
  | { type: 'fontFamily'; value: string }
  | { type: 'fontSize'; value: number }
  | { type: 'growFont' }
  | { type: 'shrinkFont' }
  | { type: 'color'; value: string }
  | { type: 'highlight'; value: string | null }
  | { type: 'clear' }
  | { type: 'align'; value: HAlign }
  | { type: 'lineSpacing'; value: number }
  | { type: 'bullet'; value: BulletType }
  | { type: 'indent'; delta: 1 | -1 }
  | { type: 'direction'; value: TextDirection }
  | { type: 'vAlign'; value: VAlign }
  | { type: 'link'; url: string | null };

const isEditing = () => {
  const s = useEditor.getState();
  const sess = getEditorSession();
  return !!(s.editingTextId && sess && sess.objId === s.editingTextId && sess.root.isConnected);
};

export function applyFormat(action: FormatAction) {
  if (isEditing() && applyInEditor(action)) return;
  applyToSelection(action);
}

/* ───────────── 객체 선택 모드 ───────────── */

function nextSize(cur: number, dir: 1 | -1) {
  if (dir > 0) return FONT_SIZES.find((s) => s > cur) ?? Math.round(cur * 1.1);
  return [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, Math.round(cur * 0.9));
}

function applyToSelection(action: FormatAction) {
  const s = useEditor.getState();
  const slide = getActiveSlide();
  const ids = s.editingTextId ? [s.editingTextId] : s.selectedIds;
  if (!ids.length) return;
  const label = '텍스트 서식';
  // 표: 셀 선택 영역이 있으면 그 셀들에만
  const range = s.cellSelection && ids.length === 1 && s.cellSelection.id === ids[0] ? s.cellSelection : null;
  s.commit(label, (d) =>
    C.updateObjects(d, slide.id, ids, (o) => {
      switch (action.type) {
        case 'toggle':
          C.toggleRunFlag(o, action.key, range);
          break;
        case 'fontFamily':
          C.applyRunStyle(o, { fontFamily: action.value }, range);
          break;
        case 'fontSize':
          C.applyRunStyle(o, { fontSize: action.value }, range);
          break;
        case 'growFont':
        case 'shrinkFont': {
          const dir = action.type === 'growFont' ? 1 : -1;
          for (const b of C.textBodies(o, range)) for (const p of b.paragraphs) for (const r of p.runs) r.fontSize = nextSize(r.fontSize ?? 18, dir);
          break;
        }
        case 'color':
          C.applyRunStyle(o, { color: action.value }, range);
          break;
        case 'highlight':
          C.applyRunStyle(o, { highlight: action.value ?? undefined }, range);
          break;
        case 'clear':
          C.applyRunStyle(o, { bold: false, italic: false, underline: false, strike: false, highlight: undefined }, range);
          break;
        case 'align':
          C.applyParagraphStyle(o, { align: action.value }, range);
          break;
        case 'lineSpacing':
          C.applyParagraphStyle(o, { lineSpacing: action.value }, range);
          break;
        case 'bullet': {
          const paras = C.textBodies(o, range).flatMap((b) => b.paragraphs);
          const allSame = paras.length > 0 && paras.every((p) => p.bullet === action.value);
          C.applyParagraphStyle(o, { bullet: allSame ? 'none' : action.value }, range);
          break;
        }
        case 'indent': {
          for (const b of C.textBodies(o, range)) for (const p of b.paragraphs) p.level = Math.max(0, Math.min(8, (p.level ?? 0) + action.delta));
          break;
        }
        case 'direction':
          C.applyTextBody(o, { direction: action.value }, range);
          break;
        case 'vAlign':
          C.applyTextBody(o, { vAlign: action.value }, range);
          break;
        case 'link':
          // 개체 선택 상태: 개체 자체에 링크 (슬라이드 쇼에서 클릭 시 열림)
          if (action.url) o.link = action.url;
          else delete o.link;
          break;
      }
    }),
  );
}

/* ───────────── 편집 모드 ───────────── */

/** true를 반환하면 처리 완료 */
function applyInEditor(action: FormatAction): boolean {
  const sess = getEditorSession()!;
  // 문단/본문 단위 서식
  switch (action.type) {
    case 'align':
      selectedParagraphs().forEach((p) => (p.style.textAlign = action.value));
      sess.sync();
      return true;
    case 'lineSpacing':
      selectedParagraphs().forEach((p) => (p.style.lineHeight = String(action.value * LINE_HEIGHT_FACTOR)));
      sess.sync();
      return true;
    case 'bullet': {
      const paras = selectedParagraphs();
      const allSame = paras.every((p) => p.dataset.bullet === action.value);
      const v = allSame ? 'none' : action.value;
      paras.forEach((p) => {
        p.dataset.bullet = v;
        const lvl = Number(p.dataset.level ?? 0);
        p.style.paddingLeft = `${lvl * INDENT_PX + (v !== 'none' ? BULLET_INDENT_PX : 0)}px`;
      });
      sess.sync();
      return true;
    }
    case 'indent':
      selectedParagraphs().forEach((p) => {
        const lvl = Math.max(0, Math.min(8, Number(p.dataset.level ?? 0) + action.delta));
        p.dataset.level = String(lvl);
        const b = p.dataset.bullet && p.dataset.bullet !== 'none';
        p.style.paddingLeft = `${lvl * INDENT_PX + (b ? BULLET_INDENT_PX : 0)}px`;
      });
      sess.sync();
      return true;
    case 'direction':
    case 'vAlign':
      // 본문 전체 속성: 편집 종료 후 모델에 적용
      sess.sync();
      useEditor.getState().setEditingText(null);
      applyToSelection(action);
      return true;
  }

  const sel = restoreSelection();
  if (!sel || !sel.rangeCount) return false;
  // 커서만 있으면 PowerPoint처럼 커서 위치의 단어에 적용
  if (sel.isCollapsed) {
    const mod = (sel as Selection & { modify?: (a: string, d: string, g: string) => void }).modify;
    if (mod) {
      mod.call(sel, 'move', 'backward', 'word');
      mod.call(sel, 'extend', 'forward', 'word');
    }
    if (sel.isCollapsed) return applyWhole(action);
  }

  document.execCommand('styleWithCSS', false, 'true');
  switch (action.type) {
    case 'toggle': {
      const cmd = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough' }[action.key];
      document.execCommand(cmd);
      break;
    }
    case 'fontFamily':
      wrapSelectionStyle({ fontFamily: action.value });
      break;
    case 'fontSize':
      wrapSelectionStyle({ fontSize: action.value });
      break;
    case 'growFont':
    case 'shrinkFont': {
      const cur = currentSelectionStyle().fontSize ?? 18;
      wrapSelectionStyle({ fontSize: nextSize(cur, action.type === 'growFont' ? 1 : -1) });
      break;
    }
    case 'color':
      document.execCommand('foreColor', false, action.value);
      break;
    case 'highlight':
      document.execCommand('hiliteColor', false, action.value ?? 'transparent');
      break;
    case 'clear':
      document.execCommand('removeFormat');
      break;
    case 'link':
      if (action.url) {
        document.execCommand('createLink', false, action.url);
        // 하이퍼링크 기본 모양: 밑줄 + 링크 색
        sess.root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
          if (a.getAttribute('href') === action.url && !a.dataset.link) {
            a.dataset.link = '1';
            a.style.color = '#0563C1';
            a.style.textDecoration = 'underline';
          }
        });
      } else document.execCommand('unlink');
      break;
  }
  sess.sync();
  return true;
}

/** 텍스트가 없는 위치 등: 편집 중인 객체 전체에 적용 후 편집기 재시작 */
function applyWhole(action: FormatAction): boolean {
  const s = useEditor.getState();
  const id = s.editingTextId;
  getEditorSession()?.sync();
  s.setEditingText(null);
  applyToSelection(action);
  if (id) setTimeout(() => useEditor.getState().setEditingText(id), 0);
  return true;
}

/**
 * 선택 영역을 지정 스타일로 감싼다 (글꼴/크기).
 * execCommand('fontSize')는 1~7 단계만 지원하므로 표식(size=7)을 붙인 뒤 실제 스타일로 교체한다.
 */
function wrapSelectionStyle(style: TextRunStyle) {
  const sess = getEditorSession()!;
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand('fontSize', false, '7');
  const marks = Array.from(sess.root.querySelectorAll<HTMLElement>('font[size="7"]'));
  for (const f of marks) {
    const span = document.createElement('span');
    if (style.fontSize) span.style.fontSize = `${ptToPx(style.fontSize)}px`;
    if (style.fontFamily) span.style.fontFamily = cssFontStack(style.fontFamily);
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
    // 내부의 명시적 크기/글꼴을 제거해 새 값이 적용되도록
    span.querySelectorAll<HTMLElement>('span').forEach((inner) => {
      if (style.fontSize) inner.style.fontSize = '';
      if (style.fontFamily) inner.style.fontFamily = '';
    });
  }
  // xxx-large로 변환된 경우도 처리
  sess.root.querySelectorAll<HTMLElement>('span').forEach((sp) => {
    if (sp.style.fontSize === 'xxx-large' && style.fontSize) sp.style.fontSize = `${ptToPx(style.fontSize)}px`;
  });
  const sel = document.getSelection();
  if (sel && sel.rangeCount) sess.savedRange = sel.getRangeAt(0).cloneRange();
  document.execCommand('styleWithCSS', false, 'true');
}

/** 편집 중 선택 영역의 현재 스타일 (리본 표시용) */
export function currentSelectionStyle(): TextRunStyle & { align?: HAlign; bullet?: BulletType } {
  const sess = getEditorSession();
  if (!sess) return {};
  const range = sess.savedRange;
  let node: Node | null = range ? range.startContainer : sess.root.firstChild;
  if (node && node.nodeType === Node.ELEMENT_NODE && range && node.childNodes[range.startOffset]) node = node.childNodes[range.startOffset];
  const el = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement) as HTMLElement | null;
  if (!el || !sess.root.contains(el)) return {};
  const cs = getComputedStyle(el);
  const para = el.closest('.sl-p, div') as HTMLElement | null;
  let underline = false, strike = false;
  for (let e: HTMLElement | null = el; e && e !== sess.root; e = e.parentElement) {
    const d = e.style.textDecoration + ' ' + e.style.textDecorationLine;
    if (d.includes('underline') || e.tagName === 'U') underline = true;
    if (d.includes('line-through') || e.tagName === 'S' || e.tagName === 'STRIKE') strike = true;
  }
  return {
    fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
    fontSize: Math.round((parseFloat(cs.fontSize) * 72) / 96 * 10) / 10,
    bold: parseInt(cs.fontWeight, 10) >= 600,
    italic: cs.fontStyle === 'italic',
    underline,
    strike,
    align: (para?.style.textAlign as HAlign) || 'left',
    bullet: (para?.dataset.bullet as BulletType) ?? 'none',
  };
}
