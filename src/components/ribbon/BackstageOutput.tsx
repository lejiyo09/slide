/** 백스테이지: 인쇄 페이지 + PDF/그림 내보내기 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImage, FileText, Printer } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { downloadBlob } from '../../services/storage/files';
import { LAYOUT_NAMES, PrintPages, PrintPortal, pageCount, pageSize, parseRange, slidesToPrint, type PrintLayout, type PrintSettings } from '../print/PrintView';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function PrintPage() {
  const doc = useEditor((s) => s.doc);
  const current = useEditor((s) => s.activeSlideId);
  const [settings, setSettings] = useState<PrintSettings>({ layout: 'slides', range: 'all', includeHidden: true, color: 'color', frame: false });
  const [custom, setCustom] = useState('');
  const [printing, setPrinting] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const rangeValue = settings.range === 'all' || settings.range === 'current' ? settings.range : 'custom';
  const rangeError = rangeValue === 'custom' && !parseRange(custom, doc.slides.length);
  const eff = rangeValue === 'custom' ? { ...settings, range: custom } : settings;
  const slides = useMemo(() => slidesToPrint(doc, eff, current), [doc, eff.range, eff.includeHidden, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = pageCount(slides.length, settings.layout);
  const size = pageSize(doc, settings.layout);
  const previewW = Math.min(520, Math.round((600 * size.width) / size.height));
  const scale = previewW / size.width;
  const page = Math.min(pageIdx, Math.max(0, pages - 1));
  const set = (p: Partial<PrintSettings>) => setSettings((s) => ({ ...s, ...p }));

  const print = async () => {
    if (!slides.length || rangeError) return;
    setPrinting(true);
    // 인쇄 영역을 그린 뒤 글꼴·그림이 준비되면 인쇄 대화 상자
    await nextFrame();
    await nextFrame();
    await document.fonts.ready;
    const imgs = [...document.querySelectorAll<HTMLImageElement>('#sl-print-root img')];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))));
    // 인쇄 대화 상자가 닫히면 인쇄 영역 정리
    window.addEventListener('afterprint', () => setPrinting(false), { once: true });
    window.print();
  };

  return (
    <section className="bs-print">
      <div className="bs-print-settings">
        <h1>인쇄</h1>
        <button type="button" className="btn primary bs-print-btn" disabled={!slides.length || rangeError || printing} onClick={() => void print()} data-print-go="">
          <Printer size={18} /> 인쇄
        </button>
        <p className="muted">브라우저 인쇄 창에서 프린터를 고르거나 “PDF로 저장”을 고르면 글자를 선택·검색할 수 있는 PDF가 만들어집니다.</p>
        <label>
          슬라이드
          <select value={rangeValue} onChange={(e) => set({ range: e.target.value === 'custom' ? '1' : e.target.value })} data-print-range="">
            <option value="all">모든 슬라이드 인쇄</option>
            <option value="current">현재 슬라이드 인쇄</option>
            <option value="custom">사용자 지정 범위</option>
          </select>
        </label>
        {rangeValue === 'custom' && (
          <label>
            범위 (예: 1-3, 5)
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-invalid={rangeError} data-print-custom="" />
            {rangeError && <small className="error-text">1부터 {doc.slides.length} 사이의 번호로 입력하세요.</small>}
          </label>
        )}
        <label>
          인쇄 모양
          <select value={settings.layout} onChange={(e) => (set({ layout: e.target.value as PrintLayout }), setPageIdx(0))} data-print-layout="">
            {(Object.keys(LAYOUT_NAMES) as PrintLayout[]).map((k) => (
              <option key={k} value={k}>
                {LAYOUT_NAMES[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          색
          <select value={settings.color} onChange={(e) => set({ color: e.target.value as PrintSettings['color'] })}>
            <option value="color">컬러</option>
            <option value="grayscale">회색조</option>
            <option value="bw">흑백</option>
          </select>
        </label>
        <label className="fm-check">
          <input type="checkbox" checked={settings.includeHidden} onChange={(e) => set({ includeHidden: e.target.checked })} data-print-hidden="" /> 숨겨진 슬라이드 인쇄
        </label>
        <label className="fm-check">
          <input type="checkbox" checked={settings.frame} onChange={(e) => set({ frame: e.target.checked })} /> 슬라이드 테두리
        </label>
      </div>
      <div className="bs-print-preview">
        <div className="pv-page" style={{ width: previewW, height: size.height * scale }} data-print-preview="">
          {slides.length ? (
            <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
              <PreviewPage doc={doc} slides={slides} settings={eff} index={page} />
            </div>
          ) : (
            <p className="muted pv-empty">인쇄할 슬라이드가 없습니다.</p>
          )}
        </div>
        <div className="pv-nav">
          <button type="button" className="btn btn-sm" disabled={page <= 0} onClick={() => setPageIdx(page - 1)} aria-label="이전 페이지">
            ‹
          </button>
          <span data-print-pages="">
            {pages ? page + 1 : 0} / {slides.length ? pages : 0}
          </span>
          <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPageIdx(page + 1)} aria-label="다음 페이지">
            ›
          </button>
        </div>
      </div>
      {printing && <PrintPortal doc={doc} slides={slides} settings={eff} />}
    </section>
  );
}

/** 미리 보기: 전체 페이지를 그리지 않고 지금 페이지만 */
function PreviewPage({ doc, slides, settings, index }: { doc: Parameters<typeof PrintPages>[0]['doc']; slides: Parameters<typeof PrintPages>[0]['slides']; settings: PrintSettings; index: number }) {
  const per = settings.layout === 'slides' || settings.layout === 'notes' ? 1 : settings.layout === 'outline' ? 6 : Number(settings.layout.replace('handout', ''));
  return <PrintPages doc={doc} slides={slides.slice(index * per, index * per + per)} settings={settings} pageOffset={index} />;
}

/* ───────────── PDF / 그림 내보내기 ───────────── */

export function PdfImageExport() {
  const doc = useEditor((s) => s.doc);
  const current = useEditor((s) => s.activeSlideId);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfQuality, setPdfQuality] = useState<'standard' | 'minimum'>('standard');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png');
  const [imgWhich, setImgWhich] = useState<'current' | 'all'>('current');
  const [imgScale, setImgScale] = useState(1.5);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const toast = useEditor.getState().toast;

  const run = async (label: string, job: (signal: AbortSignal, progress: (d: number, t: number) => void) => Promise<void>) => {
    abort.current = new AbortController();
    setBusy(`${label} 준비 중…`);
    try {
      await job(abort.current.signal, (d, t) => setBusy(`${label} ${d}/${t}`));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error(e);
        toast(`${label} 실패: ${(e as Error).message}`, 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bs-export-forms">
      <div className="bs-export-item bs-form" data-export-pdf="">
        <FileText size={28} />
        <span>
          <strong>PDF 문서 (.pdf)</strong>
          <span className="muted">슬라이드를 그림으로 담은 PDF를 바로 내려받습니다. 글자를 선택할 수 있는 PDF는 인쇄 › “PDF로 저장”을 쓰세요.</span>
          <span className="bs-form-row">
            <select value={pdfQuality} onChange={(e) => setPdfQuality(e.target.value as 'standard')} aria-label="PDF 품질">
              <option value="standard">표준 (온라인 게시 및 인쇄)</option>
              <option value="minimum">최소 크기 (온라인 게시)</option>
            </select>
            <label className="fm-check">
              <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} /> 숨겨진 슬라이드 포함
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy}
              data-export-pdf-go=""
              onClick={() =>
                void run('PDF', async (signal, onProgress) => {
                  const { exportPdf, safeName } = await import('../../services/export/imageExport');
                  const blob = await exportPdf(doc, { quality: pdfQuality, includeHidden, signal, onProgress });
                  downloadBlob(blob, `${safeName(doc.title)}.pdf`);
                  toast('PDF 파일을 내보냈습니다.', 'success');
                })
              }
            >
              PDF 만들기
            </button>
          </span>
        </span>
      </div>
      <div className="bs-export-item bs-form" data-export-image="">
        <FileImage size={28} />
        <span>
          <strong>그림 (.png / .jpg)</strong>
          <span className="muted">슬라이드를 그림 파일로 저장합니다. 모든 슬라이드는 ZIP 파일 하나로 받습니다.</span>
          <span className="bs-form-row">
            <select value={imgFormat} onChange={(e) => setImgFormat(e.target.value as 'png')} aria-label="그림 형식">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
            <select value={imgWhich} onChange={(e) => setImgWhich(e.target.value as 'current')} aria-label="내보낼 슬라이드">
              <option value="current">현재 슬라이드만</option>
              <option value="all">모든 슬라이드</option>
            </select>
            <select value={imgScale} onChange={(e) => setImgScale(Number(e.target.value))} aria-label="해상도">
              <option value={1}>
                {doc.size.width}×{doc.size.height}
              </option>
              <option value={1.5}>
                {Math.round(doc.size.width * 1.5)}×{Math.round(doc.size.height * 1.5)}
              </option>
              <option value={3}>
                {doc.size.width * 3}×{doc.size.height * 3}
              </option>
            </select>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy}
              data-export-image-go=""
              onClick={() =>
                void run('그림', async (signal, onProgress) => {
                  const { exportSlideImages } = await import('../../services/export/imageExport');
                  const ids = imgWhich === 'current' ? [current] : doc.slides.map((s) => s.id);
                  const r = await exportSlideImages(doc, { format: imgFormat, scale: imgScale, slideIds: ids, signal, onProgress });
                  downloadBlob(r.blob, r.fileName);
                  toast(r.count > 1 ? `슬라이드 ${r.count}장을 그림으로 내보냈습니다 (ZIP).` : '현재 슬라이드를 그림으로 내보냈습니다.', 'success');
                })
              }
            >
              그림 저장
            </button>
          </span>
        </span>
      </div>
      {busy && (
        <div className="bs-progress" role="status" data-export-busy="">
          {busy}
          <button type="button" className="btn btn-sm" onClick={() => abort.current?.abort()}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}
