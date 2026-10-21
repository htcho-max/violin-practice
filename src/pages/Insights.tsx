import { useMemo, useState } from 'react';
import { useToday } from '../state/useToday';
import { useSessions } from '../state/useSessions';
import { useScoreRuns } from '../state/useScoreRuns';
import { useEchoRuns } from '../state/useEchoRuns';
import { weeklyTrends, trendWord, type WeekRow } from '../data/insights';

type Key = 'minutes' | 'days' | 'scorePct' | 'scoreCents' | 'rhythmMs' | 'echoPct';
interface Metric { key: Key; title: string; fmt: (v: number) => string; lowerBetter?: boolean; minDiff: number; better: string }
const METRICS: Metric[] = [
  { key: 'minutes', title: '연습 시간', fmt: (v) => `${Math.round(v)}분`, minDiff: 5, better: '' },
  { key: 'days', title: '연습한 날', fmt: (v) => `${Math.round(v)}일`, minDiff: 1, better: '' },
  { key: 'scorePct', title: '악보 맞은 음', fmt: (v) => `${Math.round(v)}%`, minDiff: 2, better: '높을수록 좋아요' },
  { key: 'scoreCents', title: '악보 음정 오차', fmt: (v) => `±${Math.round(v)}센트`, lowerBetter: true, minDiff: 1, better: '낮을수록 좋아요' },
  { key: 'rhythmMs', title: '악보 박자 오차', fmt: (v) => `±${Math.round(v)}ms`, lowerBetter: true, minDiff: 5, better: '낮을수록 좋아요' },
  { key: 'echoPct', title: '따라 하기 맞힌 음', fmt: (v) => `${Math.round(v)}%`, minDiff: 2, better: '높을수록 좋아요' },
];
const wk = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const valOf = (w: WeekRow, k: Key): number | null => w[k];

/** 기록 → 분석: 주별 추이 (음정 습관·곡별 발전 그래프는 오늘·악보 화면에 따로 있음) */
export function Insights() {
  const sessions = useSessions();
  const scoreRuns = useScoreRuns();
  const echoRuns = useEchoRuns();
  const today = useToday();
  const weeks = useMemo(() => weeklyTrends(sessions, scoreRuns, echoRuns, today, 8), [sessions, scoreRuns, echoRuns, today]);
  return (
    <div className="page-sub insights" data-testid="insights">
      <TrendsCard weeks={weeks} />
    </div>
  );
}

function TrendsCard({ weeks }: { weeks: WeekRow[] }) {
  const [table, setTable] = useState(false);
  // 시간·날 수는 0 이면 기록 없음, 비율·오차는 값이 있으면 (0% 도) 보여 줌
  const shown = METRICS.filter((m) => weeks.some((w) => { const v = valOf(w, m.key); return v !== null && (v !== 0 || (m.key !== 'minutes' && m.key !== 'days')); }));
  const anyRuns = weeks.some((w) => w.runs > 0 || w.echoTries > 0);
  return (
    <div className="card" data-testid="trends">
      <div className="card-head"><b>주별 추이 (최근 8주)</b>{shown.length > 0 && <button className="mini" onClick={() => setTable(!table)} data-testid="trends-table">{table ? '그래프로' : '표로'}</button>}</div>
      {shown.length === 0 && <p className="muted small">연습 기록이 쌓이면 주마다 연습 시간과 채점 결과가 여기 보여요.</p>}
      {shown.length > 0 && !anyRuns && <p className="muted small">악보 채점이나 음정 탭의 따라 하기를 하면 주마다 얼마나 늘었는지도 보여요.</p>}
      {shown.length > 0 && (table ? (
        <div className="tbl-wrap">
          <table className="tbl trend-tbl">
            <thead><tr><th>주</th>{shown.map((m) => <th key={m.key}>{m.title}</th>)}<th>채점</th><th>따라 하기</th></tr></thead>
            <tbody>{weeks.map((w) => (
              <tr key={w.start}>
                <td>{wk(w.start)}</td>
                {shown.map((m) => { const v = valOf(w, m.key); return <td key={m.key}>{v === null ? '—' : m.fmt(v)}</td>; })}
                <td>{w.runs ? `${w.runs}번` : '—'}</td>
                <td>{w.echoTries ? `${w.echoPerfect}/${w.echoTries} 정답` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="trend-grid">
          {shown.map((m) => <WeekBars key={m.key} weeks={weeks} m={m} />)}
        </div>
      ))}
      <p className="hint">주는 월요일부터 세요. 막대가 진한 것이 가장 최근 주예요. 음정 오차는 맞은 음의 평균이에요.</p>
    </div>
  );
}

/** 지표 하나: 8주 막대 (한 계열이라 범례 없이 제목으로) */
function WeekBars({ weeks, m }: { weeks: WeekRow[]; m: Metric }) {
  const vals = weeks.map((w) => valOf(w, m.key));
  const max = Math.max(1e-9, ...vals.map((v) => v ?? 0));
  const lastIdx = vals.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
  const prev = lastIdx !== undefined ? vals.slice(0, lastIdx).filter((v): v is number => v !== null).pop() : undefined;
  const tw = m.better ? trendWord(vals, !!m.lowerBetter, m.minDiff) : null;
  const W = 160, H = 44, gap = 2, bw = (W - gap * (weeks.length - 1)) / weeks.length;
  return (
    <div className="trend" data-testid={`trend-${m.key}`}>
      <div className="trend-head">
        <span className="small">{m.title}</span>
        <b>{lastIdx !== undefined ? m.fmt(vals[lastIdx]!) : '—'}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-bars" role="img" aria-label={`${m.title} 주별: ${weeks.map((w, i) => `${wk(w.start)} ${vals[i] === null ? '없음' : m.fmt(vals[i]!)}`).join(', ')}`}>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="axis" />
        {vals.map((v, i) => {
          const h = v === null ? 0 : Math.max(2, (v / max) * (H - 4));
          return (
            <g key={i}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} className="hit"><title>{wk(weeks[i].start)} 주 · {v === null ? '기록 없음' : m.fmt(v)}</title></rect>
              {v !== null && <path d={roundTop(i * (bw + gap), H, bw, h)} className={`bar ${i === lastIdx ? 'now' : ''}`} />}
            </g>
          );
        })}
      </svg>
      <span className="muted small">
        {prev !== undefined ? `지난번 ${m.fmt(prev)}` : ''}
        {prev !== undefined && (tw === 'up' || tw === 'down' || m.better) ? ' · ' : ''}
        {tw === 'up' ? <span className="good">좋아졌어요</span> : tw === 'down' ? <span className="warn">조금 내려갔어요</span> : m.better}
        {prev === undefined && !m.better ? ' ' : ''}
      </span>
    </div>
  );
}
/** 위만 둥근 막대 (아래는 바닥에 붙음) */
function roundTop(x: number, base: number, w: number, h: number) {
  const r = Math.min(3, w / 2, h);
  return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`;
}
