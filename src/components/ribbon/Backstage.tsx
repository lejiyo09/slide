import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES, type DesignTemplate } from '../../themes/templates';
import { applyDesignSnapshot, applyTemplate } from '../../core/commands/masterActions';
import { useDesignLibrary } from '../../hooks/useDesignLibrary';
import type { Presentation } from '../../types/model';
import { ArrowLeft, FilePlus2, FolderOpen, Download, History, Info, Trash2, FileJson, Presentation as PptIcon, MonitorDown } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { createPresentation } from '../../core/document/factory';
import { THEMES } from '../../themes/themes';
import { deleteProject, listProjects, listVersions, loadProject, loadVersion, type ProjectMeta } from '../../services/storage/db';
import { saveNow } from '../../services/storage/autosave';
import { downloadBlob, exportNative, pickFiles, safeFileName } from '../../services/storage/files';
import { openPresentationFile } from '../../services/import/importFile';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { usePwaInstall } from '../../hooks/usePwaInstall';

type Page = 'new' | 'open' | 'export' | 'history' | 'info';

export function Backstage() {
  const open = useEditor((s) => s.backstageOpen);
  const [page, setPage] = useState<Page>('open');
  if (!open) return null;
  const close = () => useEditor.getState().set({ backstageOpen: false });
  return (
    <div className="backstage" role="dialog" aria-label="파일">
      <nav className="bs-nav">
        <button type="button" className="bs-back" onClick={close} title="편집기로 돌아가기 (Esc)">
          <ArrowLeft size={20} />
        </button>
        <BsNav icon={<FilePlus2 size={18} />} label="새로 만들기" active={page === 'new'} onClick={() => setPage('new')} />
        <BsNav icon={<FolderOpen size={18} />} label="열기" active={page === 'open'} onClick={() => setPage('open')} />
        <BsNav icon={<Download size={18} />} label="내보내기" active={page === 'export'} onClick={() => setPage('export')} />
        <BsNav icon={<History size={18} />} label="버전 기록" active={page === 'history'} onClick={() => setPage('history')} />
        <BsNav icon={<Info size={18} />} label="정보" active={page === 'info'} onClick={() => setPage('info')} />
      </nav>
      <main className="bs-main">
        {page === 'new' && <NewPage close={close} />}
        {page === 'open' && <OpenPage close={close} />}
        {page === 'export' && <ExportPage />}
        {page === 'history' && <HistoryPage close={close} />}
        {page === 'info' && <InfoPage />}
      </main>
    </div>
  );
}

function BsNav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`bs-nav-item ${active ? 'is-active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

async function switchTo(load: () => Promise<void> | void) {
  // 현재 문서를 먼저 저장
  if (useEditor.getState().saveStatus !== 'saved') await saveNow();
  await load();
}

function NewPage({ close }: { close: () => void }) {
  const lib = useDesignLibrary();
  const start = (build: (d: Presentation) => void) =>
    switchTo(() => {
      const doc = createPresentation('제목 없는 프레젠테이션');
      useEditor.getState().loadDocument(doc);
      build(doc);
      useEditor.setState({ saveStatus: 'unsaved', history: { past: [], future: [] } });
      void saveNow();
      close();
    });
  return (
    <section>
      <h1>새로 만들기</h1>
      <h2>디자인 템플릿</h2>
      <div className="bs-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="bs-card" data-template={t.id} onClick={() => start(() => applyTemplate(t))}>
            <TemplatePreview template={t} />
            <span>{t.name}</span>
          </button>
        ))}
        {lib.templates.map((t) => (
          <button key={t.id} type="button" className="bs-card" onClick={() => start(() => applyDesignSnapshot(t.design, t.name))}>
            <div className="bs-thumb bs-user-tpl">{t.name}</div>
            <span>내 템플릿: {t.name}</span>
          </button>
        ))}
      </div>
      <h2>테마</h2>
      <div className="bs-grid">
        {THEMES.map((t) => {
          const doc = createPresentation('제목 없는 프레젠테이션', t);
          return (
            <button
              key={t.id}
              type="button"
              className="bs-card"
              onClick={() =>
                switchTo(() => {
                  useEditor.getState().loadDocument(createPresentation('제목 없는 프레젠테이션', structuredClone(t)));
                  useEditor.setState({ saveStatus: 'unsaved' });
                  void saveNow();
                  close();
                })
              }
            >
              <ScaledSlide slide={doc.slides[0]} doc={doc} width={200} className="bs-thumb" />
              <span>{t.id === 'office-clean' ? '새 프레젠테이션' : t.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TemplatePreview({ template }: { template: DesignTemplate }) {
  const doc = useMemo(() => {
    const d = createPresentation(template.name, template.theme);
    const design = template.build(d.size);
    d.master!.objects = [...design.master, ...d.master!.objects];
    d.master!.background = design.masterBackground ? { fill: design.masterBackground } : null;
    const tl = design.layouts?.title;
    if (tl) {
      d.layouts!.title.objects = [...(tl.objects ?? []), ...d.layouts!.title.objects];
      d.layouts!.title.background = tl.background ? { fill: tl.background } : null;
      d.layouts!.title.showMasterShapes = tl.hideMaster ? false : undefined;
    }
    const t = d.slides[0].objects[0];
    if (t?.type === 'text') t.text.paragraphs[0].runs[0].text = template.name;
    return d;
  }, [template]);
  return <ScaledSlide slide={doc.slides[0]} doc={doc} width={200} className="bs-thumb" />;
}

function OpenPage({ close }: { close: () => void }) {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const currentId = useEditor((s) => s.doc.id);
  const refresh = () => listProjects().then(setList).catch(() => setList([]));
  useEffect(() => {
    void saveNow().then(refresh);
  }, []);
  return (
    <section>
      <h1>열기</h1>
      <div className="bs-actions">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const [f] = await pickFiles('.slidelab,application/json');
            if (f && (await openPresentationFile(f))) close();
          }}
        >
          <FileJson size={16} /> SlideLab 파일 열기 (.slidelab)
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const [f] = await pickFiles('.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation');
            if (f && (await openPresentationFile(f))) close();
          }}
        >
          <PptIcon size={16} /> PowerPoint 파일 열기 (.pptx)
        </button>
      </div>
      <p className="muted">파일을 편집기 창으로 끌어다 놓아도 열 수 있습니다. 앱으로 설치하면 .pptx 파일을 SlideLab으로 바로 열 수 있습니다.</p>
      <h2>최근 프레젠테이션 (이 브라우저에 저장됨)</h2>
      {!list && <p className="muted">불러오는 중…</p>}
      {list && list.length === 0 && <p className="muted">저장된 프레젠테이션이 없습니다.</p>}
      <ul className="bs-list">
        {list?.map((m) => (
          <li key={m.id} className={m.id === currentId ? 'is-current' : ''}>
            <button
              type="button"
              className="bs-list-main"
              onClick={() =>
                switchTo(async () => {
                  const doc = await loadProject(m.id);
                  if (doc) useEditor.getState().loadDocument(doc);
                  close();
                })
              }
            >
              <strong>{m.title}</strong>
              <span className="muted">
                슬라이드 {m.slideCount}장 · {new Date(m.updatedAt).toLocaleString('ko-KR')} {m.id === currentId && '· 현재 문서'}
              </span>
            </button>
            <button
              type="button"
              className="icon-btn"
              title="삭제"
              disabled={m.id === currentId}
              onClick={async () => {
                if (!confirm(`'${m.title}'을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
                await deleteProject(m.id);
                refresh();
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExportPage() {
  const doc = useEditor((s) => s.doc);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  return (
    <section>
      <h1>내보내기</h1>
      <div className="bs-export">
        <button
          type="button"
          className="bs-export-item"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { exportPptxBlob } = await import('../../services/export/pptxExport');
              const { blob, warnings } = await exportPptxBlob(doc);
              downloadBlob(blob, `${safeFileName(doc.title)}.pptx`);
              setWarnings(warnings);
              useEditor.getState().toast('PPTX 파일을 내보냈습니다.', 'success');
            } catch (e) {
              console.error(e);
              useEditor.getState().toast(`PPTX 내보내기 실패: ${(e as Error).message}`, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <PptIcon size={28} />
          <span>
            <strong>PowerPoint 프레젠테이션 (.pptx)</strong>
            <span className="muted">Microsoft PowerPoint, Keynote, Google 슬라이드에서 열 수 있습니다.</span>
          </span>
        </button>
        <button type="button" className="bs-export-item" onClick={() => void exportNative(doc).then((r) => r.skippedFonts.length && useEditor.getState().toast(`포함이 제한된 글꼴은 파일에 넣지 않았습니다: ${r.skippedFonts.join(', ')}`, 'warning'))}>
          <FileJson size={28} />
          <span>
            <strong>SlideLab 문서 (.slidelab)</strong>
            <span className="muted">모든 편집 정보를 손실 없이 저장하는 백업 형식입니다.</span>
          </span>
        </button>
        <div className="bs-export-item is-disabled" title="14단계에서 구현 예정">
          <Download size={28} />
          <span>
            <strong>PDF / 이미지 — 준비 중</strong>
            <span className="muted">PDF 및 슬라이드 이미지 내보내기는 다음 단계에서 제공됩니다.</span>
          </span>
        </div>
      </div>
      {warnings && (
        <div className={`bs-warnings ${warnings.length ? '' : 'ok'}`}>
          {warnings.length ? (
            <>
              <strong>호환성 알림</strong>
              <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </>
          ) : (
            <strong>모든 요소가 변환 손실 없이 내보내졌습니다.</strong>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryPage({ close }: { close: () => void }) {
  const docId = useEditor((s) => s.doc.id);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof listVersions>> | null>(null);
  useEffect(() => {
    listVersions(docId).then(setVersions).catch(() => setVersions([]));
  }, [docId]);
  return (
    <section>
      <h1>버전 기록</h1>
      <p className="muted">검토 탭의 [버전 저장]으로 만든 버전입니다. 복원하면 현재 내용은 실행 취소로 되돌릴 수 있습니다.</p>
      {versions?.length === 0 && <p className="muted">저장된 버전이 없습니다.</p>}
      <ul className="bs-list">
        {versions?.map((v) => (
          <li key={v.key}>
            <div className="bs-list-main">
              <strong>{v.label}</strong>
              <span className="muted">{new Date(v.savedAt).toLocaleString('ko-KR')}</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const entry = await loadVersion(v.key);
                if (!entry) return;
                useEditor.getState().commit('버전 복원', (d) => {
                  const keepId = d.id;
                  Object.assign(d, structuredClone(entry.doc));
                  d.id = keepId;
                });
                close();
              }}
            >
              복원
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InfoPage() {
  const doc = useEditor((s) => s.doc);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const { canInstall, install, installed } = usePwaInstall();
  return (
    <section>
      <h1>정보</h1>
      <label className="field">
        <span>제목</span>
        <input
          defaultValue={doc.title}
          onBlur={(e) => e.target.value !== doc.title && useEditor.getState().commit('제목 변경', (d) => void (d.title = e.target.value || '제목 없는 프레젠테이션'))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <dl className="bs-info">
        <dt>슬라이드</dt>
        <dd>{doc.slides.length}장</dd>
        <dt>크기</dt>
        <dd>
          {(doc.size.width / 96).toFixed(2)} × {(doc.size.height / 96).toFixed(2)} in ({doc.size.preset})
        </dd>
        <dt>만든 날짜</dt>
        <dd>{new Date(doc.createdAt).toLocaleString('ko-KR')}</dd>
        <dt>마지막 저장</dt>
        <dd>{lastSavedAt ? new Date(lastSavedAt).toLocaleString('ko-KR') : '—'}</dd>
        <dt>저장 위치</dt>
        <dd>이 브라우저의 IndexedDB (오프라인에서도 사용 가능)</dd>
      </dl>
      <h2>앱 설치</h2>
      {installed ? (
        <p className="muted">SlideLab이 앱으로 실행 중입니다.</p>
      ) : canInstall ? (
        <button type="button" className="btn primary" onClick={install}>
          <MonitorDown size={16} /> SlideLab을 앱으로 설치
        </button>
      ) : (
        <p className="muted">브라우저 주소창의 설치 아이콘이나 메뉴의 "앱 설치"로 SlideLab을 설치할 수 있습니다. 설치 후에는 오프라인에서도 실행됩니다.</p>
      )}
    </section>
  );
}
