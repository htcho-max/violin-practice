import { useEffect, useRef } from 'react';
import { pitchTracker } from '../audio/pitchTracker';
import { PitchSmoother } from '../audio/smooth';
import { midiName } from '../audio/notes';
import { toneOf, type Tolerance, TOLERANCES } from '../score/tolerance';

/** 악보 연주(채점) 중 지금 내는 음: 음 이름 + 작은 바늘. 화면을 매 프레임 다시 그리지 않고 DOM 만 바꿈 */
export function LivePitch({ a4, compact = false, tol = TOLERANCES.normal }: { a4: number; compact?: boolean; tol?: Tolerance }) {
  const nameEl = useRef<HTMLSpanElement>(null);
  const centsEl = useRef<HTMLSpanElement>(null);
  const needle = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sm = new PitchSmoother(a4);
    let shown = '';
    let raf = 0;
    let latest: { midi: number; cents: number } | null = null;
    const paint = () => {
      raf = 0;
      const v = latest;
      const tone = v === null ? 'idle' : toneOf(v.cents, tol);
      if (box.current) box.current.dataset.tone = tone;
      const name = v === null ? '—' : midiName(v.midi);
      if (name !== shown && nameEl.current) { nameEl.current.textContent = name; shown = name; }
      if (centsEl.current) {
        const c = v === null ? null : Math.round(v.cents / 2) * 2; // 2센트 단위로만 숫자가 바뀌게
        centsEl.current.textContent = c === null ? '' : c === 0 ? '0' : `${c > 0 ? '▲' : '▼'}${Math.abs(c)}`;
      }
      if (needle.current) {
        const c = v === null ? 0 : Math.max(-50, Math.min(50, v.cents));
        needle.current.style.left = `${50 + c}%`;
        needle.current.style.opacity = v === null ? '0' : '1';
      }
    };
    const unsub = pitchTracker.subscribe((r) => {
      latest = sm.push(r.time, r.freq);
      if (!raf) raf = requestAnimationFrame(paint);
    });
    return () => { unsub(); if (raf) cancelAnimationFrame(raf); };
  }, [a4, tol]);
  return (
    <span ref={box} className={`live-pitch ${compact ? 'compact' : ''}`} data-tone="idle" data-testid="live-pitch" aria-live="off">
      <span ref={nameEl} className="lp-name">—</span>
      <span className="lp-bar"><span className="lp-zone" style={{ left: `${50 - tol.good}%`, width: `${tol.good * 2}%` }} /><span className="lp-mid" /><span ref={needle} className="lp-needle" /></span>
      <span ref={centsEl} className="lp-cents" />
    </span>
  );
}
