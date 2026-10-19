import { useEffect, useMemo, useState } from 'react';
import { db, type ScoreRun } from '../data/db';
import { runPct } from '../state/useScoreRuns';

type Metric = 'pct' | 'cents' | 'rhythm' | 'bpm';
const METRICS: { id: Metric; label: string; unit: string; better: 'up' | 'down'; get: (r: ScoreRun) => number | null }[] = [
  { id: 'pct', label: '맞은 음', unit: '%', better: 'up', get: (r) => (r.total ? runPct(r) : null) },
  { id: 'cents', label: '음정 오차', unit: '센트', better: 'down', get: (r) => (r.meanAbs === null ? null : Math.round(r.meanAbs)) },
  { id: 'rhythm', label: '박자 오차', unit: 'ms', better: 'down', get: (r) => (r.rhythmMs ? Math.round(r.rhythmMs) : null) },
  { id: 'bpm', label: '템포', unit: '♩', better: 'up', get: (r) => r.bpm ?? null },
];
const overlap = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;
const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

function RecAudio({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, alive = true;
    db.recordings.get(id).then((r) => { if (r && alive) { u = URL.createObjectURL(r.blob); setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <audio controls src={url} preload="metadata" className="player" /> : <p className="muted small">녹음이 지워졌어요.</p>;
}

/** 처음 녹음과 최근 녹음 고르기: 최근 녹음과 구간이 겹치는 가장 오래된 녹음 */
export function pickCompare(runs: ScoreRun[]): { first: ScoreRun; last: ScoreRun } | null {
  const rec = runs.filter((r) => r.recordingId).sort((a, b) => a.createdAt - b.createdAt);
  if (rec.length < 2) return null;
  const last = rec[rec.length - 1];
  const first = rec.find((r) => r !== last && overlap(r, last)) ?? rec[0];
  return first === last ? null : { first, last };
}

/** 곡별 발전 그래프 + 처음/최근 녹음 비교 */
export function ScoreProgress({ runs, from, to }: { runs: ScoreRun[]; from: number; to: number }) {
  const [metric, setMetric] = useState<Metric>('pct');
  const [onlyRange, setOnlyRange] = useState(false);
  const M = METRICS.find((m) => m.id === metric)!;
  const list = useMemo(() => [...runs].filter((r) => !onlyRange || overlap(r, { from, to })).sort((a, b) => a.createdAt - b.createdAt), [runs, onlyRange, from, to]);
  const pts = list.map((r) => ({ r, v: M.get(r) })).filter((p): p is { r: ScoreRun; v: number } => p.v !== null);
  const cmp = useMemo(() => pickCompare(runs), [runs]);
  if (runs.length < 2) return null;
  const W = 320, H = 120, PL = 30, PR = 8, PT = 10, PB = 20;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (metric === 'pct') { lo = Math.min(lo, 50); hi = 100; }
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const x = (i: number) => PL + (pts.length <= 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (pts.length - 1));
  const y = (v: number) => PT + ((hi - v) * (H - PT - PB)) / (hi - lo);
  const first = pts[0]?.v, last = pts[pts.length - 1]?.v;
  const delta = pts.length >= 2 ? last - first : 0;
  const good = M.better === 'up' ? delta > 0 : delta < 0;
  return (
    <div className="card" data-testid="progress-card">
      <div className="card-head"><b>발전 그래프</b><span className="muted small">{pts.length}번</span></div>
      <div className="chips">
        {METRICS.map((m) => <button key={m.id} className={`chip ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>{m.label}</button>)}
      </div>
      <label className="small"><input type="checkbox" checked={onlyRange} onChange={(e) => setOnlyRange(e.target.checked)} /> 지금 구간({from}~{to}마디)과 겹치는 기록만</label>
      {pts.length < 2 ? <p className="muted small">이 값이 있는 기록이 2번 이상 쌓이면 그래프가 나와요.</p> : (
        <>
          <svg className="run-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${M.label} 변화`} data-testid="run-chart">
            {[lo, (lo + hi) / 2, hi].map((v, k) => (
              <g key={k}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="grid" />
                <text x={PL - 4} y={y(v) + 3} className="axis" textAnchor="end">{Math.round(v)}</text>
              </g>
            ))}
            <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="line" fill="none" />
            {pts.map((p, i) => <circle key={p.r.id ?? i} cx={x(i)} cy={y(p.v)} r={pts.length > 30 ? 1.8 : 3} className="dot"><title>{`${md(p.r.createdAt)} ${p.r.from}~${p.r.to}마디 · ${p.v}${M.unit}`}</title></circle>)}
            <text x={PL} y={H - 4} className="axis">{md(pts[0].r.createdAt)}</text>
            <text x={W - PR} y={H - 4} className="axis" textAnchor="end">{md(pts[pts.length - 1].r.createdAt)}</text>
          </svg>
          <p className="small">처음 {first}{M.unit} → 최근 <b>{last}{M.unit}</b>{delta !== 0 && <span className={good ? 'good' : 'bad'}> ({delta > 0 ? '+' : ''}{delta}{M.unit} {good ? '좋아졌어요' : '조금 내려갔어요'})</span>}
            {M.better === 'down' ? <span className="muted"> · 낮을수록 좋아요</span> : null}</p>
        </>
      )}
      {cmp && (
        <div className="rec-compare" data-testid="rec-compare">
          <div>
            <div className="small"><b>처음 녹음</b> <span className="muted">{md(cmp.first.createdAt)} · {cmp.first.from}~{cmp.first.to}마디 · {runPct(cmp.first)}%</span></div>
            <RecAudio id={cmp.first.recordingId!} />
          </div>
          <div>
            <div className="small"><b>최근 녹음</b> <span className="muted">{md(cmp.last.createdAt)} · {cmp.last.from}~{cmp.last.to}마디 · {runPct(cmp.last)}%</span></div>
            <RecAudio id={cmp.last.recordingId!} />
          </div>
        </div>
      )}
    </div>
  );
}
