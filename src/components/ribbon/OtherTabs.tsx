import {
  Image as ImageIcon, Type, Plus, FileImage, Monitor, Play, PlayCircle, EyeOff, LayoutGrid, Square, Grid3x3, Ruler, Magnet,
  NotebookPen, ZoomIn, ZoomOut, Maximize, Moon, Sun, Ratio, Palette, PaintBucket, History, Save, Shapes,
} from 'lucide-react';
import { RibbonButton, DropdownButton, RibbonGroup, PlannedGroup, MenuItem, MenuSeparator, SplitButton } from '../common/Buttons';
import { ColorPanel } from '../common/ColorPicker';
import { useEditor } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { LAYOUTS, SLIDE_SIZES } from '../../core/document/factory';
import { THEMES } from '../../themes/themes';
import { ShapeGalleryPanel } from './ShapeGallery';
import { LayoutThumb } from './LayoutThumb';
import { captureScreenshot } from '../../services/import/screenshot';
import { fileToAsset, pickFiles } from '../../services/storage/files';
import { saveVersion } from '../../services/storage/db';
import type { Fill, Theme } from '../../types/model';
import { fillToCss } from '../../engines/rendering/ObjectView';

/* ───────────── 삽입 ───────────── */

export function InsertTab() {
  const set = useEditor((s) => s.set);
  return (
    <>
      <RibbonGroup label="슬라이드">
        <DropdownButton size="large" icon={<Plus size={26} />} label="새 슬라이드" title="새 슬라이드">
          {(close) => (
            <div className="layout-gallery">
              <div className="lg-grid">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" className="lg-item" onClick={() => (A.newSlide(l.id), close())}>
                    <LayoutThumb layout={l.id} />
                    <span>{l.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <PlannedGroup label="표" stage="8단계" items={['표 삽입', '셀 병합', '테두리']} />
      <RibbonGroup label="이미지">
        <RibbonButton size="large" icon={<ImageIcon size={26} />} label="그림" title="이 디바이스의 그림 삽입 (PNG, JPG, GIF, WebP, SVG)" onClick={() => A.pickAndInsertImage()} />
        <RibbonButton size="large" icon={<FileImage size={26} />} label="SVG" title="SVG 파일 삽입" onClick={() => A.pickAndInsertImage(true)} />
        <RibbonButton
          size="large"
          icon={<Monitor size={26} />}
          label="스크린샷"
          title="화면/창을 캡처해 삽입 (브라우저 화면 공유 권한 필요)"
          onClick={async () => {
            try {
              const file = await captureScreenshot();
              if (file) await A.insertImageFiles([file]);
            } catch (e) {
              useEditor.getState().toast(`스크린샷을 찍지 못했습니다: ${(e as Error).message}`, 'warning');
            }
          }}
        />
      </RibbonGroup>
      <RibbonGroup label="일러스트레이션">
        <DropdownButton size="large" icon={<Shapes size={26} />} label="도형" title="도형 삽입" panelClass="wide">
          {(close) => (
            <ShapeGalleryPanel
              onPick={(k) => (set({ insertTool: { kind: 'shape', shape: k } }), close())}
              onLine={(arrow) => (set({ insertTool: { kind: 'line', arrow } }), close())}
            />
          )}
        </DropdownButton>
      </RibbonGroup>
      <PlannedGroup label="아이콘 · 3D · 차트" stage="8단계" items={['아이콘', '3D 모델(확장 인터페이스)', '차트']} />
      <PlannedGroup label="링크" stage="8단계" items={['하이퍼링크', '실행']} />
      <RibbonGroup label="텍스트">
        <RibbonButton size="large" icon={<Type size={26} />} label="텍스트 상자" title="텍스트 상자 그리기 (클릭 또는 드래그)" onClick={() => set({ insertTool: { kind: 'text' } })} />
      </RibbonGroup>
      <PlannedGroup label="기호 · 미디어" stage="8단계" items={['수식', '오디오', '비디오']} />
    </>
  );
}

/* ───────────── 디자인 ───────────── */

function ThemeSwatch({ theme, onClick, active }: { theme: Theme; onClick: () => void; active: boolean }) {
  return (
    <button type="button" className={`theme-swatch ${active ? 'is-active' : ''}`} title={`${theme.name} (${theme.fonts.heading})`} onClick={onClick}>
      <span className="ts-bg" style={fillToCss(theme.background, {})}>
        <span className="ts-title" style={{ color: theme.colors.dark1, fontFamily: theme.fonts.heading }}>
          가Aa
        </span>
        <span className="ts-bars">
          {[theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4].map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </span>
      </span>
      <span className="ts-name">{theme.name}</span>
    </button>
  );
}

const GRADIENT_PRESETS: Fill[] = [
  { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#D9E2F3' }] },
  { type: 'gradient', angle: 135, stops: [{ offset: 0, color: '#FDEBD3' }, { offset: 1, color: '#F4B183' }] },
  { type: 'gradient', angle: 45, stops: [{ offset: 0, color: '#1F3864' }, { offset: 1, color: '#2E75B6' }] },
  { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '#E2F0D9' }, { offset: 1, color: '#A9D18E' }] },
  { type: 'gradient', angle: 160, stops: [{ offset: 0, color: '#0B1020' }, { offset: 1, color: '#3B2F7A' }] },
  { type: 'gradient', angle: 0, stops: [{ offset: 0, color: '#FFF2CC' }, { offset: 1, color: '#FFFFFF' }] },
];

export function DesignTab({ onCustomSize }: { onCustomSize: () => void }) {
  const theme = useEditor((s) => s.doc.theme);
  const size = useEditor((s) => s.doc.size);
  const commit = useEditor((s) => s.commit);
  const selectedSlides = useEditor((s) => s.selectedSlideIds);
  const setBg = (fill: Fill | null, all = false) => commit('배경 서식', (d) => C.setBackground(d, all ? 'all' : selectedSlides, fill));
  return (
    <>
      <RibbonGroup label="테마" className="rg-themes">
        <div className="theme-row">
          {THEMES.map((t) => (
            <ThemeSwatch key={t.id} theme={t} active={t.id === theme.id} onClick={() => commit('테마 적용', (d) => C.applyTheme(d, structuredClone(t)))} />
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="배경">
        <SplitButton size="large" icon={<PaintBucket size={26} />} label="배경 색" title="선택한 슬라이드 배경 색" onClick={() => setBg({ type: 'solid', color: '#FFFFFF' })}>
          {(close) => (
            <div>
              <ColorPanel allowNone noneLabel="테마 배경으로 재설정" onPick={(c) => (setBg(c ? { type: 'solid', color: c } : null), close())} />
            </div>
          )}
        </SplitButton>
        <DropdownButton size="large" icon={<Palette size={26} />} label="그라데이션" title="그라데이션 배경">
          {(close) => (
            <div className="grad-grid">
              {GRADIENT_PRESETS.map((g, i) => (
                <button key={i} type="button" className="grad-item" style={fillToCss(g, {})} onClick={() => (setBg(g), close())} title="그라데이션 적용" />
              ))}
            </div>
          )}
        </DropdownButton>
        <div className="rb-col">
          <RibbonButton
            icon={<ImageIcon size={15} />}
            label="그림 배경"
            title="그림을 배경으로 사용"
            onClick={async () => {
              const [f] = await pickFiles('image/*');
              if (!f) return;
              const { asset } = await fileToAsset(f);
              commit('그림 배경', (d) => {
                d.assets[asset.id] = asset;
                C.setBackground(d, selectedSlides, { type: 'image', assetId: asset.id });
              });
            }}
          />
          <RibbonButton
            icon={<Square size={15} />}
            label="모두 적용"
            title="현재 슬라이드 배경을 모든 슬라이드에 적용"
            onClick={() => {
              const s = useEditor.getState();
              const cur = s.doc.slides.find((x) => x.id === s.activeSlideId)?.background?.fill ?? null;
              setBg(cur ? structuredClone(cur) : null, true);
            }}
          />
          <RibbonButton icon={<History size={15} />} label="배경 재설정" title="테마 기본 배경으로" onClick={() => setBg(null)} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="사용자 지정">
        <DropdownButton size="large" icon={<Ratio size={26} />} label="슬라이드 크기" title="슬라이드 크기">
          {(close) => (
            <div className="menu">
              <MenuItem label="표준 (4:3)" checked={size.preset === '4:3'} onClick={() => (commit('슬라이드 크기', (d) => C.setSlideSize(d, { ...SLIDE_SIZES['4:3'] })), close())} />
              <MenuItem label="와이드스크린 (16:9)" checked={size.preset === '16:9'} onClick={() => (commit('슬라이드 크기', (d) => C.setSlideSize(d, { ...SLIDE_SIZES['16:9'] })), close())} />
              <MenuSeparator />
              <MenuItem label="사용자 지정 슬라이드 크기…" checked={size.preset === 'custom'} onClick={() => (onCustomSize(), close())} />
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <PlannedGroup label="마스터 · 템플릿" stage="9단계" items={['슬라이드 마스터', '디자인 템플릿', '배경 패턴', '사용자 지정 테마']} />
    </>
  );
}

/* ───────────── 전환 / 애니메이션 / 녹화 ───────────── */

export function TransitionsTab() {
  return (
    <>
      <PlannedGroup label="미리 보기" stage="10단계" items={['전환 미리 보기']} />
      <PlannedGroup label="이 슬라이드로 전환" stage="10단계" items={['없음', '페이드', '밀어내기', '닦아내기', '분할', '모양', '확대/축소', '회전']} />
      <PlannedGroup label="타이밍" stage="10단계" items={['기간', '방향', '모두 적용']} />
    </>
  );
}

export function AnimationsTab() {
  return (
    <>
      <PlannedGroup label="애니메이션" stage="10단계" items={['나타내기', '강조', '끝내기', '이동 경로']} />
      <PlannedGroup label="고급 애니메이션" stage="10단계" items={['애니메이션 창', '트리거', '애니메이션 복사']} />
      <PlannedGroup label="타이밍" stage="10단계" items={['시작', '재생 시간', '지연', '반복', '순서 바꾸기']} />
    </>
  );
}

export function RecordTab() {
  return <PlannedGroup label="녹화" stage="11단계" items={['현재 슬라이드부터 녹화', '처음부터 녹화', '내레이션', '비디오로 내보내기']} />;
}

/* ───────────── 슬라이드 쇼 ───────────── */

export function SlideShowTab() {
  const s = useEditor;
  const start = (fromCurrent: boolean) => {
    const st = s.getState();
    const idx = fromCurrent ? st.doc.slides.findIndex((x) => x.id === st.activeSlideId) : 0;
    st.set({ slideshow: { startIndex: Math.max(0, idx) } });
  };
  return (
    <>
      <RibbonGroup label="슬라이드 쇼 시작">
        <RibbonButton size="large" icon={<Play size={26} />} label="처음부터" title="처음부터 슬라이드 쇼" shortcut="F5" onClick={() => start(false)} />
        <RibbonButton size="large" icon={<PlayCircle size={26} />} label="현재 슬라이드부터" title="현재 슬라이드부터" shortcut="Shift+F5" onClick={() => start(true)} />
      </RibbonGroup>
      <RibbonGroup label="설정">
        <RibbonButton size="large" icon={<EyeOff size={26} />} label="슬라이드 숨기기" title="선택한 슬라이드를 쇼에서 숨기기" onClick={A.toggleHideSlides} />
      </RibbonGroup>
      <PlannedGroup label="발표자 도구" stage="11단계" items={['발표자 보기', '타이머', '레이저 포인터', '펜', '화면 확대']} />
    </>
  );
}

/* ───────────── 검토 ───────────── */

export function ReviewTab() {
  return (
    <>
      <RibbonGroup label="버전">
        <RibbonButton
          size="large"
          icon={<Save size={26} />}
          label="버전 저장"
          title="현재 상태를 버전 기록에 저장 (파일 > 버전 기록에서 복원)"
          onClick={async () => {
            const st = useEditor.getState();
            const label = prompt('버전 이름', new Date().toLocaleString('ko-KR'));
            if (label === null) return;
            await saveVersion(st.doc, label || new Date().toLocaleString('ko-KR'));
            st.toast('버전을 저장했습니다.', 'success');
          }}
        />
      </RibbonGroup>
      <PlannedGroup label="언어 교정 · 메모 · 비교" stage="13단계" items={['맞춤법 검사', '메모', '비교']} />
    </>
  );
}

/* ───────────── 보기 ───────────── */

export function ViewTab() {
  const s = useEditor();
  const toggle = (key: 'showGrid' | 'showGuides' | 'snapEnabled' | 'showNotes' | 'darkMode') => {
    const v = !s[key];
    s.set({ [key]: v });
    if (key === 'darkMode' || key === 'showNotes') {
      try {
        localStorage.setItem(`slidelab.${key}`, v ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  };
  return (
    <>
      <RibbonGroup label="프레젠테이션 보기">
        <RibbonButton size="large" icon={<Square size={26} />} label="기본" title="기본 보기" active={s.viewMode === 'normal'} onClick={() => s.set({ viewMode: 'normal' })} />
        <RibbonButton size="large" icon={<LayoutGrid size={26} />} label="여러 슬라이드" title="여러 슬라이드 보기" active={s.viewMode === 'sorter'} onClick={() => s.set({ viewMode: 'sorter' })} />
      </RibbonGroup>
      <RibbonGroup label="표시">
        <div className="rb-col">
          <RibbonButton icon={<Grid3x3 size={15} />} label="눈금선" title="눈금선 표시" active={s.showGrid} onClick={() => toggle('showGrid')} />
          <RibbonButton icon={<Ruler size={15} />} label="안내선" title="스마트 안내선 표시" active={s.showGuides} onClick={() => toggle('showGuides')} />
          <RibbonButton icon={<Magnet size={15} />} label="개체 맞춤" title="개체/눈금에 맞춤 (드래그 중 Alt로 일시 해제)" active={s.snapEnabled} onClick={() => toggle('snapEnabled')} />
        </div>
        <RibbonButton size="large" icon={<NotebookPen size={26} />} label="노트" title="슬라이드 노트 창 표시" active={s.showNotes} onClick={() => toggle('showNotes')} />
      </RibbonGroup>
      <RibbonGroup label="확대/축소">
        <RibbonButton size="large" icon={<ZoomIn size={26} />} label="확대" title="확대" shortcut="Ctrl++" onClick={() => A.zoomBy(1)} />
        <RibbonButton size="large" icon={<ZoomOut size={26} />} label="축소" title="축소" shortcut="Ctrl+-" onClick={() => A.zoomBy(-1)} />
        <RibbonButton size="large" icon={<Maximize size={26} />} label="창에 맞춤" title="창 크기에 맞춤" active={s.fitMode} onClick={() => s.set({ fitMode: true })} />
      </RibbonGroup>
      <RibbonGroup label="테마">
        <RibbonButton size="large" icon={s.darkMode ? <Sun size={26} /> : <Moon size={26} />} label={s.darkMode ? '밝은 모드' : '다크 모드'} title="편집기 색상 모드 전환" onClick={() => toggle('darkMode')} />
      </RibbonGroup>
      <PlannedGroup label="마스터 보기" stage="9단계" items={['슬라이드 마스터', '유인물 마스터', '노트 마스터']} />
    </>
  );
}
