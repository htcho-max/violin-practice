/** 듣고 따라 하기: 조·난이도에 맞춘 짧은 구절 만들기·채점 (midi) */
import { KEYS, keyById, letterOf, octaveOf, midiOf, scalePitch, type Pitch } from './theory';
import { fingerPassage, STRINGS } from './fingering';

export interface EchoLevel { id: string; label: string; desc: string }
/** 난이도: 좁은 음 묶음부터 1포지션 전체, 3포지션까지 */
export const ECHO_LEVELS: EchoLevel[] = [
  { id: 'three', label: '세 음', desc: '으뜸음부터 세 음 (1·2·3음)' },
  { id: 'five', label: '다섯 음', desc: '으뜸음부터 다섯 음' },
  { id: 'oct', label: '한 옥타브', desc: '으뜸음부터 한 옥타브' },
  { id: 'first', label: '1포지션 전체', desc: 'G3~B5, 조의 음만' },
  { id: 'third', label: '3포지션까지', desc: 'G3~D6, 조의 음만' },
];
/** 따라 하기에 쓰는 조 (연습곡과 같은 10개) */
export const ECHO_KEYS = KEYS.map((k) => ({ id: k.id, name: k.name }));

export interface EchoNote { midi: number; name: string }
const SIGN: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 1: '♯', 2: '𝄪' };
/** 조에 맞는 철자 (B♭4, F♯5) */
export const spell = (p: Pitch) => `${letterOf(p.d)}${SIGN[p.alter] ?? ''}${octaveOf(p.d)}`;

const LO = 55, FIRST_HI = 83, THIRD_HI = 86;

/** 조·난이도의 음 묶음 (낮은 음부터). 단조는 화성단음계 (7음 올림) */
export function echoPool(keyId: string, levelId: string): EchoNote[] {
  const key = keyById(keyId);
  const out: EchoNote[] = [];
  const push = (d: number) => { const p = scalePitch(key, d, 1, 'harmonic'); const m = midiOf(p); if (m >= LO) out.push({ midi: m, name: spell(p) }); };
  const n = levelId === 'three' ? 3 : levelId === 'five' ? 5 : levelId === 'oct' ? 8 : 0;
  if (n) { for (let i = 0; i < n; i++) push(key.startD + i); return out; }
  const hi = levelId === 'third' ? THIRD_HI : FIRST_HI;
  // G3 아래 글자부터 훑어서 음역 안의 조 음만
  for (let d = STRINGS[0].d - 1; ; d++) {
    const p = scalePitch(key, d, 1, 'harmonic');
    const m = midiOf(p);
    if (m > hi) break;
    if (m >= LO) out.push({ midi: m, name: spell(p) });
  }
  return out;
}

/** 같은 씨앗이면 같은 구절 (테스트용) */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/**
 * 구절: 첫 음은 아무 음, 다음 음은 대부분 이웃 음(묶음 안에서 1~2칸), 가끔 3칸 도약.
 * 같은 음을 연달아 쓰지 않음 (따라 할 때 음이 나뉘어 들리게).
 */
export function makePhrase<T>(pool: T[], len: number, rand: () => number): T[] {
  if (pool.length < 2) return pool.slice(0, len);
  const out: T[] = [];
  let i = Math.floor(rand() * pool.length);
  out.push(pool[i]);
  while (out.length < len) {
    const r = rand();
    const step = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    let dir = rand() < 0.5 ? -1 : 1;
    if (i + dir * step < 0 || i + dir * step >= pool.length) dir = -dir;
    const j = Math.max(0, Math.min(pool.length - 1, i + dir * step));
    if (j === i) continue;
    i = j;
    out.push(pool[i]);
  }
  return out;
}

export interface EchoResult {
  marks: ('ok' | 'wrong' | 'missing')[];
  played: number[];
  correct: number;
  perfect: boolean;
  /** 맞은 음의 평균 음정 오차 (센트, 절댓값). 센트를 안 주거나 맞은 음이 없으면 null */
  meanAbs: number | null;
}

/**
 * 들은 음(순서대로)과 비교. 같은 음이 이어서 잡히면 하나로 (활 바꿈),
 * 들은 음이 더 많으면 정답과 가장 많이 겹치는 위치를 고름 (앞에 잡음·고쳐 켠 음이 있을 때).
 * cents: played 와 같은 순서의 음정 오차 (있으면 맞은 음의 평균 오차를 셈)
 */
export function scoreEcho(target: number[], played: number[], cents?: number[]): EchoResult {
  const p: number[] = [], pc: (number | undefined)[] = [];
  played.forEach((m, k) => { if (p[p.length - 1] !== m) { p.push(m); pc.push(cents?.[k]); } });
  let off = 0, bestScore = -1;
  for (let o = 0; o <= Math.max(0, p.length - target.length); o++) {
    const sc = p.slice(o, o + target.length).filter((m, k) => m === target[k]).length;
    if (sc > bestScore) { bestScore = sc; off = o; }
  }
  const best = p.slice(off, off + target.length);
  const bestC = pc.slice(off, off + target.length);
  const marks = target.map((m, k) => (best[k] === undefined ? 'missing' : best[k] === m ? 'ok' : 'wrong')) as EchoResult['marks'];
  const correct = marks.filter((x) => x === 'ok').length;
  const okC = marks.map((x, k) => (x === 'ok' ? bestC[k] : undefined)).filter((c): c is number => typeof c === 'number');
  return { marks, played: best, correct, perfect: correct === target.length, meanAbs: okC.length ? okC.reduce((a, c) => a + Math.abs(c), 0) / okC.length : null };
}

/** 연속 결과로 다음 길이: 3번 연속 다 맞으면 +1 (최대 6), 2번 연속 절반 못 맞히면 −1 (최소 3) */
export const ECHO_MIN = 3, ECHO_MAX = 6;
export function nextLength(len: number, history: boolean[], halfFails: number): number {
  const last3 = history.slice(-3);
  if (last3.length === 3 && last3.every(Boolean)) return Math.min(ECHO_MAX, len + 1);
  if (halfFails >= 2) return Math.max(ECHO_MIN, len - 1);
  return len;
}

const STRING_KO = ['G현', 'D현', 'A현', 'E현'];
/** 정답 구절의 운지 (1포지션 위주, '3포지션까지'면 3포지션도). 예 "A현 2", "D현 0" */
export function echoFingers(keyId: string, levelId: string, notes: number[]): string[] {
  const pool = echoPool(keyId, levelId);
  const key = keyById(keyId);
  const pitches = notes.map((m) => {
    for (let d = STRINGS[0].d - 1; d < STRINGS[0].d + 30; d++) { const p = scalePitch(key, d, 1, 'harmonic'); if (midiOf(p) === m) return p; }
    return null;
  });
  if (pitches.some((p) => p === null) || !pool.length) return notes.map(() => '');
  const fs = fingerPassage(pitches as Pitch[], { positions: levelId === 'third' ? [1, 3] : [1] });
  return fs.map((f) => (f ? `${STRING_KO[f.string]} ${f.finger}${f.pos > 1 ? ` (${f.pos}포지션)` : ''}` : ''));
}
