import { useEffect, useRef, useState } from 'react';

/** 한글 입력이 끊기지 않도록, 화면 안에서 고치고 잠깐 멈추거나 칸을 벗어나면 저장 */
export function DraftInput({ value, onCommit, label, className, placeholder, multiline }: {
  value: string; onCommit: (v: string) => void; label: string; className?: string; placeholder?: string; multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!editing.current) setDraft(value); }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const schedule = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!composing.current && v !== value) onCommit(v); }, 800);
  };
  const props = {
    value: draft, className, placeholder, 'aria-label': label,
    onFocus: () => { editing.current = true; },
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); schedule(e.target.value); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (e: { currentTarget: { value: string } }) => { composing.current = false; schedule(e.currentTarget.value); },
    onBlur: () => { editing.current = false; if (timer.current) clearTimeout(timer.current); if (draft !== value) onCommit(draft); },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}
