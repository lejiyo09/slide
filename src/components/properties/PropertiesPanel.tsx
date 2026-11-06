import { AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bold, Italic, Underline, Lock, Unlock, PanelRightClose } from 'lucide-react';
import { useEditor, getActiveSlide, useSelectedObjects } from '../../core/store/editorStore';
import { findSlide } from '../../core/document/query';
import * as C from '../../core/commands/commands';
import type { ArrowHead, DashStyle, Fill, SlideObject, Stroke } from '../../types/model';
import { ColorField, NumberField, Row, Section, Segmented, SliderField } from './fields';
import { round } from '../../utils/units';
import { applyFormat } from '../../editors/text/formatting';
import { useCurrentTextStyle } from '../../hooks/useCurrentTextStyle';
import { FontPicker } from '../common/FontPicker';
import { SHAPE_NAMES } from '../../core/document/factory';
import { fileToAsset, pickFiles } from '../../services/storage/files';
import { PATTERNS } from '../../engines/rendering/patterns';
import { fillToCss } from '../../engines/rendering/ObjectView';

const pxToCm = (px: number) => round((px / 96) * 2.54, 2);
const cmToPx = (cm: number) => (cm / 2.54) * 96;

const TYPE_NAMES: Record<SlideObject['type'], string> = { text: '텍스트 상자', shape: '도형', line: '선', image: '그림', group: '그룹', table: '표', chart: '차트', media: '미디어', unsupported: '보존된 개체' };

/** 선택된 개체에 적용 (하나의 실행 취소 단계) */
function edit(label: string, fn: (o: SlideObject) => void) {
  const s = useEditor.getState();
  s.commit(label, (d) => C.updateObjects(d, getActiveSlide().id, s.selectedIds, fn));
}

/** 슬라이더처럼 연속 변경: 제스처로 묶기 */
const live = {
  start: (label: string) => useEditor.getState().beginGesture(label),
  update: (fn: (o: SlideObject) => void) => {
    const s = useEditor.getState();
    if (!s.gestureBase) s.beginGesture('서식');
    s.updateGesture((d) => C.updateObjects(d, getActiveSlide().id, s.selectedIds, fn));
  },
  end: () => useEditor.getState().endGesture(),
};

export function PropertiesPanel({ onClose }: { onClose: () => void }) {
  const objs = useSelectedObjects();
  const masterView = useEditor((s) => s.masterView);
  const title = objs.length === 0 ? (masterView ? '마스터/레이아웃 배경 서식' : '슬라이드 서식') : objs.length === 1 ? `${objs[0].type === 'shape' ? SHAPE_NAMES[objs[0].shape] : TYPE_NAMES[objs[0].type]} 서식` : `개체 ${objs.length}개 서식`;
  return (
    <aside className="properties" aria-label="서식 창">
      <div className="pp-head">
        <span>{title}</span>
        <button type="button" className="icon-btn" title="서식 창 닫기" onClick={onClose}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="pp-body">{objs.length === 0 ? <SlideProps /> : <ObjectProps objs={objs} />}</div>
    </aside>
  );
}

/* ───────────── 슬라이드 ───────────── */

function SlideProps() {
  const slide = useEditor((s) => findSlide(s.doc, s.activeSlideId) ?? s.doc.slides[0]);
  const theme = useEditor((s) => s.doc.theme);
  const selected = useEditor((s) => s.selectedSlideIds);
  const fill = slide.background?.fill ?? theme.background;
  const setBg = (f: Fill | null, all = false) => useEditor.getState().commit('배경 서식', (d) => C.setBackground(d, all ? 'all' : selected, f));
  return (
    <>
      <Section title="배경">
        <FillEditor fill={fill} onChange={(f) => setBg(f)} allowImage onImage={async () => {
          const [file] = await pickFiles('image/*');
          if (!file) return;
          const { asset } = await fileToAsset(file);
          useEditor.getState().commit('그림 배경', (d) => {
            d.assets[asset.id] = asset;
            C.setBackground(d, selected, { type: 'image', assetId: asset.id });
          });
        }} />
        <div className="pp-buttons">
          <button type="button" className="btn" onClick={() => setBg(slide.background ? structuredClone(slide.background.fill) : null, true)}>
            모두 적용
          </button>
          <button type="button" className="btn" onClick={() => setBg(null)}>
            배경 재설정
          </button>
        </div>
      </Section>
      <Section title="슬라이드">
        <Row label="숨기기">
          <input type="checkbox" checked={!!slide.hidden} onChange={(e) => useEditor.getState().commit('슬라이드 숨기기', (d) => C.setSlideHidden(d, [slide.id], e.target.checked))} />
        </Row>
        <p className="pp-hint">개체를 선택하면 해당 개체의 서식을 편집할 수 있습니다.</p>
      </Section>
    </>
  );
}

/* ───────────── 개체 ───────────── */

function ObjectProps({ objs }: { objs: SlideObject[] }) {
  const o = objs[0];
  const single = objs.length === 1;
  const hasFill = objs.every((x) => x.type === 'shape' || x.type === 'text');
  const hasText = objs.some((x) => x.type === 'shape' || x.type === 'text' || x.type === 'table');
  return (
    <>
      {hasFill && (o.type === 'shape' || o.type === 'text') && (
        <Section title="채우기">
          <FillEditor fill={o.fill} onChange={(f) => edit('채우기', (x) => C.setFill(x, f))} />
        </Section>
      )}
      {single && o.type === 'unsupported' && (
        <Section title="보존된 개체">
          <p className="pp-hint">
            {o.label} — PowerPoint 원본 XML이 그대로 보존되어 PPTX로 저장할 때 복원됩니다. 위치·크기 변경과 삭제는 저장 시 반영되며, 내용 편집은 다음 단계(표·차트: 8단계)에서 지원됩니다.
          </p>
        </Section>
      )}
      {!['group', 'unsupported', 'table', 'chart', 'media'].includes(o.type) && (
        <Section title="선">
          <StrokeEditor obj={o} />
        </Section>
      )}
      {hasText && <TextSection obj={o} />}
      {single && o.type === 'table' && (
        <Section title="표">
          <p className="pp-hint">
            {o.rows.length}행 × {o.columns.length}열. 셀을 클릭하면 편집, Shift+클릭 또는 드래그로 셀 범위를 선택합니다. 행/열/병합/테두리는 [표 디자인]·[레이아웃] 탭에서 바꿀 수 있습니다.
          </p>
        </Section>
      )}
      {single && o.type === 'chart' && (
        <Section title="차트">
          <button type="button" className="btn" onClick={() => useEditor.getState().set({ chartEditorId: o.id })}>
            데이터 편집…
          </button>
          <Row label="글자 크기">
            <NumberField label="" unit="pt" min={6} max={40} value={o.fontSize} onChange={(v) => edit('차트 글자 크기', (x) => void (x.type === 'chart' && (x.fontSize = v)))} />
          </Row>
          {o.series.map((sr, i) => (
            <Row key={i} label={sr.name || `계열 ${i + 1}`}>
              <ColorField
                title="계열 색"
                value={sr.color ?? null}
                allowNone
                onChange={(c) =>
                  edit('계열 색', (x) => {
                    if (x.type !== 'chart' || !x.series[i]) return;
                    if (c) x.series[i].color = c;
                    else delete x.series[i].color;
                  })
                }
              />
            </Row>
          ))}
        </Section>
      )}
      {single && o.type === 'media' && (
        <Section title={o.kind === 'video' ? '비디오' : '오디오'}>
          <p className="pp-hint">슬라이드 쇼에서 재생됩니다. 자동 실행·반복은 [재생] 탭에서 설정합니다.</p>
        </Section>
      )}
      {single && o.type === 'image' && <ImageSection obj={o} />}
      <Section title="크기 및 위치">
        <div className="pp-grid2">
          <NumberField label="너비" unit="cm" step={0.1} value={pxToCm(o.width)} onChange={(v) => edit('크기', (x) => C.resizeGroup(x, Math.max(1, cmToPx(v)), x.height))} />
          <NumberField label="높이" unit="cm" step={0.1} value={pxToCm(o.height)} onChange={(v) => edit('크기', (x) => C.resizeGroup(x, x.width, Math.max(1, cmToPx(v))))} />
          <NumberField label="가로 위치" unit="cm" step={0.1} value={pxToCm(o.x)} onChange={(v) => edit('위치', (x) => void (x.x = cmToPx(v)))} />
          <NumberField label="세로 위치" unit="cm" step={0.1} value={pxToCm(o.y)} onChange={(v) => edit('위치', (x) => void (x.y = cmToPx(v)))} />
          <NumberField label="회전" unit="°" value={round(o.rotation, 1)} onChange={(v) => edit('회전', (x) => void (x.rotation = ((v % 360) + 360) % 360))} />
        </div>
      </Section>
      <Section title="개체">
        {single && (
          <Row label="이름">
            <input
              className="pp-input"
              key={o.id}
              defaultValue={o.name}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              onBlur={(e) => e.target.value !== o.name && edit('이름 변경', (x) => void (x.name = e.target.value))}
            />
          </Row>
        )}
        <Row label="투명도">
          <SliderField value={Math.round((1 - (o.opacity ?? 1)) * 100)} onStart={() => live.start('투명도')} onEnd={live.end} onChange={(v) => live.update((x) => void (x.opacity = 1 - v / 100))} />
        </Row>
        <Row label="잠금">
          <button type="button" className={`btn btn-sm ${o.locked ? 'is-active' : ''}`} onClick={() => edit(o.locked ? '잠금 해제' : '잠금', (x) => void (x.locked = !o.locked))}>
            {o.locked ? <Lock size={14} /> : <Unlock size={14} />} {o.locked ? '잠김 (이동/크기 조절 불가)' : '잠금'}
          </button>
        </Row>
      </Section>
    </>
  );
}

function FillEditor({ fill, onChange, allowImage, onImage }: { fill: Fill; onChange: (f: Fill) => void; allowImage?: boolean; onImage?: () => void }) {
  const theme = useEditor((s) => s.doc.theme);
  const options: { value: Fill['type']; label: string; title: string }[] = [
    { value: 'none', label: '없음', title: '채우기 없음' },
    { value: 'solid', label: '단색', title: '단색 채우기' },
    { value: 'gradient', label: '그라데이션', title: '그라데이션 채우기' },
    { value: 'pattern', label: '무늬', title: '무늬 채우기' },
  ];
  if (allowImage) options.push({ value: 'image', label: '그림', title: '그림 채우기' });
  const setType = (t: Fill['type']) => {
    if (t === fill.type) return;
    const base = fill.type === 'solid' ? fill.color : fill.type === 'gradient' ? fill.stops[0].color : fill.type === 'pattern' ? fill.fg : '@accent1';
    if (t === 'pattern') onChange({ type: 'pattern', preset: 'ltUpDiag', fg: base, bg: '@light1' });
    if (t === 'none') onChange({ type: 'none' });
    if (t === 'solid') onChange({ type: 'solid', color: base });
    if (t === 'gradient') onChange({ type: 'gradient', angle: 90, stops: [{ offset: 0, color: base }, { offset: 1, color: '#FFFFFF' }] });
    if (t === 'image') onImage?.();
  };
  return (
    <>
      <Segmented value={fill.type} options={options} onChange={setType} />
      {fill.type === 'solid' && (
        <>
          <Row label="색">
            <ColorField title="채우기 색" value={fill.color} onChange={(c) => c && onChange({ ...fill, color: c })} />
          </Row>
          <Row label="투명도">
            <SliderField
              value={Math.round((1 - (fill.opacity ?? 1)) * 100)}
              onStart={() => live.start('채우기 투명도')}
              onEnd={live.end}
              onChange={(v) => {
                const s = useEditor.getState();
                if (s.selectedIds.length) live.update((x) => C.setFill(x, { ...fill, opacity: 1 - v / 100 }));
                else onChange({ ...fill, opacity: 1 - v / 100 });
              }}
            />
          </Row>
        </>
      )}
      {fill.type === 'gradient' && (
        <>
          <Row label="시작 색">
            <ColorField title="시작 색" value={fill.stops[0].color} onChange={(c) => c && onChange({ ...fill, stops: [{ ...fill.stops[0], color: c }, ...fill.stops.slice(1)] })} />
          </Row>
          <Row label="끝 색">
            <ColorField
              title="끝 색"
              value={fill.stops[fill.stops.length - 1].color}
              onChange={(c) => c && onChange({ ...fill, stops: [...fill.stops.slice(0, -1), { ...fill.stops[fill.stops.length - 1], color: c }] })}
            />
          </Row>
          <Row label="각도">
            <NumberField label="" unit="°" value={fill.angle} onChange={(v) => onChange({ ...fill, angle: ((v % 360) + 360) % 360 })} />
          </Row>
        </>
      )}
      {fill.type === 'pattern' && (
        <>
          <div className="pattern-pick">
            {PATTERNS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.name}
                className={`pattern-swatch ${fill.preset === p.id ? 'is-active' : ''}`}
                style={fillToCss({ ...fill, preset: p.id }, {}, theme)}
                onClick={() => onChange({ ...fill, preset: p.id })}
              />
            ))}
          </div>
          <Row label="전경색">
            <ColorField title="무늬 전경색" value={fill.fg} onChange={(c) => c && onChange({ ...fill, fg: c })} />
          </Row>
          <Row label="배경색">
            <ColorField title="무늬 배경색" value={fill.bg} onChange={(c) => c && onChange({ ...fill, bg: c })} />
          </Row>
        </>
      )}
      {fill.type === 'image' && allowImage && (
        <button type="button" className="btn" onClick={onImage}>
          다른 그림 선택…
        </button>
      )}
    </>
  );
}

const DASHES: { value: DashStyle; label: string; title: string }[] = [
  { value: 'solid', label: '━', title: '실선' },
  { value: 'dash', label: '╍', title: '파선' },
  { value: 'dot', label: '┉', title: '점선' },
  { value: 'dashDot', label: '-·-', title: '파선-점선' },
];

const HEADS: { value: ArrowHead; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'triangle', label: '삼각형' },
  { value: 'arrow', label: '열린 화살표' },
  { value: 'oval', label: '원형' },
];

function StrokeEditor({ obj }: { obj: SlideObject }) {
  const stroke: Stroke | null = 'stroke' in obj ? obj.stroke : null;
  const isLine = obj.type === 'line';
  const set = (patch: Partial<Stroke> | null) =>
    edit('선', (x) => {
      const cur: Stroke = ('stroke' in x && x.stroke) || { color: '#2F528F', width: 1, dash: 'solid' };
      C.setStroke(x, patch === null ? null : { ...cur, ...patch });
    });
  return (
    <>
      {!isLine && (
        <Segmented
          value={stroke ? 'solid' : 'none'}
          options={[
            { value: 'none', label: '선 없음', title: '선 없음' },
            { value: 'solid', label: '실선', title: '실선' },
          ]}
          onChange={(v) => set(v === 'none' ? null : {})}
        />
      )}
      {stroke && (
        <>
          <Row label="색">
            <ColorField title="선 색" value={stroke.color} onChange={(c) => c && set({ color: c })} />
          </Row>
          <Row label="너비">
            <NumberField label="" unit="pt" step={0.25} min={0.25} max={100} value={stroke.width} onChange={(v) => set({ width: v })} />
          </Row>
          <Row label="대시">
            <Segmented value={stroke.dash} options={DASHES} onChange={(v) => set({ dash: v })} />
          </Row>
        </>
      )}
      {obj.type === 'line' && (
        <>
          <Row label="시작 화살표">
            <select className="pp-select" value={obj.headStart} onChange={(e) => edit('화살표', (x) => x.type === 'line' && void (x.headStart = e.target.value as ArrowHead))}>
              {HEADS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </Row>
          <Row label="끝 화살표">
            <select className="pp-select" value={obj.headEnd} onChange={(e) => edit('화살표', (x) => x.type === 'line' && void (x.headEnd = e.target.value as ArrowHead))}>
              {HEADS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </Row>
        </>
      )}
    </>
  );
}

function TextSection({ obj }: { obj: SlideObject }) {
  const ts = useCurrentTextStyle();
  const body = obj.type === 'text' || obj.type === 'shape' ? obj.text : null;
  return (
    <Section title="텍스트">
      <Row label="글꼴">
        <FontPicker className="pp-font" value={ts.fontFamily} allowTokens onChange={(f) => applyFormat({ type: 'fontFamily', value: f })} />
      </Row>
      <Row label="크기">
        <NumberField label="" unit="pt" step={1} min={1} max={400} value={ts.fontSize ?? 18} onChange={(v) => applyFormat({ type: 'fontSize', value: v })} />
      </Row>
      <Row label="스타일">
        <span className="segmented">
          <button type="button" className={ts.bold ? 'is-active' : ''} title="굵게" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat({ type: 'toggle', key: 'bold' })}><Bold size={14} /></button>
          <button type="button" className={ts.italic ? 'is-active' : ''} title="기울임꼴" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat({ type: 'toggle', key: 'italic' })}><Italic size={14} /></button>
          <button type="button" className={ts.underline ? 'is-active' : ''} title="밑줄" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat({ type: 'toggle', key: 'underline' })}><Underline size={14} /></button>
        </span>
      </Row>
      <Row label="글자 색">
        <ColorField title="글자 색" value={ts.color ?? '#000000'} onChange={(c) => c && applyFormat({ type: 'color', value: c })} />
      </Row>
      <Row label="가로 맞춤">
        <Segmented
          value={ts.align}
          onChange={(v) => applyFormat({ type: 'align', value: v })}
          options={[
            { value: 'left', label: <AlignLeft size={14} />, title: '왼쪽' },
            { value: 'center', label: <AlignCenter size={14} />, title: '가운데' },
            { value: 'right', label: <AlignRight size={14} />, title: '오른쪽' },
            { value: 'justify', label: <AlignJustify size={14} />, title: '양쪽' },
          ]}
        />
      </Row>
      {body && (
        <>
          <Row label="세로 맞춤">
            <Segmented
              value={body.vAlign}
              onChange={(v) => applyFormat({ type: 'vAlign', value: v })}
              options={[
                { value: 'top', label: <AlignVerticalJustifyStart size={14} />, title: '위쪽' },
                { value: 'middle', label: <AlignVerticalJustifyCenter size={14} />, title: '중간' },
                { value: 'bottom', label: <AlignVerticalJustifyEnd size={14} />, title: '아래쪽' },
              ]}
            />
          </Row>
          <Row label="줄 간격">
            <NumberField label="" unit="배" step={0.05} min={0.5} max={5} value={ts.lineSpacing ?? 1} onChange={(v) => applyFormat({ type: 'lineSpacing', value: v })} />
          </Row>
          <Row label="자동 맞춤">
            <select className="pp-select" value={body.autoFit} onChange={(e) => edit('자동 맞춤', (x) => C.applyTextBody(x, { autoFit: e.target.value as 'none' | 'resize' }))}>
              <option value="none">자동 맞춤 안 함</option>
              <option value="resize">텍스트에 맞게 도형 크기 조정</option>
              <option value="shrink">넘치면 텍스트 크기 조정 (PPTX 전용)</option>
            </select>
          </Row>
          <Row label="줄 바꿈">
            <input type="checkbox" checked={body.wrap} onChange={(e) => edit('줄 바꿈', (x) => C.applyTextBody(x, { wrap: e.target.checked }))} />
          </Row>
          <div className="pp-grid2">
            {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
              <NumberField
                key={k}
                label={{ left: '왼쪽 여백', right: '오른쪽 여백', top: '위쪽 여백', bottom: '아래쪽 여백' }[k]}
                unit="cm"
                step={0.05}
                min={0}
                value={pxToCm(body.padding[k])}
                onChange={(v) => edit('여백', (x) => C.applyTextBody(x, { padding: { ...body.padding, [k]: cmToPx(v) } }))}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function ImageSection({ obj }: { obj: Extract<SlideObject, { type: 'image' }> }) {
  const c = obj.crop;
  const setCrop = (k: keyof typeof c, pct: number) =>
    edit('자르기', (x) => {
      if (x.type !== 'image') return;
      const v = Math.max(0, Math.min(0.95, pct / 100));
      const other = k === 'left' ? x.crop.right : k === 'right' ? x.crop.left : k === 'top' ? x.crop.bottom : x.crop.top;
      if (v + other > 0.95) return;
      // 화면에 보이는 배율 유지: 잘린 비율만큼 크기 조정
      const horiz = k === 'left' || k === 'right';
      const oldFrac = horiz ? 1 - x.crop.left - x.crop.right : 1 - x.crop.top - x.crop.bottom;
      x.crop = { ...x.crop, [k]: v };
      const newFrac = horiz ? 1 - x.crop.left - x.crop.right : 1 - x.crop.top - x.crop.bottom;
      if (horiz) x.width = (x.width / oldFrac) * newFrac;
      else x.height = (x.height / oldFrac) * newFrac;
    });
  return (
    <Section title="그림">
      <div className="pp-grid2">
        {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
          <NumberField key={k} label={{ left: '왼쪽 자르기', right: '오른쪽 자르기', top: '위쪽 자르기', bottom: '아래쪽 자르기' }[k]} unit="%" value={round(c[k] * 100, 1)} min={0} max={95} onChange={(v) => setCrop(k, v)} />
        ))}
      </div>
      <p className="pp-hint">
        원본 크기: {obj.naturalWidth} × {obj.naturalHeight}px
      </p>
    </Section>
  );
}
