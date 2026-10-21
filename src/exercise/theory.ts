/** 음 이름·조성·음계 (악보 철자를 정확히 하려고 온음계 번호로 다룸) */
export const LETTERS = 'CDEFGAB';
const SEMI = [0, 2, 4, 5, 7, 9, 11];

/** d = 옥타브*7 + 글자번호 (C4 = 28), alter = -1/0/+1 */
export interface Pitch { d: number; alter: number }

export const letterOf = (d: number) => LETTERS[((d % 7) + 7) % 7];
export const octaveOf = (d: number) => Math.floor(d / 7);
export const midiOf = (p: Pitch) => 12 * (octaveOf(p.d) + 1) + SEMI[((p.d % 7) + 7) % 7] + p.alter;
export const dOf = (letter: string, octave: number) => octave * 7 + LETTERS.indexOf(letter);
/** 겹올림(alter 2)은 ##, 겹내림(-2)은 bb */
export const pitchName = (p: Pitch) => `${letterOf(p.d)}${p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : ''}${octaveOf(p.d)}`;

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
/** 음계 악보용 24조 (교재 순서: 5도권을 내림 쪽으로). startD 는 으뜸음 글자 자리만 뜻함 (음역은 sheetRange 가 정함) */
const K = (id: string, name: string, tonic: string, mode: Mode, fifths: number): Key => ({ id, name, tonic, mode, fifths, startD: dOf(tonic, 4) });
export const MAJOR_KEYS: Key[] = [
  K('C', 'C장조', 'C', 'major', 0), K('F', 'F장조', 'F', 'major', -1), K('Bb', 'B♭장조', 'B', 'major', -2), K('Eb', 'E♭장조', 'E', 'major', -3),
  K('Ab', 'A♭장조', 'A', 'major', -4), K('Db', 'D♭장조', 'D', 'major', -5), K('F#', 'F♯장조', 'F', 'major', 6), K('B', 'B장조', 'B', 'major', 5),
  K('E', 'E장조', 'E', 'major', 4), K('A', 'A장조', 'A', 'major', 3), K('D', 'D장조', 'D', 'major', 2), K('G', 'G장조', 'G', 'major', 1),
];
/** 단조는 나란한조(같은 조표)끼리 같은 자리에. 으뜸음의 변화(B♭단조의 B♭ …)는 조표가 정해 줌 */
export const MINOR_KEYS: Key[] = [
  K('Am', 'A단조', 'A', 'minor', 0), K('Dm', 'D단조', 'D', 'minor', -1), K('Gm', 'G단조', 'G', 'minor', -2), K('Cm', 'C단조', 'C', 'minor', -3),
  K('Fm', 'F단조', 'F', 'minor', -4), K('Bbm', 'B♭단조', 'B', 'minor', -5), K('D#m', 'D♯단조', 'D', 'minor', 6), K('G#m', 'G♯단조', 'G', 'minor', 5),
  K('C#m', 'C♯단조', 'C', 'minor', 4), K('F#m', 'F♯단조', 'F', 'minor', 3), K('Bm', 'B단조', 'B', 'minor', 2), K('Em', 'E단조', 'E', 'minor', 1),
];
export const ALL_KEYS: Key[] = [...MAJOR_KEYS, ...MINOR_KEYS];
/** 연습곡용 KEYS 를 먼저 찾고 (같은 id 면 같은 조), 없으면 24조에서 */
export const keyById = (id: string) => KEYS.find((k) => k.id === id) ?? ALL_KEYS.find((k) => k.id === id)!;
/** 장조 ↔ 나란한조(같은 조표의 단조) */
export const relativeKey = (k: Key) => (k.mode === 'major' ? MINOR_KEYS : MAJOR_KEYS).find((x) => x.fifths === k.fifths)!;

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
