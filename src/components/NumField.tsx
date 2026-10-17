import { useEffect, useRef, useState } from 'react';

/**
 * 숫자 입력: 다 지우고 새로 칠 수 있고, 범위에 맞는 숫자가 되면(잠깐 멈추거나 칸을 벗어나면) 반영.
 * − / + 버튼으로 한 칸씩.
 */
export function NumField({ value, min, max, step = 1, onChange, label, testId, width = 64, disabled = false }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; testId?: string; width?: number; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const valid = (t: string) => /^\d+$/.test(t) && Number(t) >= min && Number(t) <= max;
  const commit = (t: string, final: boolean) => {
    if (valid(t)) { if (Number(t) !== value) onChange(Number(t)); if (final) setDraft(String(Number(t))); }
    else if (final) setDraft(String(value));
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const bump = (d: number) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const base = valid(draft) ? Number(draft) : value;
    const v = Math.max(min, Math.min(max, base + d)); editing.current = false; setDraft(String(v)); if (v !== value) onChange(v); };
  return (
    <span className="numfield">
      <button type="button" className="mini" onClick={() => bump(-step)} disabled={disabled || value <= min} aria-label={`${label} 줄이기`}>−</button>
      <input
        className="num" type="text" inputMode="numeric" pattern="[0-9]*" value={draft} aria-label={label} data-testid={testId} disabled={disabled}
        style={{ width }}
        onFocus={(e) => { editing.current = true; e.currentTarget.select(); }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d]/g, '');
          setDraft(t);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(t, false), 700);
        }}
        onBlur={(e) => { if (timer.current) clearTimeout(timer.current); editing.current = false; commit(e.target.value, true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <button type="button" className="mini" onClick={() => bump(step)} disabled={disabled || value >= max} aria-label={`${label} 늘리기`}>+</button>
    </span>
  );
}
