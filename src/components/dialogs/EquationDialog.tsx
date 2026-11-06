/**
 * 수식 편집 (PowerPoint: 삽입 › 수식 / 수식 탭). LaTeX로 입력하고 바로 미리 본다.
 * 구조(분수·첨자·근호·적분…)·기호 단추, 기본 제공 수식 갤러리, 글자 크기·색·맞춤.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as C from '../../core/commands/commands';
import type { EquationObject } from '../../types/model';
import { newId } from '../../utils/id';
import { ptToPx } from '../../utils/units';
import { sanitizeMathml } from '../../services/math/omml';
import { ensureMathFont, MATH_FONT_STACK } from '../../engines/rendering/mathFont';

type EqModule = typeof import('../../services/math/equation');

export function EquationDialogHost() {
  const id = useEditor((s) => s.equationEditorId);
  if (!id) return null;
  return <EquationDialog id={id} onClose={() => useEditor.getState().set({ equationEditorId: null })} />;
}

function findEquation(id: string): EquationObject | undefined {
  const slide = getActiveSlide();
  return slide.objects.find((o): o is EquationObject => o.id === id && o.type === 'equation');
}

function EquationDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const existing = id === 'new' ? undefined : findEquation(id);
  const [mod, setMod] = useState<EqModule | null>(null);
  const [latex, setLatex] = useState(existing?.latex ?? 'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}');
  const [fontSize, setFontSize] = useState(existing?.fontSize ?? 28);
  const [color, setColor] = useState(existing?.color ?? '#000000');
  const [align, setAlign] = useState<EquationObject['align']>(existing?.align ?? 'center');
  const ta = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    ensureMathFont();
    let alive = true;
    void import('../../services/math/equation').then((m) => alive && setMod(m));
    return () => {
      alive = false;
    };
  }, []);
  const rendered = useMemo(() => (mod ? mod.latexToMathml(latex) : null), [mod, latex]);
  // 실제 크기로 그려 개체 크기 계산 (PowerPoint처럼 수식에 맞춰 상자 크기 자동)
  useLayoutEffect(() => {
    const el = measure.current?.querySelector('math');
    if (!el) return;
    void document.fonts.ready.then(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.ceil(r.width) + 16, h: Math.ceil(r.height) + 12 });
    });
  }, [rendered, fontSize]);

  const insert = (snippet: string) => {
    const t = ta.current;
    if (!t) return setLatex((l) => l + snippet);
    const s = t.selectionStart, e = t.selectionEnd;
    const next = latex.slice(0, s) + snippet + latex.slice(e);
    setLatex(next);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(s + snippet.length, s + snippet.length);
    });
  };

  const ok = () => {
    if (!rendered || !latex.trim()) return;
    const st = useEditor.getState();
    const slide = getActiveSlide();
    const w = Math.max(40, size?.w ?? 300), h = Math.max(24, size?.h ?? 80);
    if (existing) {
      st.commit('수식 편집', (d) =>
        C.updateObjects(d, slide.id, [existing.id], (o) => {
          if (o.type !== 'equation') return;
          Object.assign(o, { latex, mathml: rendered.mathml, fontSize, color, align });
          // 가운데를 유지하며 크기를 내용에 맞춤
          o.x += (o.width - w) / 2;
          o.y += (o.height - h) / 2;
          o.width = w;
          o.height = h;
        }),
      );
    } else {
      const { width: W, height: H } = st.doc.size;
      const obj: EquationObject = { id: newId(), type: 'equation', name: '수식', x: (W - w) / 2, y: (H - h) / 2, width: w, height: h, rotation: 0, latex, mathml: rendered.mathml, fontSize, color, align };
      st.commit('수식 삽입', (d) => C.addObjects(d, slide.id, [obj]));
      st.select([obj.id]);
    }
    onClose();
  };

  return (
    <Dialog title={existing ? '수식 편집' : '수식 삽입'} onClose={onClose} onOk={ok}>
      <div className="eq-dialog" data-equation-dialog="">
        {!mod ? (
          <p className="muted">수식 편집기를 불러오는 중…</p>
        ) : (
          <>
            <div className="eq-toolbar">
              <select aria-label="기본 제공 수식" value="" onChange={(e) => e.target.value && setLatex(e.target.value)} data-eq-gallery="">
                <option value="">기본 제공 수식…</option>
                {mod.EQUATION_GALLERY.map((g) => (
                  <option key={g.name} value={g.latex}>
                    {g.name}
                  </option>
                ))}
              </select>
              {mod.EQUATION_STRUCTURES.map((g) => (
                <span className="eq-group" key={g.group} title={g.group}>
                  {g.items.map((it) => (
                    <button key={it.label} type="button" className="btn btn-sm" title={`${g.group}: ${it.latex}`} onClick={() => insert(it.latex)}>
                      {it.label}
                    </button>
                  ))}
                </span>
              ))}
            </div>
            <div className="eq-symbols" aria-label="기호">
              {mod.EQUATION_SYMBOLS.map((sym) => (
                <button key={sym} type="button" className="eq-sym" onClick={() => insert(sym)} title={sym}>
                  {sym}
                </button>
              ))}
            </div>
            <label className="eq-input">
              LaTeX (Ctrl+Enter: 확인)
              <textarea
                ref={ta}
                value={latex}
                spellCheck={false}
                rows={3}
                onChange={(e) => setLatex(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok();
                  if (e.key === 'Escape') onClose();
                }}
                data-eq-latex=""
                autoFocus
              />
            </label>
            {rendered?.error && (
              <p className="error-text" data-eq-error="">
                {rendered.error}
              </p>
            )}
            <div className="eq-preview" style={{ justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
              <div ref={measure} className="eq-measure" style={{ fontSize: `${ptToPx(fontSize)}px`, color, fontFamily: MATH_FONT_STACK }} dangerouslySetInnerHTML={{ __html: sanitizeMathml(rendered?.mathml ?? '') }} data-eq-preview="" />
            </div>
            <div className="eq-format">
              <label>
                크기(pt) <input type="number" min={8} max={200} value={fontSize} onChange={(e) => setFontSize(Math.max(8, Math.min(200, Number(e.target.value) || 28)))} onKeyDown={(e) => e.stopPropagation()} data-eq-size="" />
              </label>
              <label>
                색 <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label>
                맞춤
                <select value={align} onChange={(e) => setAlign(e.target.value as EquationObject['align'])}>
                  <option value="left">왼쪽</option>
                  <option value="center">가운데</option>
                  <option value="right">오른쪽</option>
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
