/**
 * 악보에서 길게 누른 음 → 운지표: 자리(줄·포지션·손가락) 찾기, 조 거르기 정하기, 음 철자.
 */
import { CHART_POSITIONS, chartSpots, type ChartSpot } from '../score/fingering';
import { CHART_KEYS, spell, spotsIn, type ChartKey, type Spelled } from './fingerchart';

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 악보 철자 그대로 (없거나 안 맞으면 샵 철자) */
export function spelledFrom(midi: number, step?: string, alter?: number): Spelled {
  if (step && STEP_PC[step] !== undefined) {
    const a = alter ?? 0;
    const octave = Math.floor((midi - a - STEP_PC[step]) / 12) - 1;
    if ((octave + 1) * 12 + STEP_PC[step] + a === midi) return { midi, step, alter: a, octave };
  }
  return spell(midi, null)!;
}

export interface SpotHint { string?: number; pos?: number; finger?: number }
/**
 * 알려 준 자리에 맞는 운지표 자리. 다 맞는 자리가 없으면 포지션을, 그다음 줄을 빼고 다시.
 * 손가락 0 은 개방현. 아무 것도 없으면 null (음만).
 */
export function spotFromHint(midi: number, hint?: SpotHint | null): ChartSpot | null {
  if (!hint || (hint.string === undefined && hint.pos === undefined && hint.finger === undefined)) return null;
  // 보통 포지션 먼저 (추천·내 표시), ½ 포지션은 맨 뒤
  const all = [...chartSpots(midi, 7), ...spotsIn(midi, [0.5]).filter((s) => !s.open)];
  const match = (h: SpotHint) => all.filter((s) =>
    (h.string === undefined || s.string === h.string)
    && (h.finger === undefined || (h.finger === 0 ? s.open : !s.open && s.finger === h.finger))
    && (h.pos === undefined || s.open || s.pos === h.pos));
  const tries: SpotHint[] = [hint, { ...hint, pos: undefined }, { ...hint, pos: undefined, string: undefined }];
  for (const h of tries) {
    if (h.string === undefined && h.pos === undefined && h.finger === undefined) break;
    const m = match(h);
    if (m.length) return m[0];
  }
  return null;
}

/**
 * 운지표 조 거르기: 지금 조에 그 음이 있으면 그대로,
 * 없으면 악보 조표(fifths)의 장조 (운지표에 있는 조이고 그 음이 있으면), 아니면 '반음 모두'.
 */
export function chartKeyFor(midi: number, current: ChartKey, fifths?: number): ChartKey {
  if (spell(midi, current)) return current;
  if (fifths !== undefined && CHART_KEYS.some((k) => k.id === fifths) && spell(midi, fifths)) return fifths;
  return null;
}

/**
 * 운지표 고른 포지션 맞추기 (켜기만, 끄지는 않음):
 * 자리가 정해졌고 그 포지션이 꺼져 있으면 켬 (개방현은 그대로).
 * 자리가 없으면 — 고른 포지션(또는 개방현)에서 낼 수 있으면 그대로, 아니면 그 음을 낼 수 있는 가장 낮은 포지션을 켬
 * (보통 자리 먼저: ½·늘림은 그것밖에 없을 때만).
 */
export function chartPositionsFor(midi: number, spot: ChartSpot | null, selected: readonly number[]): number[] {
  const sel = CHART_POSITIONS.filter((p) => selected.includes(p));
  const withPos = (p: number) => (sel.includes(p) ? sel : CHART_POSITIONS.filter((x) => x === p || sel.includes(x)));
  if (spot) return !spot.open && CHART_POSITIONS.includes(spot.pos) ? withPos(spot.pos) : sel;
  const all = spotsIn(midi);
  if (!all.length || all.some((s) => s.open || sel.includes(s.pos))) return sel;
  const low = all.filter((s) => s.pos >= 1 && !s.stretch).sort((a, b) => a.pos - b.pos)[0] ?? [...all].sort((a, b) => a.pos - b.pos)[0];
  return withPos(low.pos);
}
