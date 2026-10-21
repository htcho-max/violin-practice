import { type Key, type MinorForm, type Pitch, scalePitch, midiOf } from './theory';
import { options, type FingerOptions, type Fingering, STRINGS } from './fingering';

/** 패턴이 만드는 음. 프레이즈 끝 음은 박에 맞게 늘어나고, 마지막 프레이즈의 끝 음이 마침음 */
export interface PNote { p: Pitch; force?: Fingering }
export type Phrase = PNote[];

const sp = (key: Key, d: number, dir: 1 | -1, form?: MinorForm): PNote => ({ p: scalePitch(key, d, dir, form) });
const range = (a: number, b: number) => { const o: number[] = []; for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) o.push(i); return o; };
const isTonic = (key: Key, d: number) => (d - key.startD) % 7 === 0;
const isTriad = (key: Key, d: number) => [0, 2, 4].includes((((d - key.startD) % 7) + 7) % 7);

export function scale(key: Key, lo: number, hi: number): Phrase[] {
  return [range(lo, hi).map((d) => sp(key, d, 1)), range(hi - 1, lo).map((d) => sp(key, d, -1))];
}
export function arpeggio(key: Key, lo: number, hi: number): Phrase[] {
  const up = range(lo, hi).filter((d) => isTriad(key, d));
  return [up.map((d) => sp(key, d, 1, 'harmonic')), up.slice(0, -1).reverse().map((d) => sp(key, d, -1, 'harmonic'))];
}
/** 음계 악보 (교재 모양): 음계 오르내림 + 으뜸화음 분산화음 오르내림. 단조는 고른 형태로 */
export function scaleSheet(key: Key, lo: number, hi: number, form: MinorForm = 'natural'): Phrase[] {
  const up = range(lo, hi).map((d) => sp(key, d, 1, form));
  const down = range(hi - 1, lo).map((d) => sp(key, d, -1, form));
  const arp = range(lo, hi).filter((d) => isTriad(key, d));
  return [up, down, arp.map((d) => sp(key, d, 1, 'harmonic')), arp.slice(0, -1).reverse().map((d) => sp(key, d, -1, 'harmonic'))];
}
/** 음계 악보 음역: 바이올린 G3(55) ~ E7(100) */
export const SHEET_LO = 55, SHEET_HI = 100;
/** 가장 낮은 G3 위에서 시작하는 으뜸음부터 n옥타브 (으뜸음 → 으뜸음). E7 을 넘으면 null */
export function sheetRange(key: Key, octaves: number): [number, number] | null {
  let lo = -1;
  for (let d = 24; d < 40; d++) if ((((d - key.startD) % 7) + 7) % 7 === 0 && midiOf(scalePitch(key, d, 1)) >= SHEET_LO) { lo = d; break; }
  if (lo < 0) return null;
  const hi = lo + 7 * octaves;
  return midiOf(scalePitch(key, hi, 1)) <= SHEET_HI ? [lo, hi] : null;
}
/** 이 조로 만들 수 있는 가장 많은 옥타브 (1~3) */
export const maxSheetOctaves = (key: Key) => [3, 2, 1].find((n) => sheetRange(key, n)) ?? 1;

/** 3도: 1-3, 2-4, … */
export function thirds(key: Key, lo: number, hi: number): Phrase[] {
  const up: PNote[] = [], down: PNote[] = [];
  for (let d = lo; d + 2 <= hi; d++) up.push(sp(key, d, 1), sp(key, d + 2, 1));
  up.push(sp(key, hi, 1));
  for (let d = hi - 1; d - 2 >= lo; d--) down.push(sp(key, d, -1), sp(key, d - 2, -1));
  down.push(sp(key, lo, -1));
  return [up, down];
}
/** 4음 시퀀스: 1234 2345 … */
export function seq4(key: Key, lo: number, hi: number): Phrase[] {
  const up: PNote[] = [], down: PNote[] = [];
  for (let d = lo; d + 3 <= hi; d++) up.push(...range(d, d + 3).map((x) => sp(key, x, 1)));
  up.push(sp(key, hi, 1));
  for (let d = hi - 1; d - 3 >= lo; d--) down.push(...range(d, d - 3).map((x) => sp(key, x, -1)));
  down.push(sp(key, lo, -1));
  return [up, down];
}
/** 한 현에서 개방현부터 3포지션 4번 손가락까지 */
export function stringScale(key: Key, string: number): Phrase[] {
  const s = STRINGS[string].d;
  return [range(s, s + 6).map((d) => sp(key, d, 1)), range(s + 5, s).map((d) => sp(key, d, -1))];
}
/** 같은 손가락으로 1 ↔ 3 포지션 옮기기 */
export function shiftDrill(key: Key, string: number): Phrase[] {
  const s = STRINGS[string].d;
  const out: Phrase[] = [];
  for (const f of [1, 2, 3]) {
    const a: PNote = { ...sp(key, s + f, 1), force: { string, pos: 1, finger: f } };
    const b: PNote = { ...sp(key, s + f + 2, 1), force: { string, pos: 3, finger: f } };
    out.push([a, b, b, a]);
  }
  out.push([{ p: { d: s, alter: 0 }, force: { string, pos: 0, finger: 0 } }]);
  return out;
}

/** 조·포지션에서 가능한 음역 (으뜸음 → 으뜸음, 안 되면 낼 수 있는 가장 높은 음까지) */
export function autoRange(key: Key, fo: FingerOptions, octaves: number): [number, number] | null {
  const ok = (d: number) => options(scalePitch(key, d, 1), fo).length > 0 && options(scalePitch(key, d, -1), fo).length > 0;
  let lo = -1;
  for (let d = 25; d < 46; d++) if (isTonic(key, d) && ok(d)) { lo = d; break; }
  if (lo < 0) return null;
  for (let o = octaves; o >= 1; o--) if (range(lo, lo + 7 * o).every(ok)) return [lo, lo + 7 * o];
  let hi = lo; while (ok(hi + 1)) hi++;
  return hi - lo >= 4 ? [lo, hi] : null;
}

/* ---------- 에튀드 ---------- */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TEMPLATES: Record<number, { arp: number[]; broken: number[]; scale: number[] }> = {
  2: { arp: [0, 1, 2, 3, 4, 3, 2, 1], broken: [0, 2, 1, 2, 0, 2, 1, 2], scale: [0, 1, 2, 3, 4, 3, 2, 1] },
  3: { arp: [0, 1, 2, 3, 2, 1, 1, 2, 3, 4, 3, 2], broken: [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 2, 1], scale: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, -1] },
  4: { arp: [0, 1, 2, 1, 1, 2, 3, 2, 2, 3, 4, 3, 4, 3, 2, 1], broken: [0, 2, 1, 2, 0, 2, 1, 2, 1, 3, 2, 3, 1, 3, 2, 3], scale: [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1] },
};
export interface EtudeOptions { lo: number; hi: number; perBeat: number; seed: number; fo: FingerOptions; highMiddle?: boolean }

/**
 * 8마디 에튀드: 화성 진행(I IV V I vi ii V I / 단조 i iv V i VI iv V i) 위에 분산화음·음계 음형.
 * 첫 4마디와 다음 3마디는 음형을 바꾸고, highMiddle 이면 5~6마디를 높은 음역(포지션 이동)으로.
 */
export function etude(key: Key, o: EtudeOptions): Phrase[] {
  const r = Math.max(2, Math.min(4, o.perBeat));
  const T = TEMPLATES[r];
  const rand = rng(o.seed);
  const minor = key.mode === 'minor';
  const prog = minor ? [0, 3, 4, 0, 5, 3, 4] : [0, 3, 4, 0, 5, 1, 4];
  const kinds = (['arp', 'broken'] as const);
  const first = kinds[Math.floor(rand() * 2)];
  const second = rand() < 0.5 ? 'scale' : first === 'arp' ? 'broken' : 'arp';
  const playable = (p: Pitch) => options(p, o.fo).length > 0 && midiOf(p) >= 55;
  const form = (deg: number): MinorForm => (minor ? (deg === 4 ? 'harmonic' : 'natural') : 'natural');
  const notes: PNote[] = [];
  let last = o.lo + 2 + Math.floor(rand() * 3);
  prog.forEach((deg, bar) => {
    const kind = bar < 4 ? first : bar < 6 ? second : first;
    const tpl = T[kind];
    const f = form(deg);
    const tones = (d: number) => [0, 2, 4].includes((((d - key.startD - deg) % 7) + 7) % 7);
    const ok = (d: number, dir: 1 | -1) => d >= o.lo && d <= o.hi && playable(scalePitch(key, d, dir, f));
    // 음계 음형이면 온음계 사다리, 아니면 화음 구성음 사다리
    const ladder = range(o.lo, o.hi).filter((d) => (kind === 'scale' || tones(d)) && ok(d, 1) && ok(d, -1));
    const span = Math.max(...tpl) - Math.min(...tpl);
    const minT = Math.min(...tpl);
    const home = o.lo + 3;
    const target = o.highMiddle && (bar === 4 || bar === 5) ? o.hi - 2 : Math.round((last + home) / 2);
    let best = -1, bestCost = Infinity;
    ladder.forEach((d, i) => {
      if (kind === 'scale' && !tones(d)) return; // 음계도 화음 음에서 시작
      if (i + minT < 0 || i + minT + span >= ladder.length) return;
      const root = (((d - key.startD - deg) % 7) + 7) % 7 === 0;
      const cost = Math.abs(d - target) + (bar === 0 && !root ? 10 : 0) + (o.highMiddle && (bar === 4 || bar === 5) ? 0 : rand() * 0.8);
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    if (best < 0) best = Math.max(0, -minT);
    tpl.forEach((t, j) => {
      const d = ladder[Math.max(0, Math.min(ladder.length - 1, best + t))];
      const dir: 1 | -1 = j > 0 && t < tpl[j - 1] ? -1 : 1;
      notes.push({ p: scalePitch(key, d, minor && deg !== 4 ? 1 : dir, minor && deg !== 4 ? 'natural' : f) });
    });
    last = notes[notes.length - 1].p.d;
  });
  // 마침: 마지막 음에서 가장 가까운 으뜸음
  let fin = -1;
  for (let d = o.lo; d <= o.hi; d++) if (isTonic(key, d) && playable(scalePitch(key, d, 1)) && (fin < 0 || Math.abs(d - last) < Math.abs(fin - last))) fin = d;
  return [notes, [sp(key, fin, 1)]];
}
