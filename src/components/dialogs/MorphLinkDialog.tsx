/**
 * 모핑 연결 (사용자 지정 매칭): 이 슬라이드(다음)의 개체마다 앞 슬라이드의 어떤 개체에서 이어지는지 보여 주고 바꾼다.
 * 자동 짝이 모호하거나 '!!' 이름이 겹치면 경고. 고르면 morphKey로 저장(실행 취소 가능), '연결 안 함'은 morphExclude.
 */
import { useMemo } from 'react';
import { Dialog } from './Dialog';
import { useEditor } from '../../core/store/editorStore';
import { matchMorph } from '../../engines/transition/morph';
import type { Slide, SlideObject } from '../../types/model';

const TYPE: Record<string, string> = { text: '텍스트', shape: '도형', image: '그림', line: '선', group: '그룹', table: '표', chart: '차트', media: '미디어', equation: '수식', extension: '확장', unsupported: '개체' };
const label = (o: SlideObject) => {
  const t = o.type === 'text' || o.type === 'shape' ? o.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim().slice(0, 20) : '';
  return `${o.name || TYPE[o.type]}${t ? ` “${t}”` : ''}`;
};
const REASON: Record<string, string> = { morphKey: '같은 개체(복제·복사·지정)', name: "'!!' 이름", auto: '자동' };

export function MorphLinkDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const activeId = useEditor((s) => s.activeSlideId);
  const idx = doc.slides.findIndex((s) => s.id === activeId);
  const to = doc.slides[idx] as Slide | undefined;
  const from = idx > 0 ? (doc.slides[idx - 1] as Slide) : undefined;
  const visible = (s?: Slide) => (s ? s.objects.filter((o) => !o.hidden) : []);
  const match = useMemo(() => matchMorph(visible(from), visible(to)), [from, to]);
  if (!to) return null;
  const pairOf = (b: SlideObject) => match.pairs.find((p) => p.to.id === b.id);

  const choose = (b: SlideObject, value: string) => {
    useEditor.getState().commit('모핑 연결', (d) => {
      const tb = d.slides[idx].objects.find((o) => o.id === b.id);
      if (!tb) return;
      if (value === 'none') {
        tb.morphExclude = true;
        return;
      }
      delete tb.morphExclude;
      if (value === 'auto') {
        delete tb.morphKey;
        return;
      }
      const ta = d.slides[idx - 1]?.objects.find((o) => o.id === value);
      if (!ta) return;
      delete ta.morphExclude;
      const key = ta.morphKey ?? ta.id;
      // 같은 슬라이드에 같은 식별자가 둘이면 안 되므로 다른 개체의 것은 풂
      for (const o of d.slides[idx].objects) if (o !== tb && (o.morphKey ?? o.id) === key) delete o.morphKey;
      tb.morphKey = key;
    });
  };

  return (
    <Dialog title="모핑 연결" onClose={onClose} hideCancel onOk={onClose} okLabel="닫기">
      <div className="morph-link" data-morph-link="">
        {!from ? (
          <p className="muted">첫 슬라이드에는 앞 슬라이드가 없어 모핑할 개체가 없습니다.</p>
        ) : (
          <>
            <p className="muted">
              모핑은 앞 슬라이드({idx}번)에서 이 슬라이드({idx + 1}번)로 넘어갈 때 재생됩니다. 개체마다 어디에서 이어지는지 고를 수 있습니다. 이름을 ‘!!’로 시작하는 같은 이름으로 지어도 이어집니다.
            </p>
            {match.warnings.map((w) => (
              <p key={w} className="error-text" data-morph-warning="">
                {w}
              </p>
            ))}
            <table className="morph-link-table">
              <thead>
                <tr>
                  <th>이 슬라이드의 개체</th>
                  <th>앞 슬라이드에서</th>
                  <th>현재</th>
                </tr>
              </thead>
              <tbody>
                {visible(to).map((b) => {
                  const p = pairOf(b);
                  const value = b.morphExclude ? 'none' : b.morphKey && p?.reason === 'morphKey' ? p.from.id : 'auto';
                  return (
                    <tr key={b.id} data-morph-row={b.id}>
                      <td>{label(b)}</td>
                      <td>
                        <select value={value} onChange={(e) => choose(b, e.target.value)} aria-label={`${label(b)} 연결`} data-morph-select={b.id}>
                          <option value="auto">자동</option>
                          <option value="none">연결 안 함 (나타나기)</option>
                          {visible(from).map((a) => (
                            <option key={a.id} value={a.id}>
                              {label(a)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-morph-status={b.id}>
                        {p ? (
                          <>
                            ← {label(p.from)} <span className="muted">({REASON[p.reason]}{p.reason === 'auto' ? ` ${Math.round(p.confidence * 100)}%` : ''})</span>
                            {p.ambiguous && <span className="error-text"> 후보가 여럿 — 확인하세요</span>}
                          </>
                        ) : (
                          <span className="muted">나타남</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {match.gone.length > 0 && <p className="muted">사라지는 개체: {match.gone.map(label).join(', ')}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
