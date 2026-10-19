/** 연습 기록을 다음 연습으로 잇는 계산들 (화면 없이 순수 함수): 약한 마디, 템포 사다리, 음정 습관, 셈여림 비교 */
import type { ScoreRun } from '../data/db';
import type { Scored } from './align';

/** 채점 결과 한 음 (기록용으로 짧게): [마디, 순서, midi, 센트(정수)|null, 0 맞음·1 다른 음·2 놓침, 소리 크기 dB|null] */
export type RunNote = [number, number, number, number | null, 0 | 1 | 2, number | null];
export const RUN_NOTES_MAX = 600;

export function toRunNotes(rs: Scored[]): RunNote[] {
  return rs.slice(0, RUN_NOTES_MAX).map((r) => [
    r.note.measure, r.note.index, r.note.midi,
    r.status === 'ok' && r.cents !== null ? Math.round(r.cents) : null,
    r.status === 'ok' ? 0 : r.status === 'wrong' ? 1 : 2,
    r.db === undefined || r.db === null ? null : Math.round(r.db * 10) / 10,
  ]);
}

// ── 약한 마디 ──
export interface WeakSpot {
  scoreId: number;
  title: string;
  measure: number;
  /** 맞은 음 비율 0~1 (음 기록이 없는 예전 기록이면 null) */
  okRate: number | null;
  /** 맞은 음의 평균 |센트| */
  meanAbs: number | null;
  /** 이 마디가 들어간 채점 횟수 */
  tries: number;
  /** 클수록 약함 */
  bad: number;
  lastAt: number;
}

/**
 * 한 악보의 최근 기록에서 약한 마디 찾기.
 * - 음 기록(notes)이 있으면: 마디마다 맞은 음 비율과 평균 센트로 판단 (맞은 음 90% 아래 또는 ±15센트 넘음)
 * - 예전 기록이면 weakMeasures 에 두 번 이상 나온 마디
 * - sinceByMeasure: 그 마디의 집중 연습을 끝낸 시각 (그 뒤 기록만 봄)
 */
export function weakSpots(runs: ScoreRun[], opts: { now?: number; days?: number; maxRuns?: number; sinceByMeasure?: Record<number, number>; limit?: number } = {}): WeakSpot[] {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 30, maxRuns = opts.maxRuns ?? 10;
  const recent = runs.filter((r) => now - r.createdAt <= days * 864e5).sort((a, b) => b.createdAt - a.createdAt).slice(0, maxRuns);
  const agg = new Map<number, { n: number; ok: number; cents: number[]; tries: number; weakHits: number; hasNotes: boolean; lastAt: number }>();
  const get = (m: number) => { let a = agg.get(m); if (!a) { a = { n: 0, ok: 0, cents: [], tries: 0, weakHits: 0, hasNotes: false, lastAt: 0 }; agg.set(m, a); } return a; };
  for (const r of recent) {
    const since = (m: number) => opts.sinceByMeasure?.[m] ?? 0;
    if (r.notes?.length) {
      const seen = new Set<number>();
      for (const [m, , , c, st] of r.notes) {
        if (r.createdAt <= since(m)) continue;
        const a = get(m);
        a.hasNotes = true; a.n++; a.lastAt = Math.max(a.lastAt, r.createdAt);
        if (st === 0) { a.ok++; if (c !== null) a.cents.push(Math.abs(c)); }
        if (!seen.has(m)) { seen.add(m); a.tries++; }
      }
    } else if (r.weakMeasures?.length) {
      for (const m of r.weakMeasures) {
        if (r.createdAt <= since(m)) continue;
        const a = get(m); a.weakHits++; a.tries++; a.lastAt = Math.max(a.lastAt, r.createdAt);
      }
    }
  }
  const out: WeakSpot[] = [];
  const first = runs[0];
  for (const [m, a] of agg) {
    if (a.hasNotes) {
      if (a.n < 2) continue;
      const okRate = a.ok / a.n;
      const meanAbs = a.cents.length ? a.cents.reduce((x, y) => x + y, 0) / a.cents.length : null;
      if (okRate >= 0.9 && (meanAbs === null || meanAbs <= 15)) continue;
      const bad = (1 - okRate) * 100 + Math.max(0, (meanAbs ?? 0) - 10);
      out.push({ scoreId: first?.scoreId ?? 0, title: first?.title ?? '', measure: m, okRate, meanAbs, tries: a.tries, bad, lastAt: a.lastAt });
    } else if (a.weakHits >= 2) {
      out.push({ scoreId: first?.scoreId ?? 0, title: first?.title ?? '', measure: m, okRate: null, meanAbs: null, tries: a.tries, bad: 5 * a.weakHits, lastAt: a.lastAt });
    }
  }
  out.sort((x, y) => y.bad - x.bad || x.measure - y.measure);
  return out.slice(0, opts.limit ?? 5);
}

/** 여러 악보에서 가장 약한 마디 몇 개 */
export function topWeakSpots(runs: ScoreRun[], ladders: Record<string, DrillLadder>, limit = 3, now = Date.now()): WeakSpot[] {
  const byScore = new Map<number, ScoreRun[]>();
  for (const r of runs) { const a = byScore.get(r.scoreId) ?? []; a.push(r); byScore.set(r.scoreId, a); }
  const all: WeakSpot[] = [];
  for (const [id, rs] of byScore) {
    const since: Record<number, number> = {};
    for (const [k, l] of Object.entries(ladders)) { const [sid, m] = k.split(':').map(Number); if (sid === id && l.done) since[m] = l.at; }
    all.push(...weakSpots(rs, { now, sinceByMeasure: since }).map((w) => ({ ...w, scoreId: id, title: rs[0].title })));
  }
  return all.sort((a, b) => b.bad - a.bad).slice(0, limit);
}

// ── 템포 사다리 ──
export const LADDER_PCTS = [60, 70, 80, 90, 100];
export interface DrillLadder {
  /** 이 곡의 원래 템포 (100%) */
  base: number;
  /** 지금 칸 (LADDER_PCTS 의 번호) */
  idx: number;
  done: boolean;
  /** 마지막으로 바뀐 시각 */
  at: number;
  tries: number;
}
export const ladderKey = (scoreId: number, measure: number) => `${scoreId}:${measure}`;
export const ladderBpm = (l: DrillLadder) => Math.max(30, Math.round((l.base * LADDER_PCTS[Math.min(l.idx, LADDER_PCTS.length - 1)]) / 100));
export function newLadder(base: number, now = Date.now()): DrillLadder { return { base, idx: 0, done: false, at: now, tries: 0 }; }
/** 통과 기준: 맞은 음 90% 이상, 평균 ±15센트 안 */
export const drillPassed = (pct: number, meanAbs: number | null) => pct >= 90 && (meanAbs === null || meanAbs <= 15);
/** 한 번 채점한 뒤 사다리: 통과하면 한 칸 위로 (100% 통과면 끝), 아니면 같은 칸 */
export function ladderStep(l: DrillLadder, pct: number, meanAbs: number | null, now = Date.now()): { next: DrillLadder; passed: boolean } {
  const passed = drillPassed(pct, meanAbs);
  if (!passed) return { next: { ...l, tries: l.tries + 1, at: now }, passed };
  const last = LADDER_PCTS.length - 1;
  if (l.idx >= last) return { next: { ...l, done: true, tries: l.tries + 1, at: now }, passed };
  return { next: { ...l, idx: l.idx + 1, tries: l.tries + 1, at: now }, passed };
}

// ── 음정 습관 ──
const STRINGS: [string, number][] = [['G현', 55], ['D현', 62], ['A현', 69], ['E현', 76]];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
/** 1포지션 기준 현과 손가락 */
export function stringFinger(midi: number): { string: string; finger: string } {
  let s = STRINGS[0];
  for (const x of STRINGS) if (midi >= x[1]) s = x;
  const off = midi - s[1];
  const finger = off <= 0 ? '개방현' : off <= 2 ? '1번' : off <= 4 ? '2번' : off <= 6 ? '3번' : '4번';
  return { string: s[0], finger };
}
export interface PitchHabit { midi: number; name: string; string: string; finger: string; mean: number; n: number; tip: string }
/** 여러 기록에서 늘 높게·낮게 내는 음 (5번 이상, 평균 ±8센트 넘음) */
export function pitchHabits(runs: ScoreRun[], opts: { minN?: number; minCents?: number; maxRuns?: number } = {}): PitchHabit[] {
  const minN = opts.minN ?? 5, minC = opts.minCents ?? 8;
  const by = new Map<number, number[]>();
  for (const r of [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, opts.maxRuns ?? 40)) {
    for (const [, , midi, c, st] of r.notes ?? []) if (st === 0 && c !== null) { const a = by.get(midi) ?? []; a.push(c); by.set(midi, a); }
  }
  const out: PitchHabit[] = [];
  for (const [midi, cs] of by) {
    if (cs.length < minN) continue;
    // 아주 벗어난 값 몇 개에 끌려가지 않게 가운데 80% 평균
    const s = [...cs].sort((a, b) => a - b);
    const cut = Math.floor(s.length * 0.1);
    const mid = s.slice(cut, s.length - cut || undefined);
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    if (Math.abs(mean) < minC) continue;
    const sf = stringFinger(midi);
    const sign = mean > 0 ? '+' : '';
    const fix = sf.finger === '개방현' ? (mean > 0 ? '줄이 조금 높아요. 조율을 확인해요' : '줄이 조금 낮아요. 조율을 확인해요')
      : mean > 0 ? `${sf.finger} 손가락을 줄감개 쪽으로 조금 내려요` : `${sf.finger} 손가락을 브리지 쪽으로 조금 올려요`;
    out.push({ midi, name: nm(midi), ...sf, mean, n: cs.length, tip: `${nm(midi)}를 평균 ${sign}${Math.round(mean)}센트 ${mean > 0 ? '높게' : '낮게'} — ${fix}` });
  }
  return out.sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
}
/** 이 음이 들어 있는 1포지션 음계 연습곡 조 (없으면 null) */
const SCALE_PC: Record<string, number[]> = {
  G: [7, 9, 11, 0, 2, 4, 6], D: [2, 4, 6, 7, 9, 11, 1], A: [9, 11, 1, 2, 4, 6, 8], C: [0, 2, 4, 5, 7, 9, 11],
  F: [5, 7, 9, 10, 0, 2, 4], Bb: [10, 0, 2, 3, 5, 7, 9], E: [4, 6, 8, 9, 11, 1, 3],
  Am: [9, 11, 0, 2, 4, 5, 6, 7, 8], Dm: [2, 4, 5, 7, 9, 10, 11, 0, 1], Em: [4, 6, 7, 9, 11, 0, 1, 2, 3], Gm: [7, 9, 10, 0, 2, 3, 4, 5, 6],
};
export function scaleHas(key: string, midi: number): boolean { return (SCALE_PC[key] ?? []).includes(((midi % 12) + 12) % 12); }

// ── 셈여림 비교 ──
export interface DynPoint { i: number; measure: number; expected: number; actual: number | null }
export interface DynFlag { kind: 'cresc' | 'dim'; fromMeasure: number; toMeasure: number; expectedDelta: number; actualDb: number }
/** 악보 세기(art.vel)와 실제 소리 크기(dB)를 음 순서대로. 0~1 로 맞춘 값과, 점점 세게·여리게가 소리에 안 드러난 곳 */
export function dynCompare(rs: Scored[]): { points: DynPoint[]; flags: DynFlag[]; hasDyn: boolean } {
  const notes = rs.map((r) => r.note);
  const hasDyn = notes.some((n) => n.art?.vel !== undefined);
  const exp = notes.map((n) => n.art?.vel ?? 0.78);
  const db = rs.map((r) => (r.status === 'ok' && r.db !== undefined && r.db !== null && Number.isFinite(r.db) ? r.db : null));
  // 3음 이동 평균 (빈 값은 건너뜀)
  const sm = db.map((_, i) => {
    const w = [db[i - 1], db[i], db[i + 1]].filter((x): x is number => x !== null && x !== undefined);
    return db[i] === null ? null : w.reduce((a, b) => a + b, 0) / w.length;
  });
  const vals = sm.filter((x): x is number => x !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const elo = Math.min(...exp), ehi = Math.max(...exp);
  const norm = (v: number, a: number, b: number) => (b - a < 1e-6 ? 0.5 : (v - a) / (b - a));
  const points: DynPoint[] = notes.map((n, i) => ({ i, measure: n.measure, expected: norm(exp[i], elo, ehi), actual: sm[i] === null ? null : norm(sm[i]!, lo, hi) }));
  // 악보 세기가 한 방향으로 0.1 이상 바뀌는 구간 (3음 이상)
  const flags: DynFlag[] = [];
  let i = 0;
  while (i < exp.length - 1) {
    const dir = Math.sign(exp[i + 1] - exp[i]);
    if (dir === 0) { i++; continue; }
    let j = i + 1;
    while (j + 1 < exp.length && Math.sign(exp[j + 1] - exp[j]) === dir) j++;
    const dE = exp[j] - exp[i];
    if (j - i >= 2 && Math.abs(dE) >= 0.1) {
      // 구간 앞뒤의 실제 소리 (가장 가까운 값)
      const near = (k: number, step: number) => { for (let t = k; t >= i && t <= j; t += step) if (sm[t] !== null) return sm[t]; return null; };
      const a = near(i, 1), b = near(j, -1);
      if (a !== null && b !== null) {
        const dA = b - a;
        const ok = dir > 0 ? dA >= 2 : dA <= -2;
        if (!ok) flags.push({ kind: dir > 0 ? 'cresc' : 'dim', fromMeasure: notes[i].measure, toMeasure: notes[j].measure, expectedDelta: dE, actualDb: dA });
      }
    }
    i = j;
  }
  return { points, flags, hasDyn };
}

/** 소리 크기 기록 [초, dB] 에서 [a, b] 구간 평균 (없으면 null) */
export function meanDb(track: [number, number][], a: number, b: number): number | null {
  let s = 0, n = 0;
  for (let k = track.length - 1; k >= 0; k--) {
    const [t, d] = track[k];
    if (t < a) break;
    if (t <= b && Number.isFinite(d)) { s += d; n++; }
  }
  return n ? s / n : null;
}

