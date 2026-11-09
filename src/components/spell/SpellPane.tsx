/**
 * 맞춤법 검사 창 (PowerPoint: 검토 › 맞춤법 검사, F7).
 * 현재 슬라이드부터 문서 끝까지(그다음 처음부터) 차례로 보여 주고 무시/모두 무시/사전에 추가/변경/모두 변경.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookPlus, Check, Sparkles, X } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import type { AIEdit, Speller, SpellIssue, SpellLang } from '../../services/spell/spell';

type SpellModule = typeof import('../../services/spell/spell');

const KIND: Record<SpellIssue['kind'], string> = { spelling: '맞춤법', grammar: '문법·띄어쓰기 (한국어 규범)', repeat: '반복된 단어', ai: 'AI 문맥 문법' };
const sig = (i: SpellIssue) => `${i.slideId}|${i.objectId}|${i.cell?.join(',') ?? ''}|${i.paragraph}|${i.start}|${i.word}`;

export function SpellPane() {
  const doc = useEditor((s) => s.doc);
  const close = () => useEditor.getState().set({ spellPane: false });
  const [mod, setMod] = useState<SpellModule | null>(null);
  const [spellers, setSpellers] = useState<Partial<Record<SpellLang, Speller>>>({});
  const [status, setStatus] = useState<string | null>('사전을 불러오는 중…');
  const [ignore, setIgnore] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [startSlide] = useState(() => useEditor.getState().activeSlideId);
  const [choice, setChoice] = useState(0);
  const [fixed, setFixed] = useState(0);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [aiEdits, setAiEdits] = useState<AIEdit[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);

  /** AI 문맥 문법 검사: 설정한 생성형 모델(GPT 프록시 등)에 문단을 보내 고칠 부분을 받음 */
  const runAI = async () => {
    if (!mod) return;
    const { getProvider } = await import('../../services/ai/settings');
    const provider = await getProvider();
    if (!provider.generative) {
      setAiBusy('AI 문법 검사는 생성형 모델이 필요합니다. 홈 › AI 도우미 › 설정에서 모델(GPT 프록시 등)을 연결하세요.');
      return;
    }
    const paras = mod.listParagraphs(useEditor.getState().doc, includeNotes);
    const edits: AIEdit[] = [];
    setAiRunning(true);
    try {
      for (let i = 0; i < paras.length; i += 30) {
        setAiBusy(`AI가 문장을 검사하는 중… (${Math.min(paras.length, i + 30)}/${paras.length}문단)`);
        const batch = paras.slice(i, i + 30);
        const r = await provider.proofread(batch.map((p, k) => ({ id: `p${k}`, text: p.text })));
        for (const e of r) edits.push({ key: batch[Number(e.id.slice(1))].key, find: e.find, replace: e.replace, reason: e.reason });
      }
      setAiEdits(edits);
      setAiBusy(edits.length ? null : 'AI가 고칠 곳을 찾지 못했습니다.');
    } catch (e) {
      setAiBusy(`AI 문법 검사를 하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setAiRunning(false);
    }
  };

  // 문서에 있는 언어의 사전만 받음
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const m = await import('../../services/spell/spell');
        const all = doc.slides.map((s) => JSON.stringify(s.objects) + s.notes).join('');
        const langs: SpellLang[] = [...(/[가-힣]/.test(all) ? (['ko'] as const) : []), ...(/[A-Za-z]{2}/.test(all) ? (['en'] as const) : [])];
        const loaded: Partial<Record<SpellLang, Speller>> = {};
        for (const l of langs) {
          setStatus(`${l === 'ko' ? '한국어' : '영어'} 사전을 받는 중… (처음 한 번)`);
          loaded[l] = await m.loadSpeller(l);
        }
        if (!alive) return;
        setMod(m);
        setSpellers(loaded);
        setStatus(null);
      } catch (e) {
        console.error(e);
        if (alive) setStatus(`사전을 불러오지 못했습니다: ${(e as Error).message}`);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issues = useMemo(() => {
    if (!mod) return [];
    const base = mod.checkDocument(doc, { speller: (l) => spellers[l] ?? null, ignore, includeNotes });
    // AI 결과는 규칙·사전 결과와 겹치지 않는 것만
    const ai = mod.aiIssues(doc, aiEdits, includeNotes).filter((a) => !ignore.has(a.word) && !base.some((b) => b.slideId === a.slideId && b.objectId === a.objectId && b.paragraph === a.paragraph && `${b.cell}` === `${a.cell}` && b.start < a.end && b.end > a.start));
    const list = [...base, ...ai].filter((i) => !skipped.has(sig(i)));
    // 현재 슬라이드부터
    const order = (id: string) => (doc.slides.findIndex((s) => s.id === id) - doc.slides.findIndex((s) => s.id === startSlide) + doc.slides.length) % doc.slides.length;
    return list.sort((a, b) => order(a.slideId) - order(b.slideId));
  }, [mod, doc, spellers, ignore, skipped, includeNotes, startSlide, aiEdits]);
  const cur = issues[0];
  const suggestions = useMemo(() => {
    if (!cur) return [];
    if (cur.kind !== 'spelling') return cur.suggestions;
    const lang: SpellLang = /[가-힣]/.test(cur.word) ? 'ko' : 'en';
    return (spellers[lang]?.suggest(cur.word) ?? []).slice(0, 8);
  }, [cur, spellers]);

  // 지금 이슈가 있는 슬라이드·개체로 이동
  useEffect(() => {
    setChoice(0);
    if (!cur) return;
    const st = useEditor.getState();
    if (st.activeSlideId !== cur.slideId) st.setActiveSlide(cur.slideId);
    if (cur.objectId !== 'notes') st.select([cur.objectId]);
    else st.set({ showNotes: true });
  }, [cur?.id, cur?.slideId, cur?.objectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback(
    (all: boolean) => {
      if (!mod || !cur) return;
      const to = suggestions[choice];
      if (to === undefined) return;
      const targets = all ? issues.filter((i) => i.word === cur.word && i.kind === cur.kind) : [cur];
      let n = 0;
      // 같은 문단 안에서는 뒤에서부터 바꿔야 앞 위치가 그대로
      const ordered = [...targets].sort((a, b) => b.start - a.start);
      useEditor.getState().commit(all ? `맞춤법: 모두 변경 (${cur.word} → ${to})` : `맞춤법: ${cur.word} → ${to}`, (d) => {
        for (const t of ordered) if (mod.applyFix(d, t, to)) n++;
      });
      setFixed((f) => f + n);
    },
    [mod, cur, suggestions, choice, issues],
  );

  return (
    <aside className="properties spell-pane" aria-label="맞춤법 검사" data-spell-pane="">
      <div className="pp-head">
        <span>맞춤법 검사</span>
        <button type="button" className="icon-btn" title="닫기" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div className="cm-body">
        {status ? (
          <p className="muted" data-spell-status="">
            {status}
          </p>
        ) : !cur ? (
          <div className="spell-done" data-spell-done="">
            <Check size={28} />
            <p>맞춤법 검사를 완료했습니다.{fixed ? ` ${fixed}곳을 고쳤습니다.` : ''}</p>
            <button type="button" className="btn btn-sm" onClick={close}>
              확인
            </button>
          </div>
        ) : (
          <>
            <div className="spell-kind">
              {KIND[cur.kind]} · 슬라이드 {doc.slides.findIndex((s) => s.id === cur.slideId) + 1}
              {cur.objectId === 'notes' ? ' 노트' : ''}
            </div>
            <div className="spell-word" data-spell-word="">
              {cur.word}
            </div>
            <div className="spell-context">{cur.context}</div>
            {cur.why && <p className="muted spell-why">{cur.why}</p>}
            <div className="spell-sugs" role="listbox" aria-label="추천 단어" data-spell-suggestions="">
              {suggestions.length ? (
                suggestions.map((s, i) => (
                  <button key={s} type="button" role="option" aria-selected={i === choice} className={i === choice ? 'is-sel' : ''} onClick={() => setChoice(i)} onDoubleClick={() => change(false)}>
                    {s}
                  </button>
                ))
              ) : (
                <span className="muted">추천 단어 없음</span>
              )}
            </div>
            <div className="spell-actions">
              <button type="button" className="btn btn-sm primary" disabled={!suggestions.length} onClick={() => change(false)} data-spell-change="">
                변경
              </button>
              <button type="button" className="btn btn-sm" disabled={!suggestions.length} onClick={() => change(true)} data-spell-change-all="">
                모두 변경
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSkipped((s) => new Set(s).add(sig(cur)))} data-spell-ignore="">
                무시
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setIgnore((s) => new Set(s).add(cur.word))} data-spell-ignore-all="">
                모두 무시
              </button>
              {cur.kind === 'spelling' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  title="사용자 사전에 추가 (이 브라우저)"
                  onClick={() => {
                    mod!.addToDictionary(cur.word);
                    setIgnore((s) => new Set(s).add(cur.word));
                  }}
                  data-spell-add=""
                >
                  <BookPlus size={13} /> 사전에 추가
                </button>
              )}
            </div>
            <p className="muted spell-count">남은 항목 {issues.length}개</p>
          </>
        )}
        {!status && (
          <div className="spell-ai">
            <button type="button" className="btn btn-sm" disabled={aiRunning} onClick={() => void runAI()} data-spell-ai="" title="설정한 AI 모델로 문장 전체의 문맥(조사·어미·띄어쓰기·낱말 선택)을 검사합니다. 문단 글자가 AI 제공자로 전송됩니다.">
              <Sparkles size={13} /> AI 문법 검사
            </button>
            {aiBusy && (
              <p className="muted" data-spell-ai-status="">
                {aiBusy}
              </p>
            )}
          </div>
        )}
        <label className="fm-check spell-opt">
          <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} /> 슬라이드 노트도 검사
        </label>
        <SpellAsYouType />
      </div>
    </aside>
  );
}

function SpellAsYouType() {
  const v = useEditor((s) => s.spellAsYouType);
  return (
    <label className="fm-check spell-opt">
      <input
        type="checkbox"
        checked={v}
        onChange={(e) => {
          useEditor.getState().set({ spellAsYouType: e.target.checked });
          try {
            localStorage.setItem('slidelab.spellAsYouType', e.target.checked ? '1' : '0');
          } catch {
            /* 저장 불가 */
          }
        }}
      />{' '}
      입력할 때 맞춤법 검사 (브라우저 사전)
    </label>
  );
}

export function openSpellPane() {
  useEditor.getState().set({ spellPane: true, commentsPane: false });
}
