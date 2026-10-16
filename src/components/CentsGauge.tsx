interface Props { cents: number | null; label?: string }

/** -50 ~ +50 센트 막대. ±5 초록, ±15 노랑 */
export function CentsGauge({ cents, label }: Props) {
  const c = cents === null ? null : Math.max(-50, Math.min(50, cents));
  const abs = cents === null ? null : Math.abs(cents);
  const tone = abs === null ? 'idle' : abs <= 5 ? 'good' : abs <= 15 ? 'warn' : 'bad';
  const x = c === null ? 50 : 50 + c;
  return (
    <div className={`gauge gauge-${tone}`} aria-label={label ?? '음정 게이지'}>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="gauge-svg">
        <rect x="35" y="0" width="30" height="24" className="gauge-warn-zone" />
        <rect x="45" y="0" width="10" height="24" className="gauge-good-zone" />
        {[-40, -30, -20, -10, 10, 20, 30, 40].map((t) => (
          <line key={t} x1={50 + t} x2={50 + t} y1="17" y2="24" className="gauge-tick" />
        ))}
        <line x1="50" x2="50" y1="0" y2="24" className="gauge-center" />
        {c !== null && <rect x={x - 1} y="0" width="2" height="24" className="gauge-needle" />}
      </svg>
      <div className="gauge-scale"><span>-50</span><span>낮음</span><span>0</span><span>높음</span><span>+50</span></div>
    </div>
  );
}

export function centsText(cents: number | null): string {
  if (cents === null) return '—';
  const r = Math.round(cents);
  return r > 0 ? `+${r}` : `${r}`;
}
