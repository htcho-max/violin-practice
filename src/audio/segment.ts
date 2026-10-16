import { freqToMidiFloat } from './notes';

/** 한 음의 분석 결과 */
export interface NoteEvent {
  midi: number;
  start: number; // 초
  end: number;
  meanCents: number; // 전체 평균 (기준 대비)
  arrivalCents: number; // 도착 직후(ARRIVAL 구간) 평균
  settledCents: number | null; // 안정 구간 평균 (음이 짧으면 null)
  corrected: boolean; // 도착 뒤 손가락을 고쳐 잡았는지
}

/** 기준 음정 함수: 주파수 → 가장 가까운 목표 음과 그 음 대비 센트 */
export type Reference = (freq: number) => { midi: number; cents: number };

export const equalRef = (a4: number): Reference => (freq) => {
  const m = freqToMidiFloat(freq, a4);
  const midi = Math.round(m);
  return { midi, cents: (m - midi) * 100 };
};

const MIN_NOTE = 0.15; // 이보다 짧으면 음으로 치지 않음
const SKIP = 0.05; // 시작 직후 활 잡음 구간은 제외
const ARRIVAL = 0.3; // 도착 음정 구간
const CORRECTED = 10; // 도착과 안정 음정 차이가 이 이상이면 "고쳐 잡음"
const GAP = 0.12; // 이만큼 소리가 끊기면 음 끝

interface Point { t: number; cents: number }

/**
 * 실시간 음높이 → 음 단위로 나누기.
 * 같은 목표 음이 이어지면 한 음, 다른 음으로 바뀌거나 소리가 끊기면 끝.
 */
export class NoteSegmenter {
  private cur: { midi: number; pts: Point[]; last: number } | null = null;
  private pending: { midi: number; pts: Point[] } | null = null;

  constructor(private ref: Reference) {}

  setReference(ref: Reference) { this.ref = ref; }

  /** freq = null 이면 무음. 끝난 음이 있으면 돌려줌 */
  push(t: number, freq: number | null): NoteEvent | null {
    if (freq === null) {
      if (this.cur && t - this.cur.last > GAP) return this.close();
      return null;
    }
    const { midi, cents } = this.ref(freq);
    if (this.cur && this.cur.midi === midi) {
      this.cur.pts.push({ t, cents });
      this.cur.last = t;
      this.pending = null;
      return null;
    }
    // 다른 음: 3프레임 이상 이어질 때만 바뀐 것으로 (잠깐 튀는 값 무시)
    if (!this.pending || this.pending.midi !== midi) this.pending = { midi, pts: [] };
    this.pending.pts.push({ t, cents });
    if (this.cur && this.pending.pts.length < 3) return null;
    const done = this.cur ? this.close() : null;
    this.cur = { midi, pts: this.pending.pts, last: t };
    this.pending = null;
    return done;
  }

  flush(): NoteEvent | null { return this.cur ? this.close() : null; }

  private close(): NoteEvent | null {
    const c = this.cur!;
    this.cur = null;
    const start = c.pts[0].t;
    const end = c.last;
    if (end - start < MIN_NOTE) return null;
    const body = c.pts.filter((p) => p.t >= start + SKIP);
    const arr = body.filter((p) => p.t < start + ARRIVAL);
    const set = body.filter((p) => p.t >= start + ARRIVAL);
    const mean = (ps: Point[]) => ps.reduce((a, p) => a + p.cents, 0) / ps.length;
    const meanCents = mean(body.length ? body : c.pts);
    const arrivalCents = arr.length ? mean(arr) : meanCents;
    const settledCents = set.length >= 3 ? mean(set) : null;
    const corrected = settledCents !== null && Math.abs(arrivalCents - settledCents) >= CORRECTED;
    return { midi: c.midi, start, end, meanCents, arrivalCents, settledCents, corrected };
  }
}

/** 음별 평균 오차 요약 (오차 큰 순) */
export interface NoteSummary { midi: number; count: number; meanCents: number; meanAbs: number }
export function summarize(notes: NoteEvent[]): NoteSummary[] {
  const m = new Map<number, number[]>();
  for (const n of notes) {
    const v = n.settledCents ?? n.meanCents;
    m.set(n.midi, [...(m.get(n.midi) ?? []), v]);
  }
  return [...m.entries()]
    .map(([midi, vs]) => ({
      midi,
      count: vs.length,
      meanCents: vs.reduce((a, b) => a + b, 0) / vs.length,
      meanAbs: vs.reduce((a, b) => a + Math.abs(b), 0) / vs.length,
    }))
    .sort((a, b) => b.meanAbs - a.meanAbs);
}

/** 드론 으뜸음 기준 순정률. midi 는 가장 가까운 평균율 음(이름 표시용) */
export const justRef = (rootMidi: number, a4: number, ratios: number[]): Reference => {
  const rootFreq = a4 * Math.pow(2, (rootMidi - 69) / 12);
  return (freq) => {
    const fromRoot = 1200 * Math.log2(freq / rootFreq);
    const steps = Math.round(fromRoot / 100);
    const octave = Math.floor(steps / 12);
    const semis = ((steps % 12) + 12) % 12;
    const target = rootFreq * Math.pow(2, octave) * ratios[semis];
    return { midi: rootMidi + steps, cents: 1200 * Math.log2(freq / target) };
  };
};
