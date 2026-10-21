import type { EchoRun, ScoreRun, Session } from './db';
import { addDays } from './dates';

/* ---------------- 주별 추이 ---------------- */

export interface WeekRow {
  /** 그 주 월요일 */
  start: string;
  /** 연습 시간 (분) */
  minutes: number;
  /** 연습한 날 수 */
  days: number;
  /** 악보 채점: 맞은 음 % (한 번에 4음 이상인 채점의 평균) */
  scorePct: number | null;
  /** 악보 채점: 평균 음정 오차 (센트, 절댓값) */
  scoreCents: number | null;
  /** 악보 채점: 박자 오차 (ms) */
  rhythmMs: number | null;
  /** 악보 채점 횟수 */
  runs: number;
  /** 따라 하기: 맞힌 음 % · 다 맞힌 문제 수 / 문제 수 */
  echoPct: number | null;
  echoPerfect: number;
  echoTries: number;
}

export const mondayOf = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  const dow = (new Date(y, m - 1, day).getDay() + 6) % 7;
  return addDays(d, -dow);
};

/** 최근 weeks 주 (오래된 주부터, 마지막이 이번 주) */
export function weeklyTrends(
  sessions: Pick<Session, 'date' | 'totalSec'>[],
  scoreRuns: Pick<ScoreRun, 'date' | 'ok' | 'total' | 'durationSec' | 'inSession' | 'meanAbs' | 'rhythmMs'>[],
  echoRuns: Pick<EchoRun, 'date' | 'hits' | 'expected'>[],
  today: string,
  weeks = 8,
): WeekRow[] {
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  const end = addDays(first, 7 * weeks);
  const rows: WeekRow[] = Array.from({ length: weeks }, (_, i) => ({ start: addDays(first, 7 * i), minutes: 0, days: 0, scorePct: null, scoreCents: null, rhythmMs: null, runs: 0, echoPct: null, echoPerfect: 0, echoTries: 0 }));
  const idx = (d: string) => {
    if (d < first || d >= end) return -1;
    for (let k = rows.length - 1; k >= 0; k--) if (d >= rows[k].start) return k;
    return -1;
  };
  const acc = rows.map(() => ({ sec: 0, dates: new Set<string>(), pct: [] as number[], cents: [] as number[], rhy: [] as number[], echo: [0, 0] }));
  for (const s of sessions) { const i = idx(s.date); if (i >= 0) { acc[i].sec += s.totalSec; if (s.totalSec > 0) acc[i].dates.add(s.date); } }
  for (const r of scoreRuns) {
    const i = idx(r.date); if (i < 0) continue;
    // 세션 안에서 한 채점은 시간이 이미 세션에 들어 있음
    if (!r.inSession) { acc[i].sec += r.durationSec; acc[i].dates.add(r.date); }
    rows[i].runs++;
    if (r.total >= 4) {
      acc[i].pct.push((r.ok / r.total) * 100);
      if (typeof r.meanAbs === 'number') acc[i].cents.push(r.meanAbs);
      if (typeof r.rhythmMs === 'number' && r.rhythmMs > 0) acc[i].rhy.push(r.rhythmMs);
    }
  }
  for (const r of echoRuns) {
    const i = idx(r.date); if (i < 0) continue;
    acc[i].echo[0] += r.hits; acc[i].echo[1] += r.expected;
    rows[i].echoTries++;
    if (r.hits === r.expected) rows[i].echoPerfect++;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  rows.forEach((r, i) => {
    r.minutes = Math.round(acc[i].sec / 60);
    r.days = acc[i].dates.size;
    r.scorePct = mean(acc[i].pct);
    r.scoreCents = mean(acc[i].cents);
    r.rhythmMs = mean(acc[i].rhy);
    r.echoPct = acc[i].echo[1] ? (acc[i].echo[0] / acc[i].echo[1]) * 100 : null;
  });
  return rows;
}

/** 이번 주와 지난 기록 있는 주를 비교한 한 줄 (좋아졌는지). lowerBetter 면 작을수록 좋음 */
export function trendWord(vals: (number | null)[], lowerBetter: boolean, minDiff: number): 'up' | 'down' | 'same' | null {
  const have = vals.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
  if (have.length < 2) return null;
  const d = have[have.length - 1][0] - have[have.length - 2][0];
  if (Math.abs(d) < minDiff) return 'same';
  return (d > 0) !== lowerBetter ? 'up' : 'down';
}
