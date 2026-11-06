/** 글꼴 관리 (추가·이름 바꾸기·삭제·웹 글꼴·이 컴퓨터의 글꼴) / 글꼴 바꾸기 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Upload, Pencil, Check } from 'lucide-react';
import { Dialog } from './Dialog';
import { useEditor } from '../../core/store/editorStore';
import { pickFiles } from '../../services/storage/files';
import { addFontFiles, fontStatus, keepWebFontOffline, offlineSize, queryLocalFonts, removeFonts, renameFamily, selfHostedWebFonts, setWebFontsEnabled, useFonts, type UserFontMeta } from '../../services/fonts/library';
import { WEB_FONTS } from '../../services/fonts/catalog';
import { fontsUsed, replaceFontInDoc } from '../../services/fonts/docFonts';
import { FontPicker } from '../common/FontPicker';
import { cssFontStack } from '../../editors/text/fonts';
import type { Presentation } from '../../types/model';

const FONT_ACCEPT = '.ttf,.otf,.ttc,.woff,.woff2,font/collection,font/ttf,font/otf,font/woff,font/woff2,application/font-woff,application/x-font-ttf';
const styleName = (f: Pick<UserFontMeta, 'weight' | 'italic'>) =>
  `${({ 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' } as Record<number, string>)[f.weight] ?? f.weight}${f.italic ? ' Italic' : ''}`;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

export async function addFontsFromFiles(files: File[]) {
  const st = useEditor.getState();
  const fonts = files.filter((f) => /\.(ttf|otf|ttc|woff2?)$/i.test(f.name));
  if (!fonts.length) {
    if (files.length) st.toast('글꼴 파일(.ttf, .otf, .ttc, .woff, .woff2)만 추가할 수 있습니다.', 'warning');
    return;
  }
  const r = await addFontFiles(fonts);
  const fams = [...new Set(r.added.map((a) => a.family))];
  if (fams.length) st.toast(`글꼴을 추가했습니다: ${fams.join(', ')}${r.replaced ? ` (${r.replaced}개는 같은 스타일을 바꿈)` : ''}`, 'success');
  for (const w of r.warnings) st.toast(w, 'warning');
  for (const e of r.errors) st.toast(e, 'error');
}

export function FontDialogs() {
  const mode = useEditor((s) => s.fontDialog);
  const close = () => useEditor.getState().set({ fontDialog: null });
  if (mode === 'replace') return <ReplaceFontsDialog onClose={close} />;
  if (mode === 'manage' || mode === 'add') return <FontManagerDialog onClose={close} pickOnOpen={mode === 'add'} />;
  return null;
}

function FontManagerDialog({ onClose, pickOnOpen }: { onClose: () => void; pickOnOpen: boolean }) {
  const { userFonts, webFonts, local, webSource } = useFonts();
  useEffect(() => void selfHostedWebFonts(), []);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [preview, setPreview] = useState('가나다 ABC abc 123 — 다람쥐 헌 쳇바퀴에 타고파');
  const picked = useRef(false);
  const families = useMemo(() => {
    const m = new Map<string, UserFontMeta[]>();
    for (const f of userFonts) m.set(f.family, [...(m.get(f.family) ?? []), f]);
    return [...m.entries()];
  }, [userFonts]);
  const add = async (files: File[]) => {
    setBusy(true);
    try {
      await addFontsFromFiles(files);
    } finally {
      setBusy(false);
    }
  };
  const pick = async () => add(await pickFiles(FONT_ACCEPT, true));
  useEffect(() => {
    if (pickOnOpen && !picked.current) {
      picked.current = true;
      void pick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickOnOpen]);
  return (
    <Dialog title="글꼴 관리" onClose={onClose} hideCancel onOk={onClose} okLabel="닫기">
      <div className="font-manager">
        <div
          className={`fm-drop ${drag ? 'is-drag' : ''}`}
          data-font-drop=""
          onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag(false);
            void add([...e.dataTransfer.files]);
          }}
        >
          <Upload size={22} />
          <span>
            인터넷에서 받은 글꼴 파일(.ttf, .otf, .ttc, .woff, .woff2)을 여기에 끌어다 놓거나
            <button type="button" className="btn btn-sm" data-font-pick="" disabled={busy} onClick={() => void pick()}>
              파일 선택
            </button>
          </span>
          <small>추가한 글꼴은 이 브라우저에 저장되어 오프라인에서도 쓸 수 있습니다. 글꼴마다 사용 조건(라이선스)이 다르니 배포 조건을 확인하세요.</small>
        </div>

        <section>
          <h4>내 글꼴 ({families.length})</h4>
          {!families.length && <p className="muted">추가한 글꼴이 없습니다.</p>}
          <label className="fm-preview-input">
            미리 보기 문장
            <input value={preview} onChange={(e) => setPreview(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <ul className="fm-list" data-font-list="">
            {families.map(([fam, styles]) => (
              <li key={fam} data-family={fam}>
                <div className="fm-head">
                  {renaming?.from === fam ? (
                    <>
                      <input autoFocus value={renaming.to} onChange={(e) => setRenaming({ from: fam, to: e.target.value })} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && void renameFamily(fam, renaming.to).then(() => setRenaming(null)))} aria-label="글꼴 이름" />
                      <button type="button" className="icon-btn" title="이름 저장" onClick={() => void renameFamily(fam, renaming.to).then(() => setRenaming(null))}>
                        <Check size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <b>{fam}</b>
                      {styles[0].origin === 'web' && <span className="chip chip-sm" data-kept="">웹 글꼴 보관 · {styles[0].license}</span>}
                      {styles[0].origin === 'pptx' && <span className="chip chip-sm">PPTX 포함 글꼴</span>}
                      {styles[0].aliases.length > 0 && <span className="muted"> · {styles[0].aliases.join(', ')}</span>}
                      <button type="button" className="icon-btn" title="이름 바꾸기" onClick={() => setRenaming({ from: fam, to: fam })}>
                        <Pencil size={13} />
                      </button>
                    </>
                  )}
                  <span className="sb-spacer" />
                  <button type="button" className="icon-btn" title="글꼴 삭제" data-font-delete={fam} onClick={() => void removeFonts(styles.map((s) => s.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="fm-sample" style={{ fontFamily: cssFontStack(fam) }}>
                  {preview}
                </div>
                <div className="fm-styles">
                  {styles.map((s) => (
                    <span key={s.id} className="chip" title={`${s.fileName} · ${kb(s.size)}${s.embedding === 'restricted' ? ' · 포함 제한 글꼴' : ''}`} style={{ fontFamily: cssFontStack(fam), fontWeight: s.weight, fontStyle: s.italic ? 'italic' : 'normal' }}>
                      {s.weightRange ? `가변 ${s.weightRange[0]}–${s.weightRange[1]}${s.italic ? ' Italic' : ''}` : styleName(s)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h4>무료 웹 글꼴</h4>
          <label className="fm-check">
            <input type="checkbox" checked={webFonts} onChange={(e) => setWebFontsEnabled(e.target.checked)} data-webfonts="" /> Google Fonts의 무료 글꼴 60여 종 사용 (본고딕·나눔·고운·배민 글꼴 등)
          </label>
          <p className="muted" data-websource={webSource ?? ''}>
            {webSource === 'self'
              ? '글꼴 파일은 이 사이트에서 받습니다(외부 글꼴 서버에 요청하지 않음). 한 번 받은 글자 조각은 오프라인에서도 쓸 수 있습니다.'
              : '글꼴을 쓸 때 Google Fonts(fonts.googleapis.com)에서 내려받습니다. 한 번 받은 글자 조각은 오프라인에서도 쓸 수 있습니다.'}
          </p>
          <OfflineKeep />
        </section>

        <section>
          <h4>이 컴퓨터의 글꼴</h4>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              try {
                const n = (await queryLocalFonts()).length;
                useEditor.getState().toast(`이 컴퓨터의 글꼴 ${n}개를 글꼴 목록에 추가했습니다.`, 'success');
              } catch (e) {
                useEditor.getState().toast((e as Error).message, 'warning');
              }
            }}
          >
            설치된 글꼴 목록 불러오기
          </button>
          <span className="muted"> {local.length ? `${local.length}개 불러옴` : 'Chrome·Edge에서 권한을 허락하면 설치된 모든 글꼴을 목록에 표시합니다.'}</span>
        </section>
      </div>
    </Dialog>
  );
}

/** 웹 글꼴 오프라인 보관: 전체 글꼴 파일(TTF)을 내 글꼴에 저장 → 인터넷 없이 사용 + PPTX에 포함 가능 */
function OfflineKeep() {
  const userFonts = useFonts((s) => s.userFonts);
  const kept = useMemo(() => new Set(userFonts.filter((f) => f.origin === 'web').map((f) => f.family)), [userFonts]);
  const [family, setFamily] = useState(WEB_FONTS[0].family);
  const [size, setSize] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void offlineSize(family).then((n) => alive && setSize(n));
    return () => {
      alive = false;
    };
  }, [family]);
  const keep = async () => {
    setProgress({ done: 0, total: size });
    try {
      const recs = await keepWebFontOffline(family, (done, total) => setProgress({ done, total }));
      useEditor.getState().toast(`${family}을(를) 내 글꼴에 보관했습니다 (${recs.length}개 파일). 이제 인터넷 없이 쓰고 PPTX에 포함할 수 있습니다.`, 'success');
    } catch (e) {
      useEditor.getState().toast((e as Error).message, 'error');
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="fm-keep" data-offline-keep="">
      <span>오프라인 보관</span>
      <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="보관할 웹 글꼴" disabled={!!progress}>
        {WEB_FONTS.map((f) => (
          <option key={f.family} value={f.family}>
            {f.label ?? f.family}
            {kept.has(f.family) ? ' ✓' : ''}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-sm" disabled={!!progress} onClick={() => void keep()} data-keep-btn="">
        {progress ? `받는 중 ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : `${kept.has(family) ? '다시 받기' : '받기'} (${kb(size)})`}
      </button>
      <small className="muted">전체 글꼴 파일을 google/fonts 저장소에서 받아 '내 글꼴'에 저장합니다. 인터넷 없이 모든 글자를 쓸 수 있고, PPTX 저장 시 파일에 포함됩니다.</small>
    </div>
  );
}

function ReplaceFontsDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const used = useMemo(() => [...fontsUsed(doc).entries()].sort((a, b) => b[1] - a[1]), [doc]);
  const [from, setFrom] = useState(used[0]?.[0] ?? '');
  const [to, setTo] = useState('');
  const apply = () => {
    if (!from || !to || from === to) return;
    let n = 0;
    useEditor.getState().commit(`글꼴 바꾸기: ${from} → ${to}`, (d) => void (n = replaceFontInDoc(d as Presentation, from, to)));
    useEditor.getState().toast(n ? `${from}을(를) ${to}(으)로 바꿨습니다 (${n}곳).` : '바꿀 곳이 없습니다 (테마 글꼴 토큰을 쓰는 글자는 테마 글꼴을 바꾸세요).', n ? 'success' : 'info');
  };
  return (
    <Dialog title="글꼴 바꾸기" onClose={onClose} hideCancel onOk={onClose} okLabel="닫기">
      <div className="replace-fonts">
        <p className="muted">프레젠테이션 전체(슬라이드·마스터·레이아웃·테마 글꼴)에서 한 글꼴을 다른 글꼴로 바꿉니다.</p>
        <table className="rf-table" data-font-used="">
          <thead>
            <tr>
              <th>사용 중인 글꼴</th>
              <th>글자 묶음</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {used.map(([f, n]) => {
              const st = fontStatus(f);
              const status = st.source === 'user' ? '내 글꼴' : st.source === 'web' ? '웹 글꼴' : st.available === false ? '없음 (대체 글꼴로 표시)' : st.available ? '설치됨' : '확인 불가';
              return (
                <tr key={f} className={from === f ? 'is-sel' : ''} onClick={() => setFrom(f)} data-font-row={f}>
                  <td style={{ fontFamily: cssFontStack(f) }}>{f}</td>
                  <td>{n || '—'}</td>
                  <td className={st.available === false ? 'rf-missing' : ''}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="rf-row">
          <label>
            바꿀 글꼴
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="바꿀 글꼴">
              {used.map(([f]) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <span>→</span>
          <label>
            새 글꼴
            <FontPicker value={to} onChange={setTo} lock={false} ariaLabel="새 글꼴" />
          </label>
          <button type="button" className="btn primary" data-font-replace="" disabled={!from || !to || from === to} onClick={apply}>
            바꾸기
          </button>
        </div>
      </div>
    </Dialog>
  );
}
