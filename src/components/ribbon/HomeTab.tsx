import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Clipboard, Copy, Eraser, Highlighter, IndentDecrease, IndentIncrease,
  Italic, LayoutTemplate, Shapes, List, ListOrdered, Paintbrush, PaintBucket, Plus, Scissors, Strikethrough, Underline, Trash2,
  CopyPlus, Rows3, MousePointer2, Baseline, PenLine, ArrowUpDown, AArrowUp, AArrowDown, TextCursorInput, Sparkles, Replace, Type,
} from 'lucide-react';
import { RibbonButton, DropdownButton, SplitButton, RibbonGroup, MenuItem, MenuSeparator } from '../common/Buttons';
import { ColorBarIcon, ColorPanel } from '../common/ColorPicker';
import { useEditor, getActiveSlide } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { applyFormat } from '../../editors/text/formatting';
import { useCurrentTextStyle } from '../../hooks/useCurrentTextStyle';
import { FONT_SIZES } from '../../editors/text/fonts';
import { FontPicker } from '../common/FontPicker';
import { ShapeGalleryPanel } from './ShapeGallery';
import { ArrangeMenu } from './ArrangeMenu';
import { LayoutGallery } from './LayoutGallery';
import type { Stroke } from '../../types/model';
import { useState } from 'react';

export function HomeTab() {
  const ts = useCurrentTextStyle();
  const selCount = useEditor((s) => s.selectedIds.length);
  const editing = useEditor((s) => !!s.editingTextId);
  const hasClip = useEditor((s) => !!s.clipboard);
  const fp = useEditor((s) => s.formatPainter);
  const aiPane = useEditor((s) => s.aiPane);
  const [lastColor, setLastColor] = useState('#C00000');
  const [lastHighlight, setLastHighlight] = useState('#FFFF00');
  const [lastFill, setLastFill] = useState<string>('#4472C4');
  const [lastLine, setLastLine] = useState<string>('#2F528F');
  const textOn = ts.hasText;
  const any = selCount > 0;

  const setFill = (c: string | null) => {
    const s = useEditor.getState();
    s.commit('도형 채우기', (d) => C.updateObjects(d, getActiveSlide().id, s.selectedIds, (o) => C.setFill(o, c ? { type: 'solid', color: c } : { type: 'none' })));
  };
  const setLine = (patch: Partial<Stroke> | null) => {
    const s = useEditor.getState();
    s.commit('도형 윤곽선', (d) =>
      C.updateObjects(d, getActiveSlide().id, s.selectedIds, (o) => {
        const cur: Stroke = ('stroke' in o && o.stroke) || { color: '#2F528F', width: 1, dash: 'solid' };
        C.setStroke(o, patch === null ? null : { ...cur, ...patch });
      }),
    );
  };

  return (
    <>
      <RibbonGroup label="클립보드">
        <RibbonButton size="large" icon={<Clipboard size={26} />} label="붙여넣기" title="붙여넣기" shortcut="Ctrl+V" disabled={!hasClip} onClick={() => A.paste()} />
        <div className="rb-col">
          <RibbonButton icon={<Scissors size={15} />} label="잘라내기" title="잘라내기" shortcut="Ctrl+X" disabled={!any || editing} onClick={() => A.copySelection(true)} />
          <RibbonButton icon={<Copy size={15} />} label="복사" title="복사" shortcut="Ctrl+C" disabled={!any || editing} onClick={() => A.copySelection()} />
          <RibbonButton
            icon={<Paintbrush size={15} />}
            label="서식 복사"
            title="서식 복사 (두 번 클릭하면 여러 번 적용)"
            active={!!fp}
            disabled={!any && !fp}
            onClick={() => A.startFormatPainter(false)}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="슬라이드">
        <SplitButton size="large" icon={<Plus size={26} />} label="새 슬라이드" title="새 슬라이드" shortcut="Ctrl+M" onClick={() => A.newSlide()}>
          {(close) => (
            <div className="layout-gallery-wrap">
              <LayoutGallery close={close} />
              <MenuSeparator />
              <MenuItem icon={<CopyPlus size={15} />} label="선택한 슬라이드 복제" onClick={() => (A.duplicateSelectedSlides(), close())} />
            </div>
          )}
        </SplitButton>
        <div className="rb-col">
          <RibbonButton icon={<CopyPlus size={15} />} label="복제" title="슬라이드 복제" shortcut="Ctrl+D" onClick={A.duplicateSelectedSlides} />
          <RibbonButton icon={<Trash2 size={15} />} label="삭제" title="슬라이드 삭제" onClick={A.deleteSelectedSlides} />
          <DropdownButton icon={<Rows3 size={15} />} label="구역" title="구역">
            {(close) => <SectionMenu close={close} />}
          </DropdownButton>
        </div>
      </RibbonGroup>

      <RibbonGroup label="글꼴" className="rg-font">
        <div className="rb-col rb-col-tight">
          <div className="rb-row">
            <FontPicker className="rb-font" value={ts.fontFamily} disabled={!textOn} allowTokens onChange={(f) => applyFormat({ type: 'fontFamily', value: f })} />
            <FontSizeInput value={ts.fontSize} disabled={!textOn} />
            <RibbonButton icon={<AArrowUp size={16} />} title="글꼴 크기 크게" shortcut="Ctrl+]" disabled={!textOn} onClick={() => applyFormat({ type: 'growFont' })} />
            <RibbonButton icon={<AArrowDown size={16} />} title="글꼴 크기 작게" shortcut="Ctrl+[" disabled={!textOn} onClick={() => applyFormat({ type: 'shrinkFont' })} />
            <RibbonButton icon={<Eraser size={15} />} title="모든 서식 지우기" disabled={!textOn} onClick={() => applyFormat({ type: 'clear' })} />
          </div>
          <div className="rb-row">
            <RibbonButton icon={<Bold size={15} />} title="굵게" shortcut="Ctrl+B" active={ts.bold} disabled={!textOn} onClick={() => applyFormat({ type: 'toggle', key: 'bold' })} />
            <RibbonButton icon={<Italic size={15} />} title="기울임꼴" shortcut="Ctrl+I" active={ts.italic} disabled={!textOn} onClick={() => applyFormat({ type: 'toggle', key: 'italic' })} />
            <RibbonButton icon={<Underline size={15} />} title="밑줄" shortcut="Ctrl+U" active={ts.underline} disabled={!textOn} onClick={() => applyFormat({ type: 'toggle', key: 'underline' })} />
            <RibbonButton icon={<Strikethrough size={15} />} title="취소선" active={ts.strike} disabled={!textOn} onClick={() => applyFormat({ type: 'toggle', key: 'strike' })} />
            <span className="rb-sep" />
            <SplitButton
              icon={<ColorBarIcon icon={<Highlighter size={15} />} color={lastHighlight} />}
              title="텍스트 강조 색"
              disabled={!textOn}
              onClick={() => applyFormat({ type: 'highlight', value: lastHighlight })}
            >
              {(close) => (
                <ColorPanel
                  allowNone
                  noneLabel="색 없음"
                  onPick={(c) => {
                    if (c) setLastHighlight(c);
                    applyFormat({ type: 'highlight', value: c });
                    close();
                  }}
                />
              )}
            </SplitButton>
            <SplitButton
              icon={<ColorBarIcon icon={<Baseline size={15} />} color={lastColor} />}
              title="글꼴 색"
              disabled={!textOn}
              onClick={() => applyFormat({ type: 'color', value: lastColor })}
            >
              {(close) => (
                <ColorPanel
                  onPick={(c) => {
                    if (c) {
                      setLastColor(c);
                      applyFormat({ type: 'color', value: c });
                    }
                    close();
                  }}
                />
              )}
            </SplitButton>
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="단락">
        <div className="rb-col rb-col-tight">
          <div className="rb-row">
            <RibbonButton icon={<List size={16} />} title="글머리 기호" active={ts.bullet === 'bullet'} disabled={!textOn} onClick={() => applyFormat({ type: 'bullet', value: 'bullet' })} />
            <RibbonButton icon={<ListOrdered size={16} />} title="번호 매기기" active={ts.bullet === 'number'} disabled={!textOn} onClick={() => applyFormat({ type: 'bullet', value: 'number' })} />
            <RibbonButton icon={<IndentDecrease size={16} />} title="목록 수준 줄임" shortcut="Shift+Tab" disabled={!textOn} onClick={() => applyFormat({ type: 'indent', delta: -1 })} />
            <RibbonButton icon={<IndentIncrease size={16} />} title="목록 수준 늘림" shortcut="Tab" disabled={!textOn} onClick={() => applyFormat({ type: 'indent', delta: 1 })} />
            <DropdownButton icon={<ArrowUpDown size={15} />} title="줄 간격" disabled={!textOn}>
              {(close) => (
                <div className="menu">
                  {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => (
                    <MenuItem key={v} label={v.toFixed(v % 1 ? 2 : 1).replace(/0$/, '')} checked={ts.lineSpacing === v} onClick={() => (applyFormat({ type: 'lineSpacing', value: v }), close())} />
                  ))}
                </div>
              )}
            </DropdownButton>
          </div>
          <div className="rb-row">
            <RibbonButton icon={<AlignLeft size={16} />} title="왼쪽 맞춤" shortcut="Ctrl+L" active={ts.align === 'left'} disabled={!textOn} onClick={() => applyFormat({ type: 'align', value: 'left' })} />
            <RibbonButton icon={<AlignCenter size={16} />} title="가운데 맞춤" shortcut="Ctrl+E" active={ts.align === 'center'} disabled={!textOn} onClick={() => applyFormat({ type: 'align', value: 'center' })} />
            <RibbonButton icon={<AlignRight size={16} />} title="오른쪽 맞춤" shortcut="Ctrl+R" active={ts.align === 'right'} disabled={!textOn} onClick={() => applyFormat({ type: 'align', value: 'right' })} />
            <RibbonButton icon={<AlignJustify size={16} />} title="양쪽 맞춤" shortcut="Ctrl+J" active={ts.align === 'justify'} disabled={!textOn} onClick={() => applyFormat({ type: 'align', value: 'justify' })} />
            <DropdownButton icon={<TextCursorInput size={15} />} title="텍스트 방향 / 맞춤" disabled={!textOn}>
              {(close) => (
                <div className="menu">
                  <div className="menu-title">텍스트 방향</div>
                  <MenuItem label="가로" onClick={() => (applyFormat({ type: 'direction', value: 'horizontal' }), close())} />
                  <MenuItem label="세로 (90° 회전)" onClick={() => (applyFormat({ type: 'direction', value: 'vertical' }), close())} />
                  <MenuItem label="세로 (270° 회전)" onClick={() => (applyFormat({ type: 'direction', value: 'vertical270' }), close())} />
                  <MenuSeparator />
                  <div className="menu-title">텍스트 맞춤</div>
                  <MenuItem label="위쪽" onClick={() => (applyFormat({ type: 'vAlign', value: 'top' }), close())} />
                  <MenuItem label="중간" onClick={() => (applyFormat({ type: 'vAlign', value: 'middle' }), close())} />
                  <MenuItem label="아래쪽" onClick={() => (applyFormat({ type: 'vAlign', value: 'bottom' }), close())} />
                </div>
              )}
            </DropdownButton>
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="그리기">
        <DropdownButton size="large" icon={<Shapes size={26} />} label="도형" title="도형 삽입" panelClass="wide">
          {(close) => (
            <ShapeGalleryPanel
              onPick={(k) => (useEditor.getState().set({ insertTool: { kind: 'shape', shape: k } }), close())}
              onLine={(arrow) => (useEditor.getState().set({ insertTool: { kind: 'line', arrow } }), close())}
            />
          )}
        </DropdownButton>
        <DropdownButton size="large" icon={<LayoutTemplate size={26} />} label="정렬" title="개체 정렬 및 순서" disabled={!any}>
          {(close) => <ArrangeMenu close={close} />}
        </DropdownButton>
        <div className="rb-col">
          <SplitButton icon={<ColorBarIcon icon={<PaintBucket size={15} />} color={lastFill} />} label="도형 채우기" title="도형 채우기" disabled={!any} onClick={() => setFill(lastFill)}>
            {(close) => (
              <ColorPanel
                allowNone
                onPick={(c) => {
                  if (c) setLastFill(c);
                  setFill(c);
                  close();
                }}
              />
            )}
          </SplitButton>
          <SplitButton icon={<ColorBarIcon icon={<PenLine size={15} />} color={lastLine} />} label="도형 윤곽선" title="도형 윤곽선" disabled={!any} onClick={() => setLine({ color: lastLine })}>
            {(close) => (
              <div>
                <ColorPanel
                  allowNone
                  noneLabel="윤곽선 없음"
                  onPick={(c) => {
                    if (c) setLastLine(c);
                    setLine(c ? { color: c } : null);
                    close();
                  }}
                />
                <MenuSeparator />
                <div className="menu-title">두께</div>
                <div className="menu-inline">
                  {[0.5, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => (
                    <button key={w} type="button" className="chip" onClick={() => (setLine({ width: w }), close())}>
                      {w}pt
                    </button>
                  ))}
                </div>
                <div className="menu-title">대시</div>
                <div className="menu-inline">
                  {(['solid', 'dash', 'dot', 'dashDot'] as const).map((d) => (
                    <button key={d} type="button" className="chip" onClick={() => (setLine({ dash: d }), close())}>
                      {{ solid: '실선', dash: '파선', dot: '점선', dashDot: '파선-점선' }[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </SplitButton>
        </div>
      </RibbonGroup>

      <RibbonGroup label="편집">
        <div className="rb-col">
          <DropdownButton icon={<Replace size={15} />} label="바꾸기" title="바꾸기">
            {(close) => (
              <div className="menu">
                <MenuItem icon={<Type size={14} />} label="글꼴 바꾸기..." onClick={() => (close(), useEditor.getState().set({ fontDialog: 'replace' }))} />
                <MenuItem label="글꼴 관리..." onClick={() => (close(), useEditor.getState().set({ fontDialog: 'manage' }))} />
              </div>
            )}
          </DropdownButton>
          <RibbonButton icon={<MousePointer2 size={15} />} label="모두 선택" title="모두 선택" shortcut="Ctrl+A" onClick={A.selectAll} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="AI">
        <RibbonButton
          size="large"
          icon={<Sparkles size={26} />}
          label="AI 도우미"
          title="AI 도우미: 프레젠테이션 만들기, 요약, 발표 대본, 디자인 추천 (API 키 없이도 기본 엔진으로 동작)"
          active={!!aiPane}
          onClick={() => useEditor.getState().set({ aiPane: aiPane ? null : 'create' })}
        />
      </RibbonGroup>
    </>
  );
}

function FontSizeInput({ value, disabled }: { value?: number; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (v: string) => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 1 && n <= 400) applyFormat({ type: 'fontSize', value: n });
    setDraft(null);
  };
  return (
    <span className="rb-combo" title="글꼴 크기">
      <input
        className="rb-input font-size"
        disabled={disabled}
        value={draft ?? (value ? String(value) : '')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setDraft(null);
        }}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        aria-label="글꼴 크기"
      />
      <select className="rb-combo-select" disabled={disabled} value="" onChange={(e) => commit(e.target.value)} aria-label="글꼴 크기 목록">
        <option value="" disabled hidden />
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </span>
  );
}

function SectionMenu({ close }: { close: () => void }) {
  const doc = useEditor((s) => s.doc);
  const active = useEditor((s) => s.activeSlideId);
  return (
    <div className="menu">
      <MenuItem
        label="구역 추가"
        onClick={() => {
          const name = prompt('구역 이름', '제목 없는 구역');
          if (name !== null) useEditor.getState().commit('구역 추가', (d) => void C.addSection(d, active, name || '제목 없는 구역'));
          close();
        }}
      />
      {doc.sections.length > 0 && <MenuSeparator />}
      {doc.sections.length > 0 && (
        <MenuItem
          label="모든 구역 제거"
          onClick={() => {
            useEditor.getState().commit('모든 구역 제거', (d) => void (d.sections = []));
            close();
          }}
        />
      )}
    </div>
  );
}
