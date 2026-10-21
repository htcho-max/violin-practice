/**
 * 포지션·손가락 추천 (바이올린). 음마다 (줄, 포지션, 손가락) 후보를 만들고
 * 포지션 이동·줄 건너기·확장을 비용으로 두어 가장 편한 길을 고른다 (비터비).
 * 이동은 개방현·쉼·긴 음 뒤에서 싸게, 이음줄 안에서 비싸게.
 */
export const STRINGS = [55, 62, 69, 76]; // G3 D4 A4 E5
export const STRING_NAMES = ['G', 'D', 'A', 'E'];
/** 포지션마다 1번 손가락이 개방현에서 몇 반음 위인지 (온음 기준, 반 포지션 0.5 → 1) */
const BASE: Record<number, number> = { 0.5: 1, 1: 2, 2: 4, 3: 5, 4: 7, 5: 9, 6: 10, 7: 12 };
/** 1포지션 기준 반음 → 손가락 (1~8: 낮은1 1 낮은2 높은2 3 높은3 4 늘린4) */
const FINGER: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4 };

export interface FingerNote { midi: number; dur?: number; restBefore?: boolean; slurIn?: boolean; fixPos?: number; fixFinger?: number }
export interface Fingering { string: number; pos: number; finger: number }
export interface FingerOpts { maxPos?: number }

interface Cand extends Fingering { cost: number }

export function candidates(midi: number, maxPos = 3, fixPos?: number, fixFinger?: number): Cand[] {
  const out: Cand[] = [];
  const positions = Object.keys(BASE).map(Number).filter((p) => p <= maxPos && p !== 0.5);
  for (let s = 0; s < 4; s++) {
    const o = midi - STRINGS[s];
    if (o < 0) continue;
    if (o === 0) {
      // 개방현: 어느 포지션에서든 (포지션은 이어받음 — 아래에서 처리)
      for (const p of positions) out.push({ string: s, pos: p, finger: 0, cost: p > 1 ? 0.3 : 0 });
      continue;
    }
    for (const p of positions) {
      const rel = o - BASE[p] + 2;
      if (rel < 1 || rel > 8) continue;
      const finger = FINGER[rel];
      let cost = (p - 1) * 0.6 + (p === 2 ? 0.8 : 0) + (rel === 8 ? 2.2 : 0) + (rel === 1 && p > 1 ? 0.6 : 0); // 2포지션은 덜 쓰는 자리
      if (finger === 4 && o === 7 && s < 3) cost += 0.15; // 4번 대신 옆 개방현도 가능
      out.push({ string: s, pos: p, finger, cost });
    }
  }
  return out.filter((c) => (fixPos === undefined || c.finger === 0 || c.pos === fixPos) && (fixFinger === undefined || c.finger === fixFinger));
}

function transition(a: Cand, b: Cand, n: FingerNote, prev: FingerNote): number {
  let c = Math.abs(a.string - b.string) * 0.4 + (Math.abs(a.string - b.string) > 1 ? 0.8 : 0);
  if (a.pos !== b.pos) {
    let shift = 2.5 + Math.abs(BASE[a.pos] - BASE[b.pos]) * 0.25;
    if (a.finger === 0 || b.finger === 0) shift *= 0.35; // 개방현을 타고 옮기기
    if (n.restBefore || (prev.dur ?? 0) >= 1) shift *= 0.6; // 쉼·긴 음 뒤
    if (n.slurIn) shift *= 1.3; // 이음줄 안
    c += shift;
  }
  // 같은 손가락으로 다른 음을 연달아 (미끄러짐)
  if (a.finger && a.finger === b.finger && a.string === b.string && prev.midi !== n.midi) c += 0.8;
  return c;
}

/** 음 목록 → 음마다 추천 (치기 어려운 음은 null) */
export function recommend(notes: FingerNote[], opts: FingerOpts = {}): (Fingering | null)[] {
  const maxPos = opts.maxPos ?? 3;
  const cands = notes.map((n) => candidates(n.midi, Math.max(maxPos, n.fixPos ?? 0), n.fixPos, n.fixFinger));
  const res: (Fingering | null)[] = new Array(notes.length).fill(null);
  // 칠 수 없는 음(G3 아래·너무 높음)으로 끊어 구간마다
  let i = 0;
  while (i < notes.length) {
    if (!cands[i].length) { i++; continue; }
    let j = i;
    while (j < notes.length && cands[j].length) j++;
    const cost: number[][] = [], back: number[][] = [];
    cost[i] = cands[i].map((c) => c.cost);
    back[i] = cands[i].map(() => -1);
    for (let k = i + 1; k < j; k++) {
      cost[k] = []; back[k] = [];
      cands[k].forEach((b, bi) => {
        let best = Infinity, arg = 0;
        cands[k - 1].forEach((a, ai) => {
          const v = cost[k - 1][ai] + transition(a, b, notes[k], notes[k - 1]);
          if (v < best) { best = v; arg = ai; }
        });
        cost[k][bi] = best + b.cost; back[k][bi] = arg;
      });
    }
    let bi = cost[j - 1].indexOf(Math.min(...cost[j - 1]));
    for (let k = j - 1; k >= i; k--) {
      const c = cands[k][bi];
      res[k] = { string: c.string, pos: c.pos, finger: c.finger };
      bi = back[k][bi];
    }
    i = j;
  }
  // 개방현은 앞뒤 포지션을 이어받아 보여 줌 (포지션 표시가 개방현에서 끊기지 않게)
  for (let k = 1; k < res.length; k++) { const r = res[k], p = res[k - 1]; if (r && p && r.finger === 0) r.pos = p.pos; }
  return res;
}

export const posLabel = (p: number) => (p === 0.5 ? '½' : ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][p] ?? String(p));
