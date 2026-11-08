import {
  Image as ImageIcon, Type, Plus, FileImage, Monitor, LayoutGrid, Square, Grid3x3, Ruler, Magnet,
  NotebookPen, ZoomIn, ZoomOut, Maximize, Moon, Sun, Ratio, Palette, PaintBucket, History, Save, Shapes,
  Table2, BarChart3, Smile, Link2, Film, Volume2, LayoutTemplate, Type as TypeIcon, Settings2, PanelsTopLeft, Sparkles,
  Sigma, SpellCheck, GitCompare, MessageSquarePlus, MessagesSquare, ChevronLeft, ChevronRight, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { goToComment, startNewComment } from '../comments/CommentsPane';
import { openSpellPane } from '../spell/SpellPane';
import { startCompare } from '../compare/ComparePane';
import { listExtensions } from '../../extensions/registry';
import { insertExtension } from '../../extensions/actions';
import { deleteAllComments } from '../../core/comments/comments';
import { useMemo, useState } from 'react';
import * as M from '../../core/commands/masterActions';
import { TEMPLATES, type DesignTemplate } from '../../themes/templates';
import { COLOR_SCHEMES, FONT_SCHEMES } from '../../themes/schemes';
import { PATTERNS } from '../../engines/rendering/patterns';
import { ThemeDialog } from '../dialogs/ThemeDialog';
import { useDesignLibrary } from '../../hooks/useDesignLibrary';
import { deleteCustomTheme, deleteUserTemplate, saveUserTemplate } from '../../services/storage/designLibrary';
import { newId } from '../../utils/id';
import { createPresentation } from '../../core/document/factory';
import { ScaledSlide } from '../../engines/rendering/SlideView';
import { TableGridPicker, ChartTypeMenu, LinkDialog, IconPickerDialog } from './InsertExtras';
import { pickAndInsertMedia } from '../../editors/media/mediaActions';
import { lockSelection } from '../../editors/text/editorSession';
import { RibbonButton, DropdownButton, RibbonGroup, MenuItem, MenuSeparator, SplitButton } from '../common/Buttons';
import { ColorPanel } from '../common/ColorPicker';
import { useEditor } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { SLIDE_SIZES } from '../../core/document/factory';
import { THEMES } from '../../themes/themes';
import { ShapeGalleryPanel } from './ShapeGallery';
import { LayoutGallery } from './LayoutGallery';
import { captureScreenshot } from '../../services/import/screenshot';
import { fileToAsset, pickFiles } from '../../services/storage/files';
import { saveVersion } from '../../services/storage/db';
import type { Fill, Theme } from '../../types/model';
import { fillToCss } from '../../engines/rendering/ObjectView';

/* ───────────── 삽입 ───────────── */

export function InsertTab() {
  const set = useEditor((s) => s.set);
  const [dialog, setDialog] = useState<null | 'link' | 'icon'>(null);
  return (
    <>
      <RibbonGroup label="슬라이드">
        <DropdownButton size="large" icon={<Plus size={26} />} label="새 슬라이드" title="새 슬라이드">
          {(close) => (
            <div className="layout-gallery-wrap">
              <LayoutGallery close={close} />
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="표">
        <DropdownButton size="large" icon={<Table2 size={26} />} label="표" title="표 삽입">
          {(close) => <TableGridPicker close={close} />}
        </DropdownButton>
      </RibbonGroup>
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
      <RibbonGroup label="일러스트레이션 ">
        <RibbonButton size="large" icon={<Smile size={26} />} label="아이콘" title="아이콘 삽입 (Lucide 아이콘)" onClick={() => setDialog('icon')} />
        <DropdownButton size="large" icon={<BarChart3 size={26} />} label="차트" title="차트 삽입">
          {(close) => <ChartTypeMenu close={close} />}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="링크">
        <RibbonButton size="large" icon={<Link2 size={26} />} label="링크" title="하이퍼링크 (Ctrl+K)" onClick={() => (lockSelection(), setDialog('link'))} />
      </RibbonGroup>
      <RibbonGroup label="텍스트">
        <RibbonButton size="large" icon={<Type size={26} />} label="텍스트 상자" title="텍스트 상자 그리기 (클릭 또는 드래그)" onClick={() => set({ insertTool: { kind: 'text' } })} />
      </RibbonGroup>
      <RibbonGroup label="기호">
        <RibbonButton size="large" icon={<Sigma size={26} />} label="수식" title="수식 삽입 (LaTeX 입력, PowerPoint 수식으로 저장)" onClick={() => set({ equationEditorId: 'new' })} />
      </RibbonGroup>
      <RibbonGroup label="3D">
        {listExtensions()
          .filter((x) => x.ribbon)
          .map((x) => {
            const Icon = x.ribbon!.icon;
            return <RibbonButton key={x.kind} size="large" icon={<Icon size={26} />} label={x.ribbon!.label} title={x.ribbon!.title} onClick={() => void insertExtension(x.kind)} />;
          })}
      </RibbonGroup>
      <RibbonGroup label="미디어">
        <RibbonButton size="large" icon={<Film size={26} />} label="비디오" title="이 디바이스의 비디오 삽입 (MP4, WebM)" onClick={() => void pickAndInsertMedia('video')} />
        <RibbonButton size="large" icon={<Volume2 size={26} />} label="오디오" title="이 디바이스의 오디오 삽입 (MP3, M4A, WAV)" onClick={() => void pickAndInsertMedia('audio')} />
      </RibbonGroup>
      {dialog === 'link' && <LinkDialog onClose={() => setDialog(null)} />}
      {dialog === 'icon' && <IconPickerDialog onClose={() => setDialog(null)} />}
    </>
  );
}

/* ───────────── 디자인 ───────────── */

function ThemeSwatch({ theme, onClick, active, onDelete }: { theme: Theme; onClick: () => void; active: boolean; onDelete?: () => void }) {
  return (
    <span className="theme-swatch-wrap">
      <button type="button" className={`theme-swatch ${active ? 'is-active' : ''}`} title={`${theme.name} (${theme.fonts.heading} / ${theme.fonts.body})`} onClick={onClick} data-theme-id={theme.id}>
        <span className="ts-bg" style={fillToCss(theme.background, {}, theme)}>
          <span className="ts-title" style={{ color: theme.colors.dark1, fontFamily: theme.fonts.heading }}>
            가Aa
          </span>
          <span className="ts-bars">
            {[theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4].map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </span>
        </span>
        <span className="ts-name">{theme.name}</span>
      </button>
      {onDelete && (
        <button type="button" className="ts-delete" title="사용자 지정 테마 삭제" onClick={onDelete}>
          ×
        </button>
      )}
    </span>
  );
}

const GRADIENT_PRESETS: Fill[] = [
  { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '@light1' }, { offset: 1, color: '@accent1^0.8' }] },
  { type: 'gradient', angle: 135, stops: [{ offset: 0, color: '@accent2^0.85' }, { offset: 1, color: '@accent2^0.5' }] },
  { type: 'gradient', angle: 45, stops: [{ offset: 0, color: '@accent1~0.5' }, { offset: 1, color: '@accent1' }] },
  { type: 'gradient', angle: 90, stops: [{ offset: 0, color: '@accent6^0.85' }, { offset: 1, color: '@accent6^0.5' }] },
  { type: 'gradient', angle: 160, stops: [{ offset: 0, color: '@dark2' }, { offset: 1, color: '@accent5~0.5' }] },
  { type: 'gradient', angle: 0, stops: [{ offset: 0, color: '@accent4^0.8' }, { offset: 1, color: '@light1' }] },
];

export function DesignTab({ onCustomSize }: { onCustomSize: () => void }) {
  const theme = useEditor((s) => s.doc.theme);
  const size = useEditor((s) => s.doc.size);
  const commit = useEditor((s) => s.commit);
  const selectedSlides = useEditor((s) => s.selectedSlideIds);
  const masterView = useEditor((s) => s.masterView);
  const activeId = useEditor((s) => s.activeSlideId);
  const lib = useDesignLibrary();
  const [themeDialog, setThemeDialog] = useState(false);
  // 마스터 보기에서는 현재 마스터/레이아웃의 배경을 바꿈
  const bgTargets = masterView ? [activeId] : selectedSlides;
  const setBg = (fill: Fill | null, all = false) => commit('배경 서식', (d) => C.setBackground(d, all ? 'all' : bgTargets, fill));
  return (
    <>
      <RibbonGroup label="테마" className="rg-themes">
        <div className="theme-row">
          {THEMES.map((t) => (
            <ThemeSwatch key={t.id} theme={t} active={t.id === theme.id} onClick={() => M.applyFullTheme(t)} />
          ))}
          {lib.themes.map((t) => (
            <ThemeSwatch key={t.id} theme={t} active={t.id === theme.id} onClick={() => M.applyFullTheme(t)} onDelete={() => confirm(`'${t.name}' 테마를 삭제할까요?`) && void deleteCustomTheme(t.id)} />
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="적용">
        <DropdownButton size="large" icon={<LayoutTemplate size={26} />} label="템플릿" title="디자인 템플릿 (테마 + 마스터 디자인)" panelClass="wide">
          {(close) => (
            <div className="template-menu">
              <div className="sg-title">기본 제공 템플릿</div>
              <div className="tpl-grid">
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" className="tpl-item" title={t.name} data-template={t.id} onClick={() => (M.applyTemplate(t), close())}>
                    <TemplateThumb template={t} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
              {lib.templates.length > 0 && <div className="sg-title">내 템플릿</div>}
              {lib.templates.map((t) => (
                <div key={t.id} className="tpl-user">
                  <button type="button" className="menu-item" onClick={() => (M.applyDesignSnapshot(t.design, t.name), close())}>
                    <span className="menu-label">{t.name}</span>
                    <span className="menu-shortcut">{new Date(t.savedAt).toLocaleDateString('ko-KR')}</span>
                  </button>
                  <button type="button" className="icon-btn" title="삭제" onClick={() => confirm(`'${t.name}' 템플릿을 삭제할까요?`) && void deleteUserTemplate(t.id)}>
                    ×
                  </button>
                </div>
              ))}
              <MenuSeparator />
              <MenuItem
                label="현재 디자인을 템플릿으로 저장…"
                onClick={async () => {
                  const name = prompt('템플릿 이름', `${theme.name} 템플릿`);
                  if (!name) return;
                  await saveUserTemplate({ id: newId(), name, savedAt: Date.now(), design: M.snapshotDesign(useEditor.getState().doc) });
                  useEditor.getState().toast(`'${name}' 템플릿을 저장했습니다. 파일 › 새로 만들기에서도 쓸 수 있습니다.`, 'success');
                  close();
                }}
              />
            </div>
          )}
        </DropdownButton>
      </RibbonGroup>
      <RibbonGroup label="적용">
        <div className="rb-col">
          <DropdownButton icon={<Palette size={15} />} label="색" title="색 조합 (테마 색만 바꿈)">
            {(close) => (
              <div className="menu scheme-menu">
                {COLOR_SCHEMES.map((cs) => (
                  <button key={cs.id} type="button" className="menu-item scheme-item" data-scheme={cs.id} onClick={() => (M.applyThemeColors(cs.colors, cs.name), close())}>
                    <span className="scheme-swatches">
                      {(['dark1', 'light1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => (
                        <span key={k} style={{ background: cs.colors[k] }} />
                      ))}
                    </span>
                    <span className="menu-label">{cs.name}</span>
                  </button>
                ))}
                <MenuSeparator />
                <MenuItem label="색 사용자 지정…" onClick={() => (setThemeDialog(true), close())} />
              </div>
            )}
          </DropdownButton>
          <DropdownButton icon={<TypeIcon size={15} />} label="글꼴" title="글꼴 조합 (제목/본문 테마 글꼴)">
            {(close) => (
              <div className="menu">
                {FONT_SCHEMES.map((f) => (
                  <button key={f.id} type="button" className={`menu-item font-scheme ${theme.fonts.heading === f.heading && theme.fonts.body === f.body ? 'is-checked' : ''}`} onClick={() => (M.applyThemeFonts(f.heading, f.body), close())}>
                    <span className="fs-sample">
                      <span style={{ fontFamily: f.heading, fontWeight: 700 }}>{f.heading}</span>
                      <span style={{ fontFamily: f.body }}>{f.body}</span>
                    </span>
                  </button>
                ))}
                <MenuSeparator />
                <MenuItem label="글꼴 사용자 지정…" onClick={() => (setThemeDialog(true), close())} />
              </div>
            )}
          </DropdownButton>
          <RibbonButton icon={<Settings2 size={15} />} label="테마 사용자 지정" title="테마 색·글꼴 편집 및 저장" onClick={() => setThemeDialog(true)} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="배경">
        <SplitButton size="large" icon={<PaintBucket size={26} />} label="배경 색" title={masterView ? '현재 마스터/레이아웃 배경 색' : '선택한 슬라이드 배경 색'} onClick={() => setBg({ type: 'solid', color: '@light1' })}>
          {(close) => (
            <div>
              <ColorPanel allowNone noneLabel="배경 재설정" onPick={(c) => (setBg(c ? { type: 'solid', color: c } : null), close())} />
            </div>
          )}
        </SplitButton>
        <DropdownButton size="large" icon={<Palette size={26} />} label="그라데이션" title="그라데이션 배경 (테마 색)">
          {(close) => (
            <div className="grad-grid">
              {GRADIENT_PRESETS.map((g, i) => (
                <button key={i} type="button" className="grad-item" style={fillToCss(g, {}, theme)} onClick={() => (setBg(g), close())} title="그라데이션 적용" />
              ))}
            </div>
          )}
        </DropdownButton>
        <DropdownButton size="large" icon={<Grid3x3 size={26} />} label="무늬" title="무늬 배경">
          {(close) => (
            <div className="grad-grid pattern-grid">
              {PATTERNS.map((p) => {
                const f: Fill = { type: 'pattern', preset: p.id, fg: '@accent1^0.55', bg: '@light1' };
                return <button key={p.id} type="button" className="grad-item" data-pattern={p.id} style={fillToCss(f, {}, theme)} onClick={() => (setBg(f), close())} title={p.name} />;
              })}
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
                C.setBackground(d, bgTargets, { type: 'image', assetId: asset.id });
              });
            }}
          />
          {!masterView && (
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
          )}
          <RibbonButton icon={<History size={15} />} label="배경 재설정" title="상위(레이아웃/마스터/테마) 배경으로" onClick={() => setBg(null)} />
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
        <RibbonButton size="large" icon={<Sparkles size={26} />} label="디자인 아이디어" title="AI 도우미의 디자인 추천: 내용에 맞는 템플릿·색·글꼴, 디자인 점검" onClick={() => useEditor.getState().set({ aiPane: 'design' })} />
        <RibbonButton size="large" icon={<PanelsTopLeft size={26} />} label="슬라이드 마스터" title="슬라이드 마스터 편집 (모든 슬라이드의 공통 디자인·서식)" active={masterView} onClick={() => (masterView ? M.closeMasterView() : M.openMasterView())} />
      </RibbonGroup>
      {themeDialog && <ThemeDialog onClose={() => setThemeDialog(false)} />}
    </>
  );
}

/** 템플릿 미리 보기: 제목 슬라이드 레이아웃 축소판 */
function TemplateThumb({ template }: { template: DesignTemplate }) {
  const doc = useMemo(() => {
    const d = createPresentation('미리 보기', template.theme);
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
  return <ScaledSlide slide={doc.slides[0]} doc={doc} width={120} className="tpl-thumb" />;
}

/* ───────────── 전환 / 애니메이션 / 녹화 ───────────── */

/* ───────────── 검토 ───────────── */

function CommentsGroup() {
  const pane = useEditor((s) => s.commentsPane);
  const show = useEditor((s) => s.showComments);
  return (
    <RibbonGroup label="메모">
      <RibbonButton size="large" icon={<MessageSquarePlus size={26} />} label="새 메모" title="새 메모 (선택한 개체에 연결)" onClick={startNewComment} />
      <div className="rb-col">
        <RibbonButton icon={<ChevronLeft size={16} />} label="이전" title="이전 메모" onClick={() => goToComment(-1)} />
        <RibbonButton icon={<ChevronRight size={16} />} label="다음" title="다음 메모" onClick={() => goToComment(1)} />
        <DropdownButton icon={<Trash2 size={16} />} label="삭제" title="메모 삭제">
          {(close) => (
            <>
              <MenuItem
                label="이 슬라이드의 모든 메모 삭제"
                onClick={() => {
                  close();
                  const st = useEditor.getState();
                  let n = 0;
                  st.commit('슬라이드 메모 삭제', (d) => void (n = deleteAllComments(d, st.activeSlideId)));
                  st.toast(`메모 ${n}개를 삭제했습니다.`, 'success');
                }}
              />
              <MenuItem
                label="이 프레젠테이션의 모든 메모 삭제"
                onClick={() => {
                  close();
                  const st = useEditor.getState();
                  let n = 0;
                  st.commit('모든 메모 삭제', (d) => void (n = deleteAllComments(d)));
                  st.toast(`메모 ${n}개를 삭제했습니다.`, 'success');
                }}
              />
            </>
          )}
        </DropdownButton>
      </div>
      <div className="rb-col">
        <RibbonButton icon={<MessagesSquare size={16} />} label="메모 창" title="메모 창 표시" active={pane} onClick={() => useEditor.getState().set({ commentsPane: !pane })} />
        <RibbonButton icon={show ? <Eye size={16} /> : <EyeOff size={16} />} label="메모 표시" title="슬라이드에 메모 표시" active={show} onClick={() => useEditor.getState().set({ showComments: !show })} />
      </div>
    </RibbonGroup>
  );
}

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
      <RibbonGroup label="언어 교정">
        <RibbonButton size="large" icon={<SpellCheck size={26} />} label="맞춤법 검사" title="맞춤법 검사 (F7): 한국어·영어 사전과 한국어 맞춤법 규칙" onClick={openSpellPane} />
      </RibbonGroup>
      <RibbonGroup label="비교">
        <RibbonButton size="large" icon={<GitCompare size={26} />} label="비교" title="다른 버전의 파일(.pptx, .slidelab)과 비교해 변경을 적용" onClick={() => void startCompare()} />
      </RibbonGroup>
      <CommentsGroup />
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
      <RibbonGroup label="마스터 보기">
        <RibbonButton size="large" icon={<PanelsTopLeft size={26} />} label="슬라이드 마스터" title="슬라이드 마스터 보기" active={s.masterView} onClick={() => (s.masterView ? M.closeMasterView() : M.openMasterView())} />
      </RibbonGroup>
    </>
  );
}
