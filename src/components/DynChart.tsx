import { useMemo } from 'react';
import type { Scored } from '../score/align';
import { dynCompare } from '../score/practice';

/** 채점 결과의 셈여림 비교: 악보 세기(점선)와 내 소리 크기(실선) */
export function DynChart({ result }: { result: Scored[] }) {
  const d = useMemo(() => dynCompare(result), [result]);
  const have = d.points.filter((p) => p.actual !== null).length;
  if (have < 3) return <p className="muted small" data-testid="dyn-chart">소리 크기를 잴 수 있었던 음이 너무 적어요.</p>;
  const W = 320, H = 110, P = 8;
  const n = d.points.length;
  const x = (i: number) => P + (n <= 1 ? 0 : (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => P + (1 - v) * (H - 2 * P);
  // 실제 소리 선은 빈 곳에서 끊기
  const segs: string[] = [];
  let cur: string[] = [];
  for (const p of d.points) {
    if (p.actual === null) { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; continue; }
    cur.push(`${x(p.i)},${y(p.actual)}`);
  }
  if (cur.length > 1) segs.push(cur.join(' '));
  // 마디 경계 표시
  const bars: { i: number; m: number }[] = [];
  d.points.forEach((p, k) => { if (k === 0 || d.points[k - 1].measure !== p.measure) bars.push({ i: p.i, m: p.measure }); });
  const flagged = new Set<number>();
  for (const f of d.flags) d.points.forEach((p) => { if (p.measure >= f.fromMeasure && p.measure <= f.toMeasure) flagged.add(p.i); });
  return (
    <div data-testid="dyn-chart">
      <svg className="run-chart dyn" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="셈여림 비교">
        {bars.map((b) => <g key={b.i}><line x1={x(b.i)} x2={x(b.i)} y1={P} y2={H - P} className="grid" />{bars.length <= 16 && <text x={x(b.i) + 2} y={H - 1} className="axis">{b.m}</text>}</g>)}
        {[...flagged].map((i) => <rect key={i} x={x(i) - (W - 2 * P) / Math.max(1, n - 1) / 2} y={P} width={(W - 2 * P) / Math.max(1, n - 1)} height={H - 2 * P} className="flag" />)}
        <polyline points={d.points.map((p) => `${x(p.i)},${y(p.expected)}`).join(' ')} className="line expected" fill="none" />
        {segs.map((s, k) => <polyline key={k} points={s} className="line" fill="none" />)}
      </svg>
      <p className="small muted"><span className="legend expected">┄ 악보 셈여림</span> <span className="legend">— 내 소리 크기</span></p>
      {d.flags.length === 0 ? <p className="small good">점점 세게·여리게가 소리에 잘 드러났어요.</p> : (
        <ul className="small">
          {d.flags.map((f, k) => (
            <li key={k}>{f.fromMeasure === f.toMeasure ? `${f.fromMeasure}마디` : `${f.fromMeasure}~${f.toMeasure}마디`}: {f.kind === 'cresc' ? '점점 세게' : '점점 여리게'}인데 소리 크기가 {Math.abs(f.actualDb) < 1 ? '거의 그대로' : `${f.actualDb > 0 ? '+' : ''}${f.actualDb.toFixed(1)}dB`}였어요. {f.kind === 'cresc' ? '활을 더 쓰고 브리지 쪽으로 다가가 보세요.' : '활을 덜 쓰고 지판 쪽으로 물러나 보세요.'}</li>
          ))}
        </ul>
      )}
      <p className="hint">마이크 위치에 따라 크기가 달라지니, 같은 자리에서 연주한 기록끼리 비교해요.</p>
    </div>
  );
}
