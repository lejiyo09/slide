import { Plus, CopyPlus, Trash2, Pencil, X, Type, AlignLeft, CalendarDays, Hash, PanelBottom, ImageOff, Palette } from 'lucide-react';
import { RibbonButton, RibbonGroup, DropdownButton, MenuItem } from '../common/Buttons';
import { useEditor } from '../../core/store/editorStore';
import * as M from '../../core/commands/masterActions';
import { THEMES } from '../../themes/themes';
import { COLOR_SCHEMES, FONT_SCHEMES } from '../../themes/schemes';

/** 슬라이드 마스터 보기 전용 탭 */
export function MasterTab() {
  const doc = useEditor((s) => s.doc);
  const active = useEditor((s) => s.activeSlideId);
  const isMaster = active === doc.master?.id;
  const layout = doc.layouts?.[active];
  const used = layout ? doc.slides.filter((s) => s.layout === active).length : 0;
  return (
    <>
      <RibbonGroup label="마스터 편집">
        <RibbonButton size="large" icon={<Plus size={26} />} label="레이아웃 삽입" title="새 레이아웃 삽입" onClick={M.insertLayout} />
        <div className="rb-col">
          <RibbonButton icon={<CopyPlus size={15} />} label="복제" title="레이아웃 복제" disabled={isMaster} onClick={M.duplicateLayout} />
          <RibbonButton icon={<Trash2 size={15} />} label="삭제" title={used ? `슬라이드 ${used}장이 사용 중` : '레이아웃 삭제'} disabled={isMaster || used > 0} onClick={M.deleteLayout} />
          <RibbonButton
            icon={<Pencil size={15} />}
            label="이름 바꾸기"
            title="이름 바꾸기"
            onClick={() => {
              const cur = isMaster ? doc.master : layout;
              const name = prompt('이름', cur?.name);
              if (name) M.renameMasterSlide(active, name);
            }}
          />
        </div>
      </RibbonGroup>
      <RibbonGroup label="마스터 레이아웃">
        <DropdownButton size="large" icon={<Type size={26} />} label="개체 틀 삽입" title="개체 틀 삽입 (새 슬라이드에 복제되는 입력 칸)">
          {(close) => (
            <div className="menu">
              <MenuItem icon={<Type size={15} />} label="제목" onClick={() => (M.insertPlaceholder('title'), close())} />
              <MenuItem icon={<AlignLeft size={15} />} label="텍스트" onClick={() => (M.insertPlaceholder('body'), close())} />
              <MenuItem icon={<CalendarDays size={15} />} label="날짜" onClick={() => (M.insertPlaceholder('dt'), close())} />
              <MenuItem icon={<PanelBottom size={15} />} label="바닥글" onClick={() => (M.insertPlaceholder('ftr'), close())} />
              <MenuItem icon={<Hash size={15} />} label="슬라이드 번호" onClick={() => (M.insertPlaceholder('sldNum'), close())} />
            </div>
          )}
        </DropdownButton>
        <label className="rb-check master-check" title="마스터의 디자인 요소를 이 레이아웃에서 숨김">
          <input type="checkbox" disabled={isMaster} checked={layout?.showMasterShapes === false} onChange={M.toggleHideBackgroundGraphics} />
          <ImageOff size={13} /> 배경 그래픽 숨기기
        </label>
      </RibbonGroup>
      <RibbonGroup label="테마 편집">
        <DropdownButton size="large" icon={<Palette size={26} />} label="테마" title="테마">
          {(close) => (
            <div className="menu">
              {THEMES.map((t) => (
                <MenuItem key={t.id} label={t.name} checked={doc.theme.id === t.id} onClick={() => (M.applyFullTheme(t), close())} />
              ))}
            </div>
          )}
        </DropdownButton>
        <div className="rb-col">
          <DropdownButton label="색" title="색 조합">
            {(close) => (
              <div className="menu">
                {COLOR_SCHEMES.map((c) => (
                  <MenuItem key={c.id} label={c.name} onClick={() => (M.applyThemeColors(c.colors, c.name), close())} />
                ))}
              </div>
            )}
          </DropdownButton>
          <DropdownButton label="글꼴" title="글꼴 조합">
            {(close) => (
              <div className="menu">
                {FONT_SCHEMES.map((f) => (
                  <MenuItem key={f.id} label={f.name} onClick={() => (M.applyThemeFonts(f.heading, f.body), close())} />
                ))}
              </div>
            )}
          </DropdownButton>
        </div>
      </RibbonGroup>
      <RibbonGroup label="정보">
        <div className="rb-col muted table-info">
          <span>{isMaster ? '모든 레이아웃·슬라이드에 적용' : `이 레이아웃을 쓰는 슬라이드 ${used}장`}</span>
          <span>바꾸지 않은 위치·서식만 따라 바뀝니다</span>
        </div>
      </RibbonGroup>
      <RibbonGroup label="닫기">
        <RibbonButton size="large" icon={<X size={26} />} label="마스터 보기 닫기" title="기본 보기로 돌아가기" onClick={M.closeMasterView} />
      </RibbonGroup>
    </>
  );
}
