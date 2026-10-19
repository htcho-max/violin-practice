/** 음정 판정 기준: 초록(good) 안, 노랑(warn) 안, 그 밖은 빨강 (센트, 절댓값) */
export type ToleranceId = 'strict' | 'normal' | 'relaxed';
export interface Tolerance { id: ToleranceId; good: number; warn: number; label: string; hint: string }
export const TOLERANCES: Record<ToleranceId, Tolerance> = {
  strict: { id: 'strict', good: 5, warn: 10, label: '엄격', hint: '±5 / ±10센트 — 다듬기·무대 준비' },
  normal: { id: 'normal', good: 10, warn: 20, label: '보통', hint: '±10 / ±20센트 — 기본' },
  relaxed: { id: 'relaxed', good: 15, warn: 30, label: '관대', hint: '±15 / ±30센트 — 새 곡 익히기·입문' },
};
export const tolFor = (id: ToleranceId | undefined): Tolerance => TOLERANCES[id ?? 'normal'] ?? TOLERANCES.normal;
export type Tone = 'good' | 'warn' | 'bad';
export const toneOf = (cents: number, t: Tolerance): Tone => {
  const a = Math.abs(cents);
  return a <= t.good ? 'good' : a <= t.warn ? 'warn' : 'bad';
};
