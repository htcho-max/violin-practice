// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { makeExercise, scaleProgressId, sheetOctaves, STEPS } from '../src/exercise/curriculum';
import { MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, KEYS, relativeKey, keyById, pitchName } from '../src/exercise/theory';
import { sheetRange, maxSheetOctaves } from '../src/exercise/patterns';
import { parseMusicXML } from '../src/score/parse';

const make = (key: string, form?: 'natural' | 'harmonic' | 'melodic', octaves = 2, perBeat = 1) =>
  makeExercise({ key, pattern: 'scaleSheet', positions: '1-3', octaves, form }, { perBeat, bowing: 'detache', fingers: 'all', seed: 1 });
const midis = (xml: string) => parseMusicXML(xml).notes.map((n) => n.midi);

describe('장·단음계 악보 (바이올린)', () => {
  it('24조: 교재 순서, 나란한조끼리 같은 조표', () => {
    expect(ALL_KEYS).toHaveLength(24);
    expect(MAJOR_KEYS.map((k) => k.id).join(' ')).toBe('C F Bb Eb Ab Db F# B E A D G');
    MAJOR_KEYS.forEach((k, i) => expect(MINOR_KEYS[i].fifths).toBe(k.fifths));
    expect(relativeKey(keyById('Eb')).id).toBe('Cm');
    expect(relativeKey(keyById('F#m')).id).toBe('A');
    // 기존 연습곡 조는 그대로 (G장조는 G3에서)
    expect(keyById('G')).toBe(KEYS[0]);
  });
  it('24조 모두 2옥타브: G3 위 가장 낮은 으뜸음에서 으뜸음까지', () => {
    for (const k of ALL_KEYS) {
      const m = make(k.id, 'harmonic');
      expect(m.error, k.id).toBeUndefined();
      const ms = midis(m.xml);
      expect(ms[0], k.id).toBeGreaterThanOrEqual(55);
      expect(ms[0] - 12, k.id).toBeLessThan(55); // 한 옥타브 아래는 바이올린에서 안 됨
      expect(Math.max(...ms) - ms[0], k.id).toBe(24);
      expect(ms[ms.length - 1]).toBe(ms[0]);
      expect(m.shiftKeys).toEqual([]);
      expect(m.xml).not.toContain('<fingering>');
    }
  });
  it('가장 낮은 으뜸음: G·A♭·A·B♭·B 는 3째 옥타브, F♯ 는 F♯4', () => {
    const lowest = (id: string) => midis(make(id, 'natural', 1).xml)[0];
    expect(lowest('G')).toBe(55);
    expect(lowest('Ab')).toBe(56);
    expect(lowest('Bbm')).toBe(58);
    expect(lowest('G#m')).toBe(56);
    expect(lowest('F#')).toBe(66);
    expect(lowest('F#m')).toBe(66);
    expect(lowest('D')).toBe(62);
  });
  it('3옥타브: E7 까지. 넘는 조(F·F♯)는 2옥타브로 낮춤', () => {
    const g = make('G', undefined, 3);
    expect(g.title).toBe('G장조 음계 · 3옥타브');
    const ms = midis(g.xml);
    expect(Math.max(...ms)).toBe(91);
    expect(midis(make('E', undefined, 3).xml).reduce((a, b) => Math.max(a, b))).toBe(100);
    for (const id of ['F', 'F#', 'Fm', 'F#m']) {
      expect(maxSheetOctaves(keyById(id)), id).toBe(2);
      expect(sheetRange(keyById(id), 3)).toBeNull();
      expect(make(id, 'natural', 3).title, id).toMatch(/· 2옥타브$/);
    }
    expect(sheetOctaves('F', 3)).toBe(2);
    expect(sheetOctaves('Bb', 3)).toBe(3);
    expect(ALL_KEYS.filter((k) => maxSheetOctaves(k) === 3)).toHaveLength(20);
  });
  it('E♭장조: 조표 3개, 음계 + 으뜸화음', () => {
    const m = make('Eb');
    expect(m.xml).toContain('<fifths>-3</fifths>');
    expect(m.title).toBe('E♭장조 음계 · 2옥타브');
    const ms = midis(m.xml);
    // E♭4 ... E♭6 ... E♭4, 분산화음 E♭ G B♭ ...
    expect(ms.slice(0, 3)).toEqual([63, 65, 67]);
    expect(ms.slice(29, 36)).toEqual([63, 67, 70, 75, 79, 82, 87]);
    expect(new Set(parseMusicXML(m.xml).notes.map((n) => n.acc).filter(Boolean))).toEqual(new Set(['E♭', 'A♭', 'B♭']));
  });
  it('단조 형태: 화성은 7음 올림(G♯단조 F𝄪), 가락은 내려올 때 자연', () => {
    const h = make('G#m', 'harmonic');
    expect(h.xml).toContain('<accidental>double-sharp</accidental>');
    expect(h.title).toBe('G♯단조 (화성) 음계 · 2옥타브');
    expect(pitchName({ d: 21 + 3, alter: 2 })).toBe('F##3');
    const mel = midis(make('Am', 'melodic', 1).xml);
    // A3 B C D E F♯ G♯ A4 G F E D C B A (+ 분산화음)
    expect(mel.slice(0, 15)).toEqual([57, 59, 60, 62, 64, 66, 68, 69, 67, 65, 64, 62, 60, 59, 57]);
    const nat = midis(make('Am', 'natural', 1).xml);
    expect(nat.slice(5, 7)).toEqual([65, 67]);
    expect(make('Am', 'natural').title).toBe('A단조 (자연) 음계 · 2옥타브');
  });
  it('리듬: 8분음표로 고르면 박에 맞게, 마침음은 마디 끝까지', () => {
    const m = make('D', undefined, 2, 2);
    const s = parseMusicXML(m.xml);
    expect(s.notes[0].dur).toBe(0.5);
    expect(s.notes).toHaveLength(15 + 14 + 7 + 6);
    expect(m.xml).toMatch(/<type>whole<\/type>|<type>half<\/type>|<type>quarter<\/type>/);
  });
  it('진도 id 는 조·형태·옥타브마다', () => {
    expect(scaleProgressId('Cm', 'harmonic', 2)).toBe('sheet-Cm-harmonic-2');
    expect(scaleProgressId('C', undefined, 3)).toBe('sheet-C-major-3');
    // 기존 단계 연습곡은 그대로
    expect(STEPS.some((s) => s.spec.pattern === 'scaleSheet')).toBe(false);
  });
});
