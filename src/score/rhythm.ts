import type { ParsedScore } from './parse';
import type { Scored } from './align';

/**
 * 박자 채점 (템포와 상관없이).
 * 연주한 음의 시작 시각을 악보 위치(4분음표 단위)에 맞춰 직선으로 맞춘 뒤, 직선에서 벗어난 만큼을 박자 오차로 봅니다.
 * 앞뒤 2마디 정도만 써서(국소 회귀) 천천히 빨라지거나 느려지는 건 봐주고, 그 음만 당기거나 끄는 걸 잡아요.
 * 자기 자신은 빼고 맞춰서(leave-one-out) 혼자 튀는 음이 직선에 묻히지 않게 합니다.
 */
export interface RhythmNote { key: string; measure: number; q: number; err: number } // err: 4분음표 단위 (+ 늦음)
export interface RhythmResult {
  bpm: number;
  notes: RhythmNote[];
  meanAbs: number; // 4분음표 단위
  meanAbsMs: number;
  byMeasure: Map<number, number>;
  /** 앞 절반 대비 뒤 절반 템포 변화 (+ 빨라짐), 비율 */
  drift: number | null;
}

/** 각 마디 시작의 4분음표 위치 */
export function measureStarts(s: ParsedScore): Map<number, number> {
  const out = new Map<number, number>();
  let acc = 0;
  for (const m of s.measures) { out.set(m, acc); acc += s.measureLen.get(m) ?? 4; }
  return out;
}

function fit(pts: { x: number; y: number; w: number }[]) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; sxx += p.w * p.x * p.x; sxy += p.w * p.x * p.y; }
  const d = sw * sxx - sx * sx;
  if (sw <= 0 || Math.abs(d) < 1e-12) return null;
  const b = (sw * sxy - sx * sy) / d;
  return { a: (sy - b * sx) / sw, b };
}

export function analyzeRhythm(s: ParsedScore, rs: Scored[], window = 8): RhythmResult | null {
  const starts = measureStarts(s);
  const pts = rs
    .filter((r) => r.status !== 'missed' && r.playedStart != null && starts.has(r.note.measure))
    .map((r) => ({ key: `${r.note.measure}:${r.note.index}`, measure: r.note.measure, x: starts.get(r.note.measure)! + r.note.beat, y: r.playedStart! }))
    .sort((a, b) => a.x - b.x);
  // 같은 위치 중복 제거, 시간이 거꾸로 가는 점(맞추기 실수) 제거
  const P = pts.filter((p, i) => i === 0 || (p.x > pts[i - 1].x && p.y > pts[i - 1].y));
  if (P.length < 4) return null;
  const g = fit(P.map((p) => ({ x: p.x, y: p.y, w: 1 })));
  if (!g || g.b <= 0) return null;
  // 1차 국소 회귀 → 크게 벗어난 점은 무게를 줄여 2차
  const local = (i: number, weights: number[]) => {
    let W = window;
    let near: { x: number; y: number; w: number }[] = [];
    for (let t = 0; t < 4; t++, W *= 1.6) {
      near = P.map((p, j) => ({ x: p.x, y: p.y, w: j === i || Math.abs(p.x - P[i].x) > W ? 0 : weights[j] * (1 - Math.abs(p.x - P[i].x) / (W * 1.01)) }));
      if (near.filter((p) => p.w > 0).length >= 4) break;
    }
    const f = fit(near) ?? g;
    const b = f.b > g.b * 0.5 && f.b < g.b * 2 ? f.b : g.b;
    const a = f.b === b ? f.a : P[i].y - g.b * P[i].x;
    return (P[i].y - (a + b * P[i].x)) / b;
  };
  let w = P.map(() => 1);
  let err = P.map((_, i) => local(i, w));
  const med = [...err].map(Math.abs).sort((a, b) => a - b)[Math.floor(err.length / 2)];
  w = err.map((e) => (Math.abs(e) > Math.max(0.1, 3 * med) ? 0.1 : 1));
  err = P.map((_, i) => local(i, w));
  const notes = P.map((p, i) => ({ key: p.key, measure: p.measure, q: p.x, err: err[i] }));
  const by = new Map<number, number[]>();
  notes.forEach((n) => by.set(n.measure, [...(by.get(n.measure) ?? []), Math.abs(n.err)]));
  const byMeasure = new Map<number, number>();
  by.forEach((v, k) => byMeasure.set(k, v.reduce((a, b) => a + b, 0) / v.length));
  const meanAbs = notes.reduce((a, n) => a + Math.abs(n.err), 0) / notes.length;
  // 템포 변화: 앞 절반 · 뒤 절반 각각 직선
  let drift: number | null = null;
  const mid = Math.floor(P.length / 2);
  if (P.length >= 8) {
    const f1 = fit(P.slice(0, mid).map((p) => ({ ...p, w: 1 }))), f2 = fit(P.slice(mid).map((p) => ({ ...p, w: 1 })));
    if (f1 && f2 && f1.b > 0 && f2.b > 0) drift = f1.b / f2.b - 1;
  }
  return { bpm: 60 / g.b, notes, meanAbs, meanAbsMs: meanAbs * g.b * 1000, byMeasure, drift };
}

/** 박자 오차 색 (4분음표 단위) */
export const rhythmTone = (e: number) => (Math.abs(e) <= 0.06 ? 'good' : Math.abs(e) <= 0.12 ? 'warn' : 'bad');
