/**
 * 비교 창 (PowerPoint: 검토 › 비교). 검토본 파일과 다른 점을 슬라이드별로 보여 주고 하나씩 또는 모두 적용한다.
 * 적용은 각각 실행 취소 한 단계 (모두 적용은 한 단계).
 */
import { useMemo, useState } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { useEditor } from '../../core/store/editorStore';
import { applyChange, comparePresentations, type Change } from '../../core/compare/compare';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import type { Presentation } from '../../types/model';
import { pickFiles } from '../../services/storage/files';

/** 검토본 고르기 → 비교 시작 */
export async function startCompare(file?: File) {
  const st = useEditor.getState();
  const f = file ?? (await pickFiles('.pptx,.slidelab,application/vnd.openxmlformats-officedocument.presentationml.presentation', false))[0];
  if (!f) return;
  const progress = st.toast(`'${f.name}'와(과) 비교하는 중…`);
  try {
    let other: Presentation;
    if (/\.slidelab$/i.test(f.name)) {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'slidelab' || !data.doc?.slides) throw new Error('SlideLab 파일 형식이 아닙니다.');
      other = data.doc as Presentation;
    } else {
      const { importPptx } = await import('../../services/import/pptxImport');
      const { saveBlob } = await import('../../services/storage/db');
      const r = await importPptx(await f.arrayBuffer(), f.name);
      // 적용할 때 미디어를 쓸 수 있게 바이너리 저장
      for (const b of r.blobs) await saveBlob(b.key, new Blob([b.data as BlobPart], { type: b.mime }));
      other = r.doc;
    }
    useEditor.getState().set({ compare: { other, fileName: f.name }, compareSel: null, spellPane: false, commentsPane: false });
  } catch (e) {
    useEditor.getState().toast(`비교할 수 없습니다: ${(e as Error).message}`, 'error');
  } finally {
    useEditor.getState().dismissToast(progress);
  }
}

const KIND_ICON: Record<Change['kind'], string> = {
  slideInserted: '＋',
  slideDeleted: '－',
  objectInserted: '＋',
  objectDeleted: '－',
  textChanged: '✎',
  objectMoved: '⇲',
  objectFormatted: '🎨',
  notesChanged: '✎',
  slideFormatted: '🎨',
};

export function ComparePane() {
  const doc = useEditor((s) => s.doc);
  const cmp = useEditor((s) => s.compare)!;
  const sel = useEditor((s) => s.compareSel);
  const [applied, setApplied] = useState(0);
  const changes = useMemo(() => comparePresentations(doc, cmp.other), [doc, cmp.other]);
  const cur = changes.find((c) => c.id === sel) ?? null;
  const groups = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of changes) {
      const key = c.slideId ?? '__start';
      m.set(key, [...(m.get(key) ?? []), c]);
    }
    return [...m.entries()];
  }, [changes]);
  const end = () => useEditor.getState().set({ compare: null, compareSel: null });

  const select = (c: Change) => {
    const st = useEditor.getState();
    st.set({ compareSel: c.id });
    if (c.slideId && c.kind !== 'slideInserted') {
      if (st.activeSlideId !== c.slideId) st.setActiveSlide(c.slideId);
      if (c.objectId) st.select([c.objectId]);
    }
  };
  const apply = (list: Change[], label: string) => {
    let n = 0;
    // 슬라이드 삭제는 마지막에 (다른 변경의 기준 슬라이드가 사라지지 않게)
    const ordered = [...list].sort((a, b) => Number(a.kind === 'slideDeleted') - Number(b.kind === 'slideDeleted'));
    useEditor.getState().commit(label, (d) => {
      for (const c of ordered) if (applyChange(d as Presentation, cmp.other, c)) n++;
    });
    setApplied((x) => x + n);
    useEditor.getState().set({ compareSel: null });
  };
  const otherSlide = cur?.otherSlideId ? cmp.other.slides.find((s) => s.id === cur.otherSlideId) : undefined;
  const curSlide = cur?.slideId && cur.kind !== 'slideInserted' ? doc.slides.find((s) => s.id === cur.slideId) : undefined;

  return (
    <aside className="properties compare-pane" aria-label="비교" data-compare-pane="">
      <div className="pp-head">
        <span title={cmp.fileName}>비교: {cmp.fileName}</span>
        <button type="button" className="icon-btn" title="비교 끝내기" onClick={end} data-compare-end="">
          <X size={16} />
        </button>
      </div>
      <div className="cm-body">
        {cur && (curSlide || otherSlide) && (
          <div className="cmp-preview">
            <figure>
              <figcaption>현재</figcaption>
              {curSlide ? <ScaledSlide slide={curSlide} doc={doc} width={124} /> : <div className="cmp-none">없음</div>}
            </figure>
            <figure>
              <figcaption>검토본</figcaption>
              {otherSlide && cur.kind !== 'slideDeleted' ? <ScaledSlide slide={otherSlide} doc={cmp.other} width={124} /> : <div className="cmp-none">없음</div>}
            </figure>
          </div>
        )}
        <div className="cmp-toolbar">
          <span className="muted" data-compare-count="">
            변경 {changes.length}개{applied ? ` · 적용 ${applied}개` : ''}
          </span>
          <button type="button" className="btn btn-sm" disabled={!changes.length} onClick={() => apply(changes, `검토본의 변경 모두 적용 (${changes.length}개)`)} data-compare-all="">
            <CheckCheck size={14} /> 모두 적용
          </button>
        </div>
        {!changes.length && (
          <p className="muted" data-compare-done="">
            검토본과 다른 점이 없습니다.
          </p>
        )}
        {groups.map(([key, list]) => (
          <section key={key} className="cmp-group">
            <h4>{key === '__start' ? '프레젠테이션 맨 앞' : `슬라이드 ${doc.slides.findIndex((s) => s.id === key) + 1}`}</h4>
            {list.map((c) => (
              <div key={c.id} className={`cmp-item ${c.id === sel ? 'is-active' : ''} cmp-${c.kind}`} onClick={() => select(c)} data-compare-kind={c.kind}>
                <span className="cmp-icon" aria-hidden>
                  {KIND_ICON[c.kind]}
                </span>
                <span className="cmp-main">
                  <span>{c.label}</span>
                  {c.diff && (
                    <span className="cmp-diff">
                      {c.diff.map((p, i) => (
                        <span key={i} className={`d-${p.op}`}>
                          {p.text}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    apply([c], `검토본 변경 적용: ${c.label}`);
                  }}
                  data-compare-apply=""
                >
                  적용
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
