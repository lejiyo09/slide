import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Popover, usePopover } from '../common/Popover';
import { ColorPanel } from '../common/ColorPicker';

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const commit = (raw: string) => {
    const n = parseFloat(raw);
    setDraft(null);
    if (!Number.isFinite(n)) return;
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return (
    <label className="nf">
      <span className="nf-label">{label}</span>
      <span className="nf-box">
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => draft !== null && commit(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setDraft(null);
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              commit(String(Math.round((value + d) * 1000) / 1000));
            }
          }}
        />
        {unit && <span className="nf-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="pp-section">
      <button type="button" className="pp-section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="pp-section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pp-row">
      <span className="pp-row-label">{label}</span>
      <div className="pp-row-ctrl">{children}</div>
    </div>
  );
}

export function ColorField({ value, onChange, allowNone, title }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean; title: string }) {
  const p = usePopover();
  return (
    <>
      <button ref={p.anchorRef} type="button" className="color-field" title={title} aria-label={title} onClick={p.toggle}>
        <span className="cf-swatch" style={{ background: value ?? 'transparent' }} data-none={!value || undefined} />
        <span className="cf-text">{value ?? '없음'}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={p.open} anchor={p.anchorRef.current} onClose={p.close} placement="bottom-end">
        <ColorPanel allowNone={allowNone} onPick={(c) => (onChange(c), p.close())} />
      </Popover>
    </>
  );
}

export function SliderField({ value, onChange, min = 0, max = 100, unit = '%', onStart, onEnd }: { value: number; onChange: (v: number) => void; min?: number; max?: number; unit?: string; onStart?: () => void; onEnd?: () => void }) {
  return (
    <span className="slider-field">
      <input type="range" min={min} max={max} value={value} onPointerDown={onStart} onPointerUp={onEnd} onChange={(e) => onChange(Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />
      <span className="slider-val">
        {Math.round(value)}
        {unit}
      </span>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T | undefined; options: { value: T; label: ReactNode; title: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? 'is-active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}
