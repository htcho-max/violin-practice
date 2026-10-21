/** 음 하나를 그리는 작은 오선 (높은음자리표, 덧줄·임시표). OSMD 없이 SVG 로 직접 */
const STEPS = 'CDEFGAB';
const HS = 3.2; // 줄 사이 반 칸
const PAD = 3;
const W = 56;
const E4 = 4 * 7 + 2; // 아래 첫 줄
const F5 = 5 * 7 + 3; // 위 다섯째 줄
const ACC: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 1: '♯', 2: '𝄪' };

/** 높은음자리표 (줄 간격 10 기준, y=0 이 F5 줄, y=30 이 G4 줄) */
const CLEF = 'M12.5,30 C9,30.5 7.5,26 11,23.5 C15.5,20.5 20,25.5 18,31.5 C16,37.5 6,38 3.5,31 C1,23.5 8,16.5 13,9.5 C17,3.5 17.5,-11 13,-12.5 C9.5,-13.5 7.5,-5 8.5,3 L12.5,45 C13,52 6,54 5,49';

export function MiniStaff({ step, alter, octave, title }: { step: string; alter: number; octave: number; title?: string }) {
  const d = octave * 7 + STEPS.indexOf(step);
  // 오선(+자리표 위아래)과 음이 들어가게 위아래를 잘라서 그림
  const top = Math.max(d + 2, F5 + 4), low = Math.min(d - 2, E4 - 4);
  const H = (top - low) * HS + PAD * 2;
  const yOf = (e: number) => PAD + (top - e) * HS;
  const y = yOf(d);
  const x = 40;
  const ledgers: number[] = [];
  for (let e = E4 - 2; e >= d; e -= 2) ledgers.push(e);
  for (let e = F5 + 2; e <= d; e += 2) ledgers.push(e);
  const s = (HS * 2) / 10; // 자리표 크기 (줄 간격 10 → 7)
  return (
    <svg className="mini-staff" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={title ?? `${step}${octave}`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const ly = yOf(E4 + i * 2);
        return <line key={i} x1={1} x2={W - 1} y1={ly} y2={ly} className="ms-line" />;
      })}
      <path d={CLEF} transform={`translate(3 ${yOf(F5)}) scale(${s})`} className="ms-clef" strokeWidth={1.7 / s} />
      {ledgers.map((e) => <line key={e} x1={x - 7} x2={x + 7} y1={yOf(e)} y2={yOf(e)} className="ms-line" />)}
      <ellipse cx={x} cy={y} rx={4.6} ry={3.4} transform={`rotate(-20 ${x} ${y})`} className="ms-head" />
      {alter !== 0 && <text x={x - 7} y={y + (alter < 0 ? 1.5 : 3.6)} textAnchor="end" className="ms-acc">{ACC[alter]}</text>}
    </svg>
  );
}
