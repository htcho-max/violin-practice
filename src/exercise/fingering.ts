import { midiOf, type Pitch } from './theory';

/** 바이올린 개방현 (온음계 번호, midi) */
export const STRINGS = [
  { name: 'G', d: 25, midi: 55 },
  { name: 'D', d: 29, midi: 62 },
  { name: 'A', d: 33, midi: 69 },
  { name: 'E', d: 37, midi: 76 },
];

export interface Fingering { string: number; pos: number; finger: number } // finger 0 = 개방현

export interface FingerOptions {
  positions: number[]; // 쓸 수 있는 포지션 (예: [1], [3], [1, 3])
  strings?: number[]; // 이 현만 (포지션 연습용)
  allowOpen?: boolean;
}

/** 한 음을 낼 수 있는 모든 방법 */
export function options(p: Pitch, o: FingerOptions): Fingering[] {
  const out: Fingering[] = [];
  const m = midiOf(p);
  STRINGS.forEach((s, si) => {
    if (o.strings && !o.strings.includes(si)) return;
    const k = p.d - s.d; // 개방현에서 몇 번째 음
    if (k < 0 || m < s.midi) return;
    if (k === 0 && m === s.midi) { if (o.allowOpen !== false) out.push({ string: si, pos: 0, finger: 0 }); return; }
    for (const pos of o.positions) {
      const f = k - (pos - 1);
      if (f >= 1 && f <= 4) out.push({ string: si, pos, finger: f });
    }
  });
  return out;
}

/**
 * 이동이 가장 적은 운지 (동적 계획법).
 * 비용: 포지션 이동 3 + 거리, 현 바꿈 0.4/현, 높은 포지션 0.25/칸, 높은 포지션에서 개방현 0.6
 */
export function fingerPassage(ps: Pitch[], o: FingerOptions): (Fingering | null)[] {
  const opts = ps.map((p) => options(p, o));
  type Cell = { cost: number; prev: number; pos: number };
  const table: Cell[][] = [];
  opts.forEach((list, i) => {
    table.push(list.map((f) => {
      let best: Cell = { cost: Infinity, prev: -1, pos: f.pos || o.positions[0] };
      const own = (f.pos > 1 ? 0.25 * (f.pos - 1) : 0) + (f.finger === 4 ? 0.05 : 0);
      if (i === 0 || table[i - 1].length === 0) {
        const start = f.finger === 0 ? Math.min(...o.positions) : f.pos;
        best = { cost: own + (start > 1 ? 1 : 0), prev: -1, pos: start };
      } else {
        table[i - 1].forEach((c, j) => {
          const pf = opts[i - 1][j];
          const pos = f.finger === 0 ? c.pos : f.pos;
          const shift = pos !== c.pos ? 3 + Math.abs(pos - c.pos) : 0;
          const cross = 0.4 * Math.abs(f.string - pf.string);
          const openHigh = f.finger === 0 && c.pos > 1 ? 0.6 : 0;
          const cost = c.cost + own + shift + cross + openHigh;
          if (cost < best.cost) best = { cost, prev: j, pos };
        });
      }
      return best;
    }));
  });
  const out: (Fingering | null)[] = ps.map(() => null);
  let i = ps.length - 1;
  while (i >= 0 && table[i].length === 0) i--;
  if (i < 0) return out;
  let j = table[i].reduce((b, c, k) => (c.cost < table[i][b].cost ? k : b), 0);
  for (; i >= 0; i--) {
    if (table[i].length === 0) continue;
    const f = opts[i][j];
    out[i] = { ...f, pos: f.finger === 0 ? 0 : f.pos };
    j = table[i][j].prev;
    if (j < 0) break;
  }
  return out;
}

/** 실제 손의 포지션 (개방현은 앞 음의 포지션을 유지) */
export function handPositions(fs: (Fingering | null)[], first = 1): number[] {
  let cur = first;
  return fs.map((f) => { if (f && f.pos > 0) cur = f.pos; return cur; });
}
