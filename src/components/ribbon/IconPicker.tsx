/** 아이콘 선택 (지연 로딩 청크: lucide 전체 아이콘 포함) */
import { useMemo, useState } from 'react';
import { icons } from 'lucide-react';
import { insertIcon } from '../../editors/icons/iconActions';
import { useEditor } from '../../core/store/editorStore';

const NAMES = Object.keys(icons);
const MAX = 240;

export default function IconPicker({ onDone }: { onDone: () => void }) {
  const accent = useEditor((s) => s.doc.theme.colors.accent1);
  const [q, setQ] = useState('');
  const [color, setColor] = useState(accent);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (k ? NAMES.filter((n) => n.toLowerCase().includes(k)) : NAMES).slice(0, MAX);
  }, [q]);
  return (
    <div className="icon-picker">
      <div className="ip-bar">
        <input className="pp-input" placeholder="영문 검색 (예: chart, user, arrow)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
        <label className="ip-color" title="아이콘 색">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} />
        </label>
      </div>
      <div className="ip-grid">
        {list.map((n) => {
          const Icon = (icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[n];
          return (
            <button key={n} type="button" className="ip-item" title={n} onClick={() => (insertIcon(n, color), onDone())}>
              <Icon size={24} color={color} />
            </button>
          );
        })}
      </div>
      <div className="muted ip-foot">
        {list.length >= MAX ? `처음 ${MAX}개 표시 · 검색으로 좁혀 보세요` : `${list.length}개`} · Lucide 아이콘 (ISC 라이선스)
      </div>
    </div>
  );
}
