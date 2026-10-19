import type { ScoreNote } from './parse';

export interface Played { midi: number; cents: number; start: number; /** 그 음의 평균 소리 크기 (dB) */ db?: number | null }
export type Status = 'ok' | 'wrong' | 'missed';
export interface Scored { note: ScoreNote; status: Status; cents: number | null; playedMidi: number | null; /** 연주한 음의 시작 시각(초). 같은 음 묶음은 첫 음만 */ playedStart?: number | null; /** 연주한 음의 소리 크기 (dB) */ db?: number | null }

/**
 * 악보의 음 순서와 연주한 음 순서를 맞추기 (템포와 무관).
 * 같은 음이 연달아 나오면(16분음표 반복 등) 연주에서는 한 음으로 이어질 수 있어서 묶어서 맞춥니다.
 */
export function alignNotes(expected: ScoreNote[], played: Played[]): Scored[] {
  // 1) 같은 음 연속 묶기
  const groups: { midi: number; members: ScoreNote[] }[] = [];
  for (const n of expected) {
    const g = groups[groups.length - 1];
    if (g && g.midi === n.midi) g.members.push(n); else groups.push({ midi: n.midi, members: [n] });
  }
  const P: Played[] = [];
  for (const p of played) {
    const last = P[P.length - 1];
    if (last && last.midi === p.midi) continue; // 연주 쪽도 같은 음 연속은 하나로
    P.push(p);
  }
  const n = groups.length, m = P.length;
  const MATCH = 2, NEAR = -0.5, MIS = -2, GAP = -1;
  const sc = (i: number, j: number) => {
    const d = Math.abs(groups[i].midi - P[j].midi);
    return d === 0 ? MATCH : d === 1 ? NEAR : MIS;
  };
  // 2) Needleman–Wunsch
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const T = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0 대각, 1 위(놓침), 2 왼쪽(군더더기)
  for (let i = 1; i <= n; i++) { S[i][0] = i * GAP; T[i][0] = 1; }
  for (let j = 1; j <= m; j++) { S[0][j] = j * GAP * 0.5; T[0][j] = 2; } // 앞쪽 군더더기는 덜 벌점
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = S[i - 1][j - 1] + sc(i - 1, j - 1);
      const u = S[i - 1][j] + GAP;
      const l = S[i][j - 1] + (i === n ? GAP * 0.5 : GAP);
      if (d >= u && d >= l) { S[i][j] = d; T[i][j] = 0; } else if (u >= l) { S[i][j] = u; T[i][j] = 1; } else { S[i][j] = l; T[i][j] = 2; }
    }
  }
  const res: Scored[][] = Array.from({ length: n }, () => []);
  let i = n, j = m;
  while (i > 0) {
    const t = j === 0 ? 1 : T[i][j];
    if (t === 0) {
      const g = groups[i - 1], p = P[j - 1];
      const same = g.midi === p.midi;
      res[i - 1] = g.members.map((note, k) => ({ note, status: same ? 'ok' : 'wrong', cents: same ? p.cents : null, playedMidi: p.midi, playedStart: k === 0 ? p.start : null, db: p.db ?? null }));
      i--; j--;
    } else if (t === 1) {
      res[i - 1] = groups[i - 1].members.map((note) => ({ note, status: 'missed', cents: null, playedMidi: null }));
      i--;
    } else j--;
  }
  return res.flat();
}

export interface Summary { total: number; ok: number; wrong: number; missed: number; meanAbs: number | null; byMeasure: Map<number, number | null> }
export function summarizeScore(rs: Scored[]): Summary {
  const ok = rs.filter((r) => r.status === 'ok');
  const by = new Map<number, number[]>();
  for (const r of rs) {
    const arr = by.get(r.note.measure) ?? [];
    if (r.status === 'ok') arr.push(Math.abs(r.cents!)); else arr.push(NaN);
    by.set(r.note.measure, arr);
  }
  const byMeasure = new Map<number, number | null>();
  by.forEach((arr, k) => {
    const v = arr.filter((x) => !Number.isNaN(x));
    byMeasure.set(k, v.length && v.length >= arr.length / 2 ? v.reduce((a, b) => a + b, 0) / v.length : null);
  });
  return {
    total: rs.length,
    ok: ok.length,
    wrong: rs.filter((r) => r.status === 'wrong').length,
    missed: rs.filter((r) => r.status === 'missed').length,
    meanAbs: ok.length ? ok.reduce((a, r) => a + Math.abs(r.cents!), 0) / ok.length : null,
    byMeasure,
  };
}
