export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_KO: Record<string, string> = {
  C: '도', 'C#': '도#', D: '레', 'D#': '레#', E: '미', F: '파', 'F#': '파#', G: '솔', 'G#': '솔#', A: '라', 'A#': '라#', B: '시',
};

export interface OpenString { name: 'G' | 'D' | 'A' | 'E'; midi: number }
export const OPEN_STRINGS: OpenString[] = [
  { name: 'G', midi: 55 },
  { name: 'D', midi: 62 },
  { name: 'A', midi: 69 },
  { name: 'E', midi: 76 },
];

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidiFloat(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function centsBetween(freq: number, ref: number): number {
  return 1200 * Math.log2(freq / ref);
}

export interface NoteInfo { midi: number; name: string; octave: number; cents: number }

export function freqToNote(freq: number, a4 = 440): NoteInfo {
  const m = freqToMidiFloat(freq, a4);
  const midi = Math.round(m);
  const cents = (m - midi) * 100;
  return { midi, name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents };
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** 가장 가까운 개방현과 그 현 기준 센트 차이 */
export function nearestString(freq: number, a4 = 440): { string: OpenString; cents: number } {
  let best = OPEN_STRINGS[0];
  let bestAbs = Infinity;
  let bestCents = 0;
  for (const s of OPEN_STRINGS) {
    const c = centsBetween(freq, midiToFreq(s.midi, a4));
    if (Math.abs(c) < bestAbs) { bestAbs = Math.abs(c); best = s; bestCents = c; }
  }
  return { string: best, cents: bestCents };
}

/** 드론(으뜸음) 기준 순정률 비율. 반음 수 0~11 */
export const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
export function intervalName(semis: number, octave: number): string {
  if (semis === 0) return octave === 0 ? '같은 음' : '옥타브';
  return INTERVAL_NAMES[semis];
}
export const INTERVAL_NAMES = ['1도', '단2도', '장2도', '단3도', '장3도', '완전4도', '증4도', '완전5도', '단6도', '장6도', '단7도', '장7도'];

/** 으뜸음 기준 순정 음정과의 센트 차이 */
export function justCents(freq: number, rootFreq: number): { semis: number; octave: number; cents: number } {
  const fromRoot = 1200 * Math.log2(freq / rootFreq); // 센트
  const steps = Math.round(fromRoot / 100);
  const octave = Math.floor(steps / 12);
  const semis = ((steps % 12) + 12) % 12;
  const target = rootFreq * Math.pow(2, octave) * JUST_RATIOS[semis];
  return { semis, octave, cents: 1200 * Math.log2(freq / target) };
}
