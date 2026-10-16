/** 음 이름·조성·음계 (악보 철자를 정확히 하려고 온음계 번호로 다룸) */
export const LETTERS = 'CDEFGAB';
const SEMI = [0, 2, 4, 5, 7, 9, 11];

/** d = 옥타브*7 + 글자번호 (C4 = 28), alter = -1/0/+1 */
export interface Pitch { d: number; alter: number }

export const letterOf = (d: number) => LETTERS[((d % 7) + 7) % 7];
export const octaveOf = (d: number) => Math.floor(d / 7);
export const midiOf = (p: Pitch) => 12 * (octaveOf(p.d) + 1) + SEMI[((p.d % 7) + 7) % 7] + p.alter;
export const dOf = (letter: string, octave: number) => octave * 7 + LETTERS.indexOf(letter);
export const pitchName = (p: Pitch) => `${letterOf(p.d)}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${octaveOf(p.d)}`;

export type Mode = 'major' | 'minor';
export interface Key { id: string; name: string; tonic: string; mode: Mode; fifths: number; startD: number }

/** 바이올린 G3 위에서 시작하는 으뜸음 */
export const KEYS: Key[] = [
  { id: 'G', name: 'G장조', tonic: 'G', mode: 'major', fifths: 1, startD: dOf('G', 3) },
  { id: 'D', name: 'D장조', tonic: 'D', mode: 'major', fifths: 2, startD: dOf('D', 4) },
  { id: 'A', name: 'A장조', tonic: 'A', mode: 'major', fifths: 3, startD: dOf('A', 3) },
  { id: 'C', name: 'C장조', tonic: 'C', mode: 'major', fifths: 0, startD: dOf('C', 4) },
  { id: 'F', name: 'F장조', tonic: 'F', mode: 'major', fifths: -1, startD: dOf('F', 4) },
  { id: 'Bb', name: 'B♭장조', tonic: 'B', mode: 'major', fifths: -2, startD: dOf('B', 3) },
  { id: 'Am', name: 'A단조', tonic: 'A', mode: 'minor', fifths: 0, startD: dOf('A', 3) },
  { id: 'Em', name: 'E단조', tonic: 'E', mode: 'minor', fifths: 1, startD: dOf('E', 4) },
  { id: 'Dm', name: 'D단조', tonic: 'D', mode: 'minor', fifths: -1, startD: dOf('D', 4) },
  { id: 'Gm', name: 'G단조', tonic: 'G', mode: 'minor', fifths: -2, startD: dOf('G', 3) },
];
export const keyById = (id: string) => KEYS.find((k) => k.id === id)!;

/** 조표의 변화 */
export function keyAlter(fifths: number, letter: string): number {
  if (fifths > 0) return 'FCGDAEB'.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return 'BEADGCF'.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

/** 단조 형태: 가락(올라갈 때 6·7음 올림) / 화성(7음 올림) / 자연 */
export type MinorForm = 'melodic' | 'harmonic' | 'natural';

/** 온음계 번호 d 에 해당하는 음 (dir: 올라가는 중이면 1, 내려가면 -1) */
export function scalePitch(key: Key, d: number, dir: 1 | -1 = 1, form: MinorForm = 'melodic'): Pitch {
  const letter = letterOf(d);
  let alter = keyAlter(key.fifths, letter);
  if (key.mode === 'minor') {
    const degree = (LETTERS.indexOf(letter) - LETTERS.indexOf(key.tonic) + 7) % 7; // 0 = 으뜸음
    const raise7 = form === 'harmonic' || (form === 'melodic' && dir === 1);
    const raise6 = form === 'melodic' && dir === 1;
    if (degree === 6 && raise7) alter += 1;
    if (degree === 5 && raise6) alter += 1;
  }
  return { d, alter };
}
