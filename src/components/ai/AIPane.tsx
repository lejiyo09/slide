/**
 * AI 도우미 창 (오른쪽): 만들기 · 다듬기 · 디자인 · 이미지.
 * 모든 결과는 문서에 바로 반영되며 실행 취소(Ctrl+Z) 한 번으로 되돌릴 수 있다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose, Settings, Sparkles, Wand2, FileText, ListTree, X, AlertTriangle, Info, CircleAlert, Check, ImagePlus } from 'lucide-react';
import { useEditor, useActiveSlide } from '../../core/store/editorStore';
import * as AI from '../../core/commands/aiActions';
import { AISettingsDialog } from './AISettingsDialog';
import { loadAISettings } from '../../services/ai/settings';
import { CLAUDE_MODELS } from '../../services/ai/models';
import { AIError, type CallOptions, type CompareItem, type DesignChoice, type DocumentInput, type OutlineSpec, type Suggestion } from '../../services/ai/types';
import type { DesignIssue } from '../../services/ai/analyze';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { TEMPLATES } from '../../themes/templates';
import { COLOR_SCHEMES, FONT_SCHEMES } from '../../themes/schemes';
import { formatDuration } from '../../engines/show/showModel';

type Tab = 'create' | 'refine' | 'design' | 'image';

/** 진행 중 작업 (취소 가능) */
function useJob() {
  const [busy, setBusy] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const run = async <T,>(label: string, fn: (call: CallOptions) => Promise<T>): Promise<T | undefined> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(label);
    setChars(0);
    setError(null);
    try {
      return await fn({ signal: c.signal, onProgress: (p) => setChars(p.chars) });
    } catch (e) {
      const err = e instanceof AIError ? e : new AIError(e instanceof Error ? e.message : String(e));
      if (err.kind !== 'aborted') setError(err.message);
      return undefined;
    } finally {
      if (ctrl.current === c) {
        setBusy(null);
        ctrl.current = null;
      }
    }
  };
  useEffect(() => () => ctrl.current?.abort(), []);
  return { busy, chars, error, setError, run, cancel: () => ctrl.current?.abort() };
}

function providerLabel() {
  const s = loadAISettings();
  if (s.provider === 'openai') return `GPT (${s.gpt.model})`;
  if (s.provider === 'anthropic') return CLAUDE_MODELS.find((m) => m.id === s.anthropic.model)?.name.replace(' (기본)', '') ?? s.anthropic.model;
  if (s.provider === 'openai-compatible') return s.openai.model || 'OpenAI 호환';
  return '기본 엔진 (오프라인)';
}

export function AIPane() {
  const tab = useEditor((s) => s.aiPane) ?? 'create';
  const [settings, setSettings] = useState(false);
  const [, bump] = useState(0);
  const job = useJob();
  const offline = loadAISettings().provider === 'offline';
  const setTab = (t: Tab) => useEditor.getState().set({ aiPane: t });
  return (
    <aside className="properties ai-pane" aria-label="AI 도우미">
      <div className="pp-head">
        <span>
          <Sparkles size={15} /> AI 도우미
        </span>
        <span className="sb-spacer" />
        <button type="button" className="icon-btn" title="AI 설정" data-ai="settings" onClick={() => setSettings(true)}>
          <Settings size={15} />
        </button>
        <button type="button" className="icon-btn" title="닫기" onClick={() => useEditor.getState().set({ aiPane: null })}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="ai-provider" data-ai="provider">
        <span className={`ai-dot ${offline ? 'is-offline' : ''}`} />
        {providerLabel()}
        {offline && (
          <button type="button" className="link-btn" onClick={() => setSettings(true)}>
            AI 연결
          </button>
        )}
      </div>
      <div className="ai-tabs" role="tablist">
        {(
          [
            ['create', '만들기'],
            ['refine', '다듬기'],
            ['design', '디자인'],
            ['image', '이미지'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="pp-body ai-body">
        {job.busy && (
          <div className="ai-busy" role="status" data-ai="busy">
            <span className="ai-spinner" />
            <span>
              {job.busy}
              {job.chars ? ` · ${job.chars.toLocaleString()}자 받음` : ''}
            </span>
            <button type="button" className="btn btn-sm" onClick={job.cancel}>
              취소
            </button>
          </div>
        )}
        {job.error && (
          <div className="ai-error" role="alert" data-ai="error">
            <CircleAlert size={14} />
            <span>{job.error}</span>
            <button type="button" className="icon-btn" title="닫기" onClick={() => job.setError(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        {tab === 'create' && <CreateTab job={job} offline={offline} />}
        {tab === 'refine' && <RefineTab job={job} />}
        {tab === 'design' && <DesignTab job={job} offline={offline} />}
        {tab === 'image' && <ImageTab job={job} onSettings={() => setSettings(true)} />}
      </div>
      {settings && (
        <AISettingsDialog
          onClose={() => {
            setSettings(false);
            bump((n) => n + 1);
          }}
        />
      )}
    </aside>
  );
}

type Job = ReturnType<typeof useJob>;

function Section({ title, icon, children, hint }: { title: string; icon?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <section className="ai-section">
      <h3>
        {icon}
        {title}
      </h3>
      {hint && <p className="ai-hint">{hint}</p>}
      {children}
    </section>
  );
}

/* ───────────── 만들기 ───────────── */

function CreateTab({ job, offline }: { job: Job; offline: boolean }) {
  const [mode, setMode] = useState<'prompt' | 'outline' | 'document'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState('');
  const [audience, setAudience] = useState('');
  const [notes, setNotes] = useState(true);
  const [where, setWhere] = useState<'replace' | 'append'>('replace');
  const [outlineText, setOutlineText] = useState('');
  const [doc, setDoc] = useState<DocumentInput | null>(null);
  const opts = { slideCount: Number(count) || undefined, audience: audience.trim() || undefined, withNotes: notes };
  const make = (input: Parameters<typeof AI.generate>[0]) => void job.run('프레젠테이션을 만드는 중', (call) => AI.generate(input, opts, where, call));
  return (
    <>
      <div className="ai-seg" role="radiogroup" aria-label="만드는 방법">
        {(
          [
            ['prompt', '주제·설명으로'],
            ['outline', '목차 먼저'],
            ['document', '문서에서'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'is-on' : ''} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>
      {offline && <p className="ai-hint ai-offline-hint">기본 엔진은 주제로 발표 구성 틀(작성 안내)을 만들고, 문서는 구조와 원문 문장을 요약해 슬라이드로 바꿉니다. 새 내용을 쓰려면 AI를 연결하세요.</p>}
      {mode !== 'document' && (
        <label className="ai-field">
          {mode === 'prompt' ? '무엇에 대한 발표인가요?' : '주제'}
          <textarea
            data-ai="prompt"
            rows={mode === 'prompt' ? 4 : 2}
            value={prompt}
            placeholder={mode === 'prompt' ? '예: 신입 사원 대상 정보 보안 교육, 10분' : '예: 재택근무 도입 제안'}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
      )}
      {mode === 'document' && (
        <div className="ai-field">
          문서 (.txt, .md, .docx{offline ? '' : ', .pdf'})
          <input
            type="file"
            data-ai="doc-file"
            accept={offline ? '.txt,.md,.markdown,.docx,text/plain,text/markdown' : '.txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf'}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setDoc(await AI.readDocumentFile(f));
              } catch (err) {
                job.setError((err as Error).message);
              }
            }}
          />
          <textarea data-ai="doc-text" rows={5} placeholder="또는 여기에 내용을 붙여 넣으세요" value={doc && !doc.pdfBase64 && doc.name === '붙여 넣은 내용' ? doc.text : ''} onChange={(e) => setDoc(e.target.value ? { name: '붙여 넣은 내용', text: e.target.value } : null)} />
          {doc && doc.name !== '붙여 넣은 내용' && (
            <span className="ai-file" data-ai="doc-name">
              <FileText size={13} /> {doc.name} {doc.text ? `(${doc.text.length.toLocaleString()}자)` : '(PDF)'}
            </span>
          )}
        </div>
      )}
      <div className="ai-opts">
        <label>
          슬라이드 수
          <input type="number" min={2} max={40} value={count} placeholder="자동" onChange={(e) => setCount(e.target.value)} aria-label="슬라이드 수" />
        </label>
        <label>
          청중
          <input value={audience} placeholder="예: 경영진" onChange={(e) => setAudience(e.target.value)} aria-label="청중" />
        </label>
        <label className="ai-check">
          <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> 발표자 노트(대본)도 작성
        </label>
        <label className="ai-check">
          <input type="radio" name="ai-where" checked={where === 'replace'} onChange={() => setWhere('replace')} /> 현재 슬라이드를 모두 바꾸기
        </label>
        <label className="ai-check">
          <input type="radio" name="ai-where" checked={where === 'append'} onChange={() => setWhere('append')} /> 현재 슬라이드 뒤에 추가
        </label>
      </div>
      {mode === 'prompt' && (
        <button type="button" className="btn primary ai-go" data-ai="generate" disabled={!prompt.trim() || !!job.busy} onClick={() => make({ prompt })}>
          <Wand2 size={14} /> 만들기
        </button>
      )}
      {mode === 'document' && (
        <button type="button" className="btn primary ai-go" data-ai="generate-doc" disabled={!doc || !!job.busy} onClick={() => doc && make({ document: doc })}>
          <Wand2 size={14} /> 문서로 만들기
        </button>
      )}
      {mode === 'outline' && (
        <>
          <button
            type="button"
            className="btn ai-go"
            data-ai="outline"
            disabled={!prompt.trim() || !!job.busy}
            onClick={async () => {
              const o = await job.run('목차를 구성하는 중', (call) => AI.outline(prompt, opts, call));
              if (o) setOutlineText(AI.outlineToText(o));
            }}
          >
            <ListTree size={14} /> 목차 만들기
          </button>
          {outlineText && (
            <>
              <label className="ai-field">
                목차 (# 제목, ## 구역, - 요점 — 고쳐서 쓰세요)
                <textarea data-ai="outline-text" rows={12} value={outlineText} onChange={(e) => setOutlineText(e.target.value)} />
              </label>
              <button type="button" className="btn primary ai-go" data-ai="generate-outline" disabled={!!job.busy} onClick={() => make({ outline: AI.textToOutline(outlineText) as OutlineSpec })}>
                <Wand2 size={14} /> 이 목차로 만들기
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

/* ───────────── 다듬기 ───────────── */

function RefineTab({ job }: { job: Job }) {
  const [length, setLength] = useState<'short' | 'medium'>('short');
  const [summary, setSummary] = useState<{ text: string; source: string } | null>(null);
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [seconds, setSeconds] = useState('60');
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [cmp, setCmp] = useState<CompareItem[] | null>(null);
  const doc = useEditor((s) => s.doc);
  const selCount = useEditor((s) => s.selectedIds.length);
  return (
    <>
      <Section title="요약" hint={selCount ? '선택한 개체의 텍스트를 요약합니다.' : '현재 슬라이드의 텍스트를 요약합니다. 개체를 선택하면 그 개체만 요약합니다.'}>
        <div className="ai-row-inline">
          <select value={length} onChange={(e) => setLength(e.target.value as 'short')} aria-label="요약 길이">
            <option value="short">짧게 (2~3줄)</option>
            <option value="medium">보통 (4~6줄)</option>
          </select>
          <button
            type="button"
            className="btn"
            data-ai="summarize"
            disabled={!!job.busy}
            onClick={async () => {
              const src = AI.textForSummary();
              if (!src.text.trim()) return job.setError('요약할 텍스트가 없습니다.');
              const r = await job.run('요약하는 중', (call) => AI.summarize(src.text, length, call));
              if (r) setSummary({ text: r, source: src.source });
            }}
          >
            요약
          </button>
        </div>
        {summary && (
          <div className="ai-result" data-ai="summary">
            <pre>{summary.text}</pre>
            <div className="ai-actions">
              {summary.source === 'selection' && (
                <button type="button" className="btn btn-sm" onClick={() => AI.applySummary(summary.text, 'replaceSelection')}>
                  선택한 개체를 요약으로 바꾸기
                </button>
              )}
              <button type="button" className="btn btn-sm" data-ai="summary-slide" onClick={() => AI.applySummary(summary.text, 'newSlide')}>
                새 슬라이드로
              </button>
              <button type="button" className="btn btn-sm" onClick={() => AI.applySummary(summary.text, 'notes')}>
                노트에 추가
              </button>
              <button type="button" className="btn btn-sm" onClick={() => AI.insertTextBox(summary.text)}>
                텍스트 상자로 삽입
              </button>
            </div>
          </div>
        )}
      </Section>
      <Section title="발표 대본 작성" hint="슬라이드 내용으로 발표자 노트에 읽을 대본을 씁니다.">
        <div className="ai-opts">
          <label className="ai-check">
            <input type="radio" name="ai-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> 모든 슬라이드
          </label>
          <label className="ai-check">
            <input type="radio" name="ai-scope" checked={scope === 'current'} onChange={() => setScope('current')} /> 현재 슬라이드
          </label>
          <label>
            슬라이드당 (초)
            <input type="number" min={15} max={300} value={seconds} onChange={(e) => setSeconds(e.target.value)} aria-label="슬라이드당 시간" />
          </label>
          <label className="ai-check">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> 노트가 빈 슬라이드만
          </label>
        </div>
        <button type="button" className="btn" data-ai="script" disabled={!!job.busy} onClick={() => void job.run('대본을 쓰는 중', (call) => AI.writeScripts(scope, { secondsPerSlide: Number(seconds) || 60, onlyEmpty }, call))}>
          대본 쓰기
        </button>
      </Section>
      <Section title="대본과 슬라이드 비교" hint="발표자 노트가 슬라이드 내용을 빠짐없이 다루는지, 발표 시간이 적당한지 확인합니다.">
        <button
          type="button"
          className="btn"
          data-ai="compare"
          disabled={!!job.busy}
          onClick={async () => {
            const r = await job.run('비교하는 중', (call) => AI.compare(call));
            if (r) setCmp(r);
          }}
        >
          비교
        </button>
        {cmp && (
          <div className="ai-compare" data-ai="compare-result">
            <div className="ai-total">예상 발표 시간 {formatDuration(cmp.reduce((a, b) => a + b.seconds, 0) * 1000)}</div>
            {cmp.map((c) => {
              const n = doc.slides.findIndex((s) => s.id === c.slideId) + 1;
              return (
                <button type="button" key={c.slideId} className="ai-cmp-row" onClick={() => useEditor.getState().setActiveSlide(c.slideId)}>
                  <span className="ai-cmp-num">{n}</span>
                  <span className="ai-cmp-main">
                    <span className="ai-cov">
                      <span style={{ width: `${Math.round(c.coverage * 100)}%`, background: c.coverage >= 0.7 ? '#2e8b57' : c.coverage >= 0.4 ? '#d49b00' : '#c43e1c' }} />
                    </span>
                    <span className="ai-cmp-meta">
                      포함 {Math.round(c.coverage * 100)}% · {c.seconds}초
                    </span>
                    {c.missing.length > 0 && <span className="ai-missing">빠진 핵심어: {c.missing.join(', ')}</span>}
                    {c.notes.map((x, i) => (
                      <span key={i} className="ai-cmp-note">
                        {x}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}

/* ───────────── 디자인 ───────────── */

function DesignTab({ job, offline }: { job: Job; offline: boolean }) {
  const doc = useEditor((s) => s.doc);
  const slide = useActiveSlide();
  const [ideas, setIdeas] = useState<DesignChoice[] | null>(null);
  const issues = useMemo(() => AI.lint(), [doc]); // 문서가 바뀔 때마다 다시 점검
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[] | null>(null);
  const [layoutSg, setLayoutSg] = useState<Suggestion[] | null>(null);
  const fixable = issues.filter((i) => i.fixable);
  const icon = (i: DesignIssue) => (i.severity === 'error' ? <CircleAlert size={13} /> : i.severity === 'warning' ? <AlertTriangle size={13} /> : <Info size={13} />);
  return (
    <>
      <Section title="디자인 아이디어" hint="내용에 어울리는 템플릿·색·글꼴 조합을 추천합니다.">
        <button
          type="button"
          className="btn"
          data-ai="ideas"
          disabled={!!job.busy}
          onClick={async () => {
            const r = await job.run('디자인을 고르는 중', (call) => AI.chooseDesign(call));
            if (r) setIdeas(r);
          }}
        >
          <Sparkles size={14} /> 추천 받기
        </button>
        {ideas && (
          <div className="ai-ideas">
            {ideas.map((c, i) => (
              <button key={i} type="button" className="ai-idea" data-ai="idea" title={c.reason} onClick={() => AI.applyDesign(c)}>
                <ScaledSlide slide={slide} doc={AI.designPreview(doc, c)} width={232} />
                <span className="ai-idea-name">
                  {TEMPLATES.find((t) => t.id === c.templateId)?.name} · {COLOR_SCHEMES.find((x) => x.id === c.colorScheme)?.name ?? '기본 색'} · {FONT_SCHEMES.find((x) => x.id === c.fontScheme)?.name ?? '기본 글꼴'}
                </span>
                <span className="ai-idea-reason">{c.reason}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
      <Section title={`디자인 점검 (${issues.length})`} hint="글자 크기·글 양·명암 대비·슬라이드 밖 개체·겹침·글꼴 수 등을 점검합니다.">
        {fixable.length > 1 && (
          <button type="button" className="btn btn-sm" data-ai="fix-all" onClick={() => AI.fix(fixable)}>
            <Check size={13} /> 고칠 수 있는 {fixable.length}개 모두 고치기
          </button>
        )}
        {!issues.length && <p className="ai-hint">발견된 문제가 없습니다.</p>}
        <ul className="ai-issues" data-ai="issues">
          {issues.map((i) => (
            <li key={i.id} className={`sev-${i.severity}`} data-kind={i.kind}>
              {icon(i)}
              <button type="button" className="link-btn ai-issue-msg" onClick={() => useEditor.getState().setActiveSlide(i.slideId)}>
                {i.message}
              </button>
              {i.fixable && (
                <button type="button" className="btn btn-sm" onClick={() => AI.fix([i])}>
                  고치기
                </button>
              )}
            </li>
          ))}
        </ul>
        {!offline && (
          <button
            type="button"
            className="btn btn-sm"
            data-ai="review"
            disabled={!!job.busy}
            onClick={async () => {
              const r = await job.run('디자인을 검토하는 중', (call) => AI.reviewDesign(call));
              if (r) setAiSuggestions(r);
            }}
          >
            AI 의견 받기
          </button>
        )}
        {aiSuggestions && <SuggestionList items={aiSuggestions} empty="추가 의견이 없습니다." />}
      </Section>
      <Section title="구성 추천" hint="내용에 맞는 레이아웃, 슬라이드 나누기, 차트 사용 등을 추천합니다.">
        <button
          type="button"
          className="btn"
          data-ai="layout"
          disabled={!!job.busy}
          onClick={async () => {
            const r = await job.run('구성을 살펴보는 중', (call) => AI.recommendLayout('all', call));
            if (r) setLayoutSg(r);
          }}
        >
          추천 받기
        </button>
        {layoutSg && <SuggestionList items={layoutSg} empty="바꿀 만한 구성이 없습니다." />}
      </Section>
    </>
  );
}

function SuggestionList({ items, empty }: { items: Suggestion[]; empty: string }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  if (!items.length) return <p className="ai-hint">{empty}</p>;
  return (
    <ul className="ai-suggestions" data-ai="suggestions">
      {items.map((s, i) => (
        <li key={i}>
          <button type="button" className="link-btn ai-issue-msg" onClick={() => s.slideId && useEditor.getState().setActiveSlide(s.slideId)}>
            {s.message}
          </button>
          {s.action && !done.has(i) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                AI.applySuggestion(s);
                setDone(new Set(done).add(i));
              }}
            >
              적용
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ───────────── 이미지 ───────────── */

function ImageTab({ job, onSettings }: { job: Job; onSettings: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<'1024x1024' | '1536x1024' | '1024x1536'>('1536x1024');
  const [img, setImg] = useState<{ blob: Blob; url: string } | null>(null);
  const enabled = loadAISettings().image.enabled;
  useEffect(
    () => () => {
      if (img) URL.revokeObjectURL(img.url);
    },
    [img],
  );
  if (!enabled)
    return (
      <Section title="이미지 생성" icon={<ImagePlus size={14} />}>
        <p className="ai-hint">이미지 생성 제공자가 연결되어 있지 않습니다. AI 설정에서 '이미지 생성 사용'을 켜면 OpenAI 이미지 API(GPT 키) 또는 다른 호환 엔드포인트로 그림을 만들어 슬라이드에 넣을 수 있습니다.</p>
        <button type="button" className="btn" onClick={onSettings}>
          AI 설정 열기
        </button>
      </Section>
    );
  return (
    <Section title="이미지 생성" icon={<ImagePlus size={14} />}>
      <label className="ai-field">
        만들 그림 설명
        <textarea data-ai="image-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="예: 파란 하늘 아래 풍력 발전기, 평면 일러스트" />
      </label>
      <div className="ai-row-inline">
        <select value={size} onChange={(e) => setSize(e.target.value as typeof size)} aria-label="크기">
          <option value="1536x1024">가로 (3:2)</option>
          <option value="1024x1024">정사각형</option>
          <option value="1024x1536">세로 (2:3)</option>
        </select>
        <button
          type="button"
          className="btn primary"
          data-ai="image-generate"
          disabled={!prompt.trim() || !!job.busy}
          onClick={async () => {
            const b = await job.run('그림을 만드는 중', (call) => AI.generateImage(prompt, size, call));
            if (b) setImg({ blob: b, url: URL.createObjectURL(b) });
          }}
        >
          만들기
        </button>
      </div>
      {img && (
        <div className="ai-result">
          <img src={img.url} alt={prompt} className="ai-image" data-ai="image-preview" />
          <button type="button" className="btn btn-sm" data-ai="image-insert" onClick={() => void AI.insertGeneratedImage(img.blob, prompt)}>
            슬라이드에 삽입
          </button>
        </div>
      )}
    </Section>
  );
}
