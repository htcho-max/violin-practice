/**
 * 바이올린 운지표 계산: 조에 맞는 음 철자, 음마다 낼 수 있는 자리, 포지션별 손가락 자리,
 * 조별 손가락 모양 ("1 2|3 4"), 지판 위 반음 자리 (실제 줄 길이 비율).
 * 자리 규칙은 포지션 추천(score/fingering.ts)과 같음.
 */
import { CHART_POSITIONS, STRINGS, STRING_NAMES, posBase, posLabel, relSpot, type ChartSpot } from '../score/fingering';
import { keyAlterOf } from '../score/solfa';
import { keyName } from '../score/transpose';

export const LOW = 55; // G3
/** 7포지션 E현 늘린 4번 (규칙상 가장 높은 자리) */
export const HIGH = STRINGS[3] + relSpot(7, 8).semis; // A♯6 = 94

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SIGN: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const SHARP_SPELL: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELL: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** 조 고르기: 장조 12 (fifths) + '반음 모두'(null) */
export type ChartKey = number | null;
export const CHART_KEYS: { id: ChartKey; label: string }[] = [
  { id: null, label: '반음 모두' },
  ...[0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5].map((f) => ({ id: f, label: keyName(f) })),
];

export interface Spelled { midi: number; step: string; alter: number; octave: number }
export const spelledName = (s: { step: string; alter: number; octave: number }) => `${s.step}${SIGN[s.alter]}${s.octave}`;
const pc = (m: number) => ((m % 12) + 12) % 12;
function withOctave(midi: number, step: string, alter: number): Spelled {
  return { midi, step, alter, octave: Math.floor((midi - alter - STEP_PC[step]) / 12) - 1 };
}

/** 그 조의 음계 7음 철자 (pc → 글자·변화표) */
export function scaleOf(fifths: number): Map<number, [string, number]> {
  const m = new Map<number, [string, number]>();
  for (const step of 'CDEFGAB') {
    const a = keyAlterOf(step, fifths);
    m.set(pc(STEP_PC[step] + a), [step, a]);
  }
  return m;
}

/** 음 철자. 조를 고르면 그 조의 음만 (아니면 null), '반음 모두'면 샵으로 */
export function spell(midi: number, key: ChartKey): Spelled | null {
  if (key === null) { const [s, a] = SHARP_SPELL[pc(midi)]; return withOctave(midi, s, a); }
  const hit = scaleOf(key).get(pc(midi));
  return hit ? withOctave(midi, hit[0], hit[1]) : null;
}
/** 반음 모두일 때 검은건반 음의 다른 이름 (C♯ → D♭) */
export function enharmonic(midi: number): Spelled | null {
  const [s, a] = FLAT_SPELL[pc(midi)];
  return a ? withOctave(midi, s, a) : null;
}

export interface NoteRow { note: Spelled; spots: ChartSpot[] }

/** 처음 고른 포지션 (1·3포지션) */
export const DEFAULT_POSITIONS = [1, 3];
/** 고른 포지션 정리: 알맞은 것만, 낮은 것부터, 겹침 없이 (비면 null) */
export function cleanPositions(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = CHART_POSITIONS.filter((p) => v.includes(p));
  return out.length ? out : null;
}
/** 포지션 칩 켜고 끄기 — 마지막 하나는 끌 수 없음 */
export function togglePosition(sel: number[], p: number): number[] {
  if (sel.includes(p)) return sel.length > 1 ? sel.filter((x) => x !== p) : sel;
  return CHART_POSITIONS.filter((x) => x === p || sel.includes(x));
}

/**
 * 한 음을 고른 포지션들에서 낼 수 있는 자리 (개방현은 언제나, ½ 포지션 포함).
 * 낮은 포지션부터, 같은 포지션은 낮은 줄부터 — 개방현은 맨 앞.
 */
export function spotsIn(midi: number, positions: readonly number[] = CHART_POSITIONS): ChartSpot[] {
  const out: ChartSpot[] = [];
  for (let st = 0; st < 4; st++) if (midi === STRINGS[st]) out.push({ string: st, pos: 0, finger: 0, rel: 0, open: true, stretch: false });
  for (const pos of CHART_POSITIONS) {
    if (!positions.includes(pos)) continue;
    for (let st = 0; st < 4; st++) {
      const o = midi - STRINGS[st];
      if (o < 1) continue;
      const rel = o - posBase(pos) + 2;
      if (rel < 1 || rel > 8) continue;
      out.push({ string: st, pos, finger: relSpot(pos, rel).finger, rel, open: false, stretch: rel === 8 });
    }
  }
  return out;
}
/** 음 목록: G3 부터 위로, 고른 조의 음만, 고른 포지션(또는 개방현)에서 낼 수 있는 음만 */
export function noteRows(key: ChartKey, positions: readonly number[] = CHART_POSITIONS): NoteRow[] {
  const out: NoteRow[] = [];
  for (let m = LOW; m <= HIGH; m++) {
    const note = spell(m, key);
    if (!note) continue;
    const spots = spotsIn(m, positions);
    if (spots.length) out.push({ note, spots });
  }
  return out;
}

export const stringLabel = (s: number) => `${STRING_NAMES[s]}현`;
/** 칩 글자: "A현 1st 3", "E현 개방 0", "D현 3rd 4 (늘림)" */
export function spotChip(s: ChartSpot): string {
  if (s.open) return `${stringLabel(s.string)} 개방 0`;
  return `${stringLabel(s.string)} ${posLabel(s.pos)} ${s.finger}${s.stretch ? ' (늘림)' : ''}`;
}
/** 연습 목표 글자: "A현 3포지션 1번 (D5)" */
export function spotTitle(s: ChartSpot, name: string): string {
  if (s.open) return `${stringLabel(s.string)} 개방 (${name})`;
  const p = s.pos === 0.5 ? '½' : String(s.pos);
  return `${stringLabel(s.string)} ${p}포지션 ${s.finger}번${s.stretch ? ' 늘려서' : ''} (${name})`;
}
export const spotMidi = (s: { string: number; pos: number; rel: number; open: boolean }) =>
  STRINGS[s.string] + (s.open ? 0 : relSpot(s.pos, s.rel).semis);

/** 한 포지션의 줄 하나: 손가락 자리 (rel 1~8, ½ 포지션은 개방현과 겹치는 자리 뺌) */
export function positionSpots(pos: number, string: number, key: ChartKey): (ChartSpot & { note: Spelled })[] {
  const out: (ChartSpot & { note: Spelled })[] = [];
  for (let rel = 1; rel <= 8; rel++) {
    const { semis, finger } = relSpot(pos, rel);
    if (semis < 1) continue;
    const note = spell(STRINGS[string] + semis, key);
    if (!note) continue;
    out.push({ string, pos, finger, rel, open: false, stretch: rel === 8, note });
  }
  return out;
}

export interface ShapeFinger { finger: number; rel: number; semis: number; note: Spelled }
/**
 * 조별 손가락 자리 (지판에서 조를 고르면 줄마다 손가락 1~4 하나씩, 반음으로 붙은 손가락은 막대로 이어 보여 줌).
 * 그 포지션 손 모양 안(rel 1~8)의 조 음을 손가락 1~4 에 하나씩.
 * 다섯 개면: 1번 보통 자리가 있으면 낮은 1 을, 아니면 늘린 4 를 뺌.
 * 손가락은 낮은 음부터 차례로 — 1번이 낮은 자리면 손 모양 전체가 내려감 (예: 2포지션 A현 다장조 C D E F = 1 2 3|4).
 */
export function keyShape(fifths: number, pos: number, string: number): ShapeFinger[] {
  let spots = positionSpots(pos, string, fifths);
  const has = (r: number) => spots.some((s) => s.rel === r);
  if (spots.length > 4 && has(1) && has(2)) spots = spots.filter((s) => s.rel !== 1);
  if (spots.length > 4 && has(8)) spots = spots.filter((s) => s.rel !== 8);
  return spots.slice(0, 4).map((s, i) => ({ finger: i + 1, rel: s.rel, semis: relSpot(pos, s.rel).semis, note: s.note }));
}

/** 지판 위 손가락 자리 하나 (그 포지션 안) */
export interface BoardSpot extends ChartSpot { note: Spelled; semis: number }
/** 한 포지션·줄의 지판 자리: 반음 모두면 자리 모두, 조를 고르면 손가락 1~4 하나씩 */
export function boardSpots(pos: number, key: ChartKey, s: number): BoardSpot[] {
  if (key === null) return positionSpots(pos, s, key).map((b) => ({ ...b, semis: spotMidi(b) - STRINGS[s] }));
  return keyShape(key, pos, s).map((f) => ({ string: s, pos, finger: f.finger, rel: f.rel, open: false, stretch: f.rel === 8, note: f.note, semis: f.semis }));
}
/** 고른 포지션들의 자리를 합친 동그라미: 같은 줄·같은 반음은 하나로 (spots 는 낮은 포지션부터, 동그라미 번호 = spots[0]) */
export interface BoardDot { string: number; semis: number; note: Spelled; spots: BoardSpot[] }
export function boardDots(positions: readonly number[], key: ChartKey): BoardDot[] {
  const by = new Map<string, BoardDot>();
  for (const p of CHART_POSITIONS) {
    if (!positions.includes(p)) continue;
    for (let s = 0; s < 4; s++) for (const b of boardSpots(p, key, s)) {
      const k = `${s}:${b.semis}`;
      const d = by.get(k) ?? { string: s, semis: b.semis, note: b.note, spots: [] };
      d.spots.push(b);
      by.set(k, d);
    }
  }
  return [...by.values()].sort((a, b) => a.string - b.string || a.semis - b.semis);
}
/** 조를 고르면 반음으로 붙은 손가락 막대 (포지션마다 이웃한 손가락 · 같은 막대는 하나로) */
export function boardJoins(positions: readonly number[], key: ChartKey): { string: number; from: number; to: number }[] {
  if (key === null) return [];
  const seen = new Set<string>();
  const out: { string: number; from: number; to: number }[] = [];
  for (const p of CHART_POSITIONS) {
    if (!positions.includes(p)) continue;
    for (let s = 0; s < 4; s++) {
      const b = boardSpots(p, key, s);
      for (let i = 1; i < b.length; i++) {
        if (b[i].semis - b[i - 1].semis !== 1) continue;
        const k = `${s}:${b[i - 1].semis}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ string: s, from: b[i - 1].semis, to: b[i].semis });
      }
    }
  }
  return out;
}
/** 지판 띠: 포지션마다 손가락 자리가 닿는 반음 범위 */
export function positionBand(pos: number, key: ChartKey): { pos: number; lo: number; hi: number } | null {
  const all = [0, 1, 2, 3].flatMap((s) => boardSpots(pos, key, s));
  if (!all.length) return null;
  return { pos, lo: Math.min(...all.map((b) => b.semis)), hi: Math.max(...all.map((b) => b.semis)) };
}
/** 자리 설명 글자: 개방현은 "A현 개방", 손가락은 "A현 1st 3" (늘림 표시) */
export const spotShort = (s: ChartSpot) => (s.open ? `${stringLabel(s.string)} 개방` : spotChip(s));

/** 지판: 줄 길이 L 에서 n 반음 자리 (줄감개 쪽 끝 = 0) */
export const fretPos = (n: number, L = 1) => L * (1 - Math.pow(2, -n / 12));

/** 고른 포지션들·조 안에서 무작위 자리 (개방현·늘림 빼고) */
export function randomSpot(positions: readonly number[], key: ChartKey, rnd = Math.random, avoid?: number): (ChartSpot & { note: Spelled }) | null {
  const all = positions.flatMap((p) => [0, 1, 2, 3].flatMap((s) => positionSpots(p, s, key))).filter((s) => !s.stretch);
  const pool = all.length > 1 && avoid !== undefined ? all.filter((s) => spotMidi(s) !== avoid) : all;
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
}

/* ── 한 화면 운지표: 음 자리 강조 · 실시간 점 · 음계 따라 짚기 ── */

/** 한 음을 낼 수 있는 지판 위 자리 (같은 줄 같은 곳은 포지션이 여럿이어도 하나로). 기본은 모든 포지션 */
export interface Hit { string: number; semis: number; open: boolean; spots: ChartSpot[] }
export function noteHits(midi: number, positions: readonly number[] = CHART_POSITIONS): Hit[] {
  const by = new Map<number, Hit>();
  for (const sp of spotsIn(midi, positions)) {
    const h = by.get(sp.string) ?? { string: sp.string, semis: midi - STRINGS[sp.string], open: sp.open, spots: [] };
    h.spots.push(sp);
    by.set(sp.string, h);
  }
  return [...by.values()].sort((a, b) => a.string - b.string);
}
/** 그 자리를 그 포지션에서 짚을 수 있으면 그 자리 (개방현은 어느 포지션에서나) */
export const hitInPos = (h: Hit, pos: number) => h.spots.find((s) => s.open || s.pos === pos) ?? null;
/** 그 자리를 고른 포지션들에서 짚는 방법 (낮은 포지션부터, 개방현은 언제나) */
export const hitIn = (h: Hit, positions: readonly number[]) => h.spots.filter((s) => s.open || positions.includes(s.pos));

/** 지판 보기: 자동이면 넓은 화면(가로 폭 ≥ 720) 또는 가로 방향일 때 가로 */
export type BoardView = 'auto' | 'h' | 'v';
export const autoBoard = (width: number, landscape: boolean): 'h' | 'v' => (width >= 720 || landscape ? 'h' : 'v');

/**
 * 실시간 점을 그릴 줄: 목표가 줄까지 정해졌으면 그 줄,
 * 아니면 들리는 음을 고른 포지션에서 낼 수 있는 줄 (목표 음 자리가 있는 줄 먼저, 그다음 낮은 포지션 손가락 자리, 개방현).
 * 고른 포지션에 없으면 가장 낮은 포지션의 자리, 바이올린 음역 밖이면 null.
 */
export function liveString(midiFloat: number, positions: readonly number[], targetString: number | null, prefer: number[] = []): number | null {
  if (targetString !== null) return targetString;
  const spots = spotsIn(Math.round(midiFloat));
  if (!spots.length) return null;
  const inPos = spots.filter((s) => !s.open && positions.includes(s.pos));
  const pick = inPos.find((s) => prefer.includes(s.string)) ?? inPos[0] ?? spots.find((s) => s.open) ?? spots.find((s) => s.pos >= 1) ?? spots[0];
  return pick.string;
}

/**
 * 음계 따라 짚기: 고른 포지션들·조 안의 음을 낮은 음 → 높은 음.
 * 같은 음은 낮은 포지션 자리 먼저 (같은 포지션은 낮은 줄 · 늘림 빼고), 손가락 자리가 없으면 개방현.
 */
export function scaleRun(positions: readonly number[], key: ChartKey): (ChartSpot & { note: Spelled })[] {
  const by = new Map<number, ChartSpot & { note: Spelled }>();
  const add = (s: ChartSpot & { note: Spelled }) => { if (!by.has(s.note.midi)) by.set(s.note.midi, s); };
  for (const p of CHART_POSITIONS) if (positions.includes(p)) for (let st = 0; st < 4; st++) for (const s of positionSpots(p, st, key)) if (!s.stretch) add(s);
  for (let st = 0; st < 4; st++) {
    const note = spell(STRINGS[st], key);
    if (note) add({ string: st, pos: 0, finger: 0, rel: 0, open: true, stretch: false, note });
  }
  return [...by.values()].sort((a, b) => a.note.midi - b.note.midi);
}
/** 다음 음: 올라가다 끝에서 내려오고, 맨 아래에서 다시 올라감. 목록에 없는 음이면 그 위 가장 가까운 음부터 */
export function nextInRun<T extends { note: { midi: number } }>(run: T[], midi: number | null, dir: 1 | -1): { item: T; dir: 1 | -1 } | null {
  if (!run.length) return null;
  if (run.length === 1) return { item: run[0], dir };
  const i = midi === null ? -1 : run.findIndex((r) => r.note.midi === midi);
  if (i < 0) {
    const up = midi === null ? 0 : run.findIndex((r) => r.note.midi > midi);
    return { item: run[up < 0 ? run.length - 1 : up], dir: up < 0 ? -1 : dir };
  }
  let d = dir;
  if (i + d < 0 || i + d >= run.length) d = (-d) as 1 | -1;
  return { item: run[i + d], dir: d };
}

export { CHART_POSITIONS, posLabel };
