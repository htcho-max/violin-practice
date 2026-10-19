import { freqToMidiFloat } from './notes';

/**
 * 악보 연주 중 실시간 음 보기용: 튜너보다 덜 민감하게.
 * - 바늘(센트)은 지수 평활 (시간 상수 tau 초)
 * - 음 이름은 새 음이 holdSec 동안 이어져야 바뀜 (활 바꿀 때·잡음으로 깜빡이지 않게)
 * - 소리가 silenceSec 넘게 없으면 null
 */
export class PitchSmoother {
  private midi: number | null = null;
  private cents = 0;
  private cand: number | null = null;
  private candSince = 0;
  private lastT = 0;
  private lastHeard = -Infinity;
  constructor(private a4 = 440, private tau = 0.25, private holdSec = 0.12, private silenceSec = 0.35) {}
  setA4(a4: number) { this.a4 = a4; }
  push(t: number, freq: number | null): { midi: number; cents: number } | null {
    const dt = this.lastT ? Math.max(0, Math.min(0.2, t - this.lastT)) : 0;
    this.lastT = t;
    if (freq === null || !(freq > 0)) {
      if (t - this.lastHeard > this.silenceSec) { this.midi = null; this.cand = null; }
      return this.midi === null ? null : { midi: this.midi, cents: this.cents };
    }
    this.lastHeard = t;
    const m = freqToMidiFloat(freq, this.a4);
    const near = Math.round(m);
    if (this.midi === null) { this.midi = near; this.cents = (m - near) * 100; this.cand = null; return { midi: this.midi, cents: this.cents }; }
    // 지금 음에서 반음의 70% 안이면 같은 음으로 (경계에서 왔다 갔다 하지 않게)
    const rel = (m - this.midi) * 100;
    if (Math.abs(rel) <= 70) {
      this.cand = null;
      const a = dt > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
      this.cents += (rel - this.cents) * a;
    } else {
      if (this.cand !== near) { this.cand = near; this.candSince = t; }
      if (t - this.candSince >= this.holdSec) { this.midi = near; this.cents = (m - near) * 100; this.cand = null; }
    }
    return { midi: this.midi, cents: this.cents };
  }
}
