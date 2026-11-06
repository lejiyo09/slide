/** 슬라이드 쇼 탭, 녹화 탭, 쇼 설정 / 재구성한 쇼 대화 상자, 화면 녹화 */
import { useEffect, useState } from 'react';
import { Play, PlayCircle, EyeOff, Settings2, Timer, Video, Presentation as PresentationIcon, ListVideo, Trash2, Mic, MonitorPlay, Film, Volume2, Square } from 'lucide-react';
import { RibbonButton, DropdownButton, RibbonGroup, PlannedGroup, MenuItem, MenuSeparator, SplitButton } from '../common/Buttons';
import { Dialog } from '../dialogs/Dialog';
import { useEditor } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';
import * as S from '../../core/commands/showActions';
import { showSettingsOf } from '../../engines/show/showModel';
import { insertMediaFile, pickAndInsertMedia } from '../../editors/media/mediaActions';
import type { CustomShow, ShowSettings } from '../../types/model';
import { newId } from '../../utils/id';
import { plainText } from '../../core/document/factory';

/* ───────────── 슬라이드 쇼 ───────────── */

export function SlideShowTab() {
  const doc = useEditor((s) => s.doc);
  const settings = showSettingsOf(doc);
  const [dialog, setDialog] = useState<null | 'settings' | 'custom'>(null);
  const shows = doc.customShows ?? [];
  return (
    <>
      <RibbonGroup label="슬라이드 쇼 시작">
        <RibbonButton size="large" icon={<Play size={26} />} label="처음부터" title="처음부터 슬라이드 쇼" shortcut="F5" onClick={() => S.startShow()} />
        <RibbonButton size="large" icon={<PlayCircle size={26} />} label="현재 슬라이드부터" title="현재 슬라이드부터" shortcut="Shift+F5" onClick={() => S.startShow({ fromCurrent: true })} />
        <RibbonButton size="large" icon={<PresentationIcon size={26} />} label="발표자 보기" title="발표자 보기로 시작 (현재/다음 슬라이드, 노트, 타이머)" shortcut="Alt+F5" onClick={() => S.startShow({ fromCurrent: true, presenter: true })} />
        <DropdownButton size="large" icon={<ListVideo size={26} />} label="슬라이드 쇼 재구성" title="재구성한 쇼 시작 또는 편집">
          {(close) => (
            <div className="menu">
              {shows.map((c) => (
                <MenuItem key={c.id} label={c.name} onClick={() => (close(), S.startShow({ customShowId: c.id }))} />
              ))}
              {shows.length > 0 && <MenuSeparator />}
              <MenuItem label="쇼 재구성..." onClick={() => (close(), setDialog('custom'))} />
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="설정">
        <RibbonButton size="large" icon={<Settings2 size={26} />} label="슬라이드 쇼 설정" title="쇼 형식, 표시할 슬라이드, 화면 전환, 펜/레이저 색" onClick={() => setDialog('settings')} />
        <RibbonButton size="large" icon={<EyeOff size={26} />} label="슬라이드 숨기기" title="선택한 슬라이드를 쇼에서 숨기기" onClick={A.toggleHideSlides} />
        <RibbonButton size="large" icon={<Timer size={26} />} label="예행 연습" title="슬라이드마다 걸리는 시간을 기록" onClick={() => S.startShow({ mode: 'rehearse' })} />
        <RecordDropdown />
        <div className="rb-col rb-col-tight">
          <label className="rb-check">
            <input type="checkbox" checked={!settings.noNarration} onChange={(e) => S.updateShowSettings({ noNarration: !e.target.checked })} /> 내레이션 재생
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={settings.useTimings} onChange={(e) => S.updateShowSettings({ useTimings: e.target.checked })} /> 시간 사용
          </label>
        </div>
      </RibbonGroup>
      <RibbonGroup label="모니터">
        <div className="rb-col rb-col-tight">
          <label className="rb-check" title="Alt+F5 또는 '발표자 보기'로 시작하면 발표자 보기를 표시하고, 청중 화면은 별도 창(보조 모니터)에 표시합니다">
            <input type="checkbox" checked={settings.presenterView} onChange={(e) => S.updateShowSettings({ presenterView: e.target.checked })} /> 발표자 보기 사용
          </label>
        </div>
      </RibbonGroup>
      {dialog === 'settings' && <ShowSettingsDialog onClose={() => setDialog(null)} onCustom={() => setDialog('custom')} />}
      {dialog === 'custom' && <CustomShowsDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function RecordDropdown() {
  return (
    <SplitButton size="large" icon={<Video size={26} />} label="녹화" title="현재 슬라이드부터 녹화 (내레이션 + 시간)" onClick={() => S.startShow({ fromCurrent: true, mode: 'record' })}>
      {(close) => (
        <div className="menu">
          <MenuItem label="현재 슬라이드부터 녹화..." onClick={() => (close(), S.startShow({ fromCurrent: true, mode: 'record' }))} />
          <MenuItem label="처음부터 녹화..." onClick={() => (close(), S.startShow({ mode: 'record' }))} />
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={14} />} label="현재 슬라이드의 시간 지우기" onClick={() => (close(), S.clearRecording('current', 'timings'))} />
          <MenuItem icon={<Trash2 size={14} />} label="모든 슬라이드의 시간 지우기" onClick={() => (close(), S.clearRecording('all', 'timings'))} />
          <MenuItem icon={<Trash2 size={14} />} label="현재 슬라이드의 내레이션 지우기" onClick={() => (close(), S.clearRecording('current', 'narration'))} />
          <MenuItem icon={<Trash2 size={14} />} label="모든 슬라이드의 내레이션 지우기" onClick={() => (close(), S.clearRecording('all', 'narration'))} />
        </div>
      )}
    </SplitButton>
  );
}

/* ───────────── 녹화 ───────────── */

export function RecordTab() {
  const [rec, setRec] = useState<ScreenRecording | null>(null);
  return (
    <>
      <RibbonGroup label="녹화">
        <RibbonButton size="large" icon={<Mic size={26} />} label="현재 슬라이드부터" title="현재 슬라이드부터 녹화: 내레이션과 슬라이드 시간" onClick={() => S.startShow({ fromCurrent: true, mode: 'record' })} />
        <RibbonButton size="large" icon={<Play size={26} />} label="처음부터" title="처음부터 녹화: 내레이션과 슬라이드 시간" onClick={() => S.startShow({ mode: 'record' })} />
        <DropdownButton size="large" icon={<Trash2 size={26} />} label="녹화 지우기" title="녹화한 시간 또는 내레이션 지우기">
          {(close) => (
            <div className="menu">
              <MenuItem label="현재 슬라이드의 시간 지우기" onClick={() => (close(), S.clearRecording('current', 'timings'))} />
              <MenuItem label="모든 슬라이드의 시간 지우기" onClick={() => (close(), S.clearRecording('all', 'timings'))} />
              <MenuItem label="현재 슬라이드의 내레이션 지우기" onClick={() => (close(), S.clearRecording('current', 'narration'))} />
              <MenuItem label="모든 슬라이드의 내레이션 지우기" onClick={() => (close(), S.clearRecording('all', 'narration'))} />
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="자동 재생 미디어">
        <RibbonButton
          size="large"
          icon={rec ? <Square size={24} /> : <MonitorPlay size={26} />}
          label={rec ? '화면 녹화 중지' : '화면 녹화'}
          title="화면(창/탭)을 녹화해 현재 슬라이드에 비디오로 삽입"
          active={!!rec}
          onClick={async () => {
            if (rec) return rec.stop();
            const r = await startScreenRecording(() => setRec(null));
            setRec(r);
          }}
        />
        <RibbonButton size="large" icon={<Volume2 size={26} />} label="오디오" title="오디오 파일 삽입" onClick={() => void pickAndInsertMedia('audio')} />
        <RibbonButton size="large" icon={<Film size={26} />} label="비디오" title="비디오 파일 삽입" onClick={() => void pickAndInsertMedia('video')} />
      </RibbonGroup>
      <PlannedGroup label="내보내기" stage="14단계" items={['비디오로 내보내기']} />
    </>
  );
}

interface ScreenRecording {
  stop: () => void;
}

/** 화면 녹화 (getDisplayMedia + MediaRecorder) → 끝나면 현재 슬라이드에 비디오 삽입 */
async function startScreenRecording(onEnd: () => void): Promise<ScreenRecording | null> {
  const st = useEditor.getState();
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    st.toast('이 브라우저는 화면 녹화를 지원하지 않습니다.', 'warning');
    return null;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    st.toast('화면 녹화를 취소했습니다.', 'info');
    return null;
  }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    onEnd();
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: 'video/webm' });
    await insertMediaFile(new File([blob], `화면 녹화 ${new Date().toLocaleString('ko-KR')}.webm`, { type: 'video/webm' }));
  };
  // 브라우저의 '공유 중지'로 끝낸 경우
  stream.getVideoTracks()[0]?.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop());
  rec.start(1000);
  st.toast('화면을 녹화하고 있습니다. 녹화 탭의 "화면 녹화 중지"를 누르면 현재 슬라이드에 삽입됩니다.', 'info');
  return { stop: () => rec.state !== 'inactive' && rec.stop() };
}

/* ───────────── 쇼 설정 대화 상자 ───────────── */

export function ShowSettingsDialog({ onClose, onCustom }: { onClose: () => void; onCustom: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [v, setV] = useState<ShowSettings>(() => showSettingsOf(doc));
  const n = doc.slides.length;
  const shows = doc.customShows ?? [];
  const set = (p: Partial<ShowSettings>) => setV((x) => ({ ...x, ...p }));
  const ok = () => {
    S.updateShowSettings(v);
    onClose();
  };
  const kiosk = v.showType === 'kiosk';
  return (
    <Dialog title="쇼 설정" onClose={onClose} onOk={ok}>
      <div className="show-settings">
        <fieldset>
          <legend>보기 형식</legend>
          {(
            [
              ['speaker', '발표자가 진행 (전체 화면)'],
              ['browsed', '웹 형식으로 진행 (창)'],
              ['kiosk', '대화형 자동 진행 (전체 화면)'],
            ] as const
          ).map(([k, l]) => (
            <label key={k}>
              <input type="radio" name="showType" checked={v.showType === k} onChange={() => set({ showType: k })} /> {l}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>보기 옵션</legend>
          <label>
            <input type="checkbox" checked={v.loop || kiosk} disabled={kiosk} onChange={(e) => set({ loop: e.target.checked })} /> &lt;Esc&gt; 키를 누를 때까지 계속 실행
          </label>
          <label>
            <input type="checkbox" checked={v.noNarration} onChange={(e) => set({ noNarration: e.target.checked })} /> 녹음된 설명 없이 보기
          </label>
          <label>
            <input type="checkbox" checked={v.noAnimation} onChange={(e) => set({ noAnimation: e.target.checked })} /> 애니메이션 없이 보기
          </label>
          <label className="ss-color">
            펜 색:
            <input type="color" value={v.penColor} onChange={(e) => set({ penColor: e.target.value.toUpperCase() })} />
          </label>
          <label className="ss-color">
            레이저 포인터 색:
            <input type="color" value={v.laserColor} onChange={(e) => set({ laserColor: e.target.value.toUpperCase() })} />
          </label>
        </fieldset>
        <fieldset>
          <legend>슬라이드 표시</legend>
          <label>
            <input type="radio" name="range" checked={v.range.kind === 'all'} onChange={() => set({ range: { kind: 'all' } })} /> 모두
          </label>
          <label>
            <input type="radio" name="range" checked={v.range.kind === 'range'} onChange={() => set({ range: { kind: 'range', from: 1, to: n } })} /> 시작
            <input
              type="number"
              className="ss-num"
              aria-label="시작 슬라이드"
              min={1}
              max={n}
              value={v.range.kind === 'range' ? v.range.from : 1}
              onChange={(e) => set({ range: { kind: 'range', from: clampInt(e.target.value, 1, n), to: v.range.kind === 'range' ? v.range.to : n } })}
            />
            끝
            <input
              type="number"
              className="ss-num"
              aria-label="끝 슬라이드"
              min={1}
              max={n}
              value={v.range.kind === 'range' ? v.range.to : n}
              onChange={(e) => set({ range: { kind: 'range', from: v.range.kind === 'range' ? v.range.from : 1, to: clampInt(e.target.value, 1, n) } })}
            />
          </label>
          <label>
            <input type="radio" name="range" disabled={!shows.length} checked={v.range.kind === 'custom'} onChange={() => shows[0] && set({ range: { kind: 'custom', showId: shows[0].id } })} /> 재구성한 쇼:
            <select aria-label="재구성한 쇼" disabled={v.range.kind !== 'custom'} value={v.range.kind === 'custom' ? v.range.showId : ''} onChange={(e) => set({ range: { kind: 'custom', showId: e.target.value } })}>
              {shows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={() => (onClose(), onCustom())}>
              쇼 재구성...
            </button>
          </label>
        </fieldset>
        <fieldset>
          <legend>화면 전환</legend>
          <label>
            <input type="radio" name="adv" checked={!v.useTimings} onChange={() => set({ useTimings: false })} /> 수동
          </label>
          <label>
            <input type="radio" name="adv" checked={v.useTimings} onChange={() => set({ useTimings: true })} /> 설정된 시간 사용
          </label>
        </fieldset>
        <fieldset>
          <legend>복수 모니터</legend>
          <label>
            <input type="checkbox" checked={v.presenterView} onChange={(e) => set({ presenterView: e.target.checked })} /> 발표자 보기 사용
          </label>
        </fieldset>
      </div>
    </Dialog>
  );
}

const clampInt = (s: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, parseInt(s, 10) || lo));

/* ───────────── 재구성한 쇼 ───────────── */

export function CustomShowsDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const shows = doc.customShows ?? [];
  const [editing, setEditing] = useState<CustomShow | null>(null);
  const [sel, setSel] = useState<string | null>(shows[0]?.id ?? null);
  useEffect(() => {
    if (!sel || !shows.some((c) => c.id === sel)) setSel(shows[0]?.id ?? null);
  }, [shows, sel]);
  if (editing)
    return (
      <CustomShowEditor
        initial={editing}
        onDone={(saved) => {
          setEditing(null);
          if (saved) setSel(saved);
        }}
      />
    );
  const cur = shows.find((c) => c.id === sel);
  return (
    <Dialog title="쇼 재구성" onClose={onClose} hideCancel onOk={onClose} okLabel="닫기">
      <div className="cs-dialog">
        <ul className="cs-list" role="listbox" aria-label="재구성한 쇼">
          {shows.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === sel} className={c.id === sel ? 'is-sel' : ''} onClick={() => setSel(c.id)} onDoubleClick={() => setEditing(c)}>
              {c.name} <span className="muted">({c.slideIds.length})</span>
            </li>
          ))}
          {!shows.length && <li className="muted">재구성한 쇼가 없습니다.</li>}
        </ul>
        <div className="cs-actions">
          <button type="button" className="btn" data-cs="new" onClick={() => setEditing({ id: newId(), name: `재구성한 쇼 ${shows.length + 1}`, slideIds: [] })}>
            새로 만들기...
          </button>
          <button type="button" className="btn" disabled={!cur} onClick={() => cur && setEditing(cur)}>
            편집...
          </button>
          <button type="button" className="btn" disabled={!cur} onClick={() => cur && S.saveCustomShow({ ...cur, id: newId(), name: `${cur.name} 복사본` })}>
            복사
          </button>
          <button type="button" className="btn" disabled={!cur} onClick={() => cur && S.deleteCustomShow(cur.id)}>
            제거
          </button>
          <button type="button" className="btn primary" disabled={!cur?.slideIds.length} onClick={() => cur && (onClose(), S.startShow({ customShowId: cur.id }))}>
            쇼 보기
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function CustomShowEditor({ initial, onDone }: { initial: CustomShow; onDone: (savedId?: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const [name, setName] = useState(initial.name);
  const [ids, setIds] = useState<string[]>(initial.slideIds);
  const [pick, setPick] = useState<string[]>([]);
  const [selRight, setSelRight] = useState<number | null>(null);
  const titleOf = (id: string) => {
    const i = doc.slides.findIndex((s) => s.id === id);
    const s = doc.slides[i];
    const t = s?.objects.find((o) => o.type === 'text' && (o.ph?.type === 'title' || o.ph?.type === 'ctrTitle'));
    const text = t && t.type === 'text' ? plainText(t.text).trim() : '';
    return `${i + 1}. ${text || `슬라이드 ${i + 1}`}`;
  };
  const move = (d: -1 | 1) => {
    if (selRight === null) return;
    const j = selRight + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[selRight], next[j]] = [next[j], next[selRight]];
    setIds(next);
    setSelRight(j);
  };
  return (
    <Dialog
      title="재구성한 쇼 정의"
      onClose={() => onDone()}
      onOk={() => {
        S.saveCustomShow({ id: initial.id, name: name.trim() || initial.name, slideIds: ids });
        onDone(initial.id);
      }}
    >
      <div className="cs-editor">
        <label className="cs-name">
          쇼 이름: <input value={name} onChange={(e) => setName(e.target.value)} aria-label="쇼 이름" />
        </label>
        <div className="cs-columns">
          <div>
            <div className="muted">프레젠테이션에 있는 슬라이드</div>
            <ul className="cs-list" aria-label="프레젠테이션에 있는 슬라이드">
              {doc.slides.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={pick.includes(s.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} /> {titleOf(s.id)}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="cs-mid">
            <button type="button" className="btn" data-cs="add" disabled={!pick.length} onClick={() => (setIds((x) => [...x, ...doc.slides.filter((s) => pick.includes(s.id)).map((s) => s.id)]), setPick([]))}>
              추가 »
            </button>
          </div>
          <div>
            <div className="muted">재구성한 쇼에 있는 슬라이드</div>
            <ul className="cs-list" aria-label="재구성한 쇼에 있는 슬라이드">
              {ids.map((id, i) => (
                <li key={`${id}-${i}`} className={i === selRight ? 'is-sel' : ''} onClick={() => setSelRight(i)}>
                  {titleOf(id)}
                </li>
              ))}
            </ul>
          </div>
          <div className="cs-mid">
            <button type="button" className="btn" title="위로" disabled={selRight === null || selRight === 0} onClick={() => move(-1)}>
              ↑
            </button>
            <button type="button" className="btn" title="제거" disabled={selRight === null} onClick={() => selRight !== null && (setIds((x) => x.filter((_, k) => k !== selRight)), setSelRight(null))}>
              ✕
            </button>
            <button type="button" className="btn" title="아래로" disabled={selRight === null || selRight === ids.length - 1} onClick={() => move(1)}>
              ↓
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
