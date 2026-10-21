// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { solfaName } from '../src/score/solfa';
import { parseMusicXML } from '../src/score/parse';
import xml from '../scripts/test-score.musicxml?raw';

describe('계이름', () => {
  it('고정 도', () => {
    expect(solfaName('F', 1, 2, 'fixed')).toBe('파♯');
    expect(solfaName('B', -1, -2, 'fixed')).toBe('시♭');
    expect(solfaName('A', 0, 0, 'fixed')).toBe('라');
  });
  it('이동 도: D장조 D=도, F♯=미, G장조 F♮=시♭, F장조 B♭=파', () => {
    expect(solfaName('D', 0, 2, 'movable')).toBe('도');
    expect(solfaName('F', 1, 2, 'movable')).toBe('미');
    expect(solfaName('F', 0, 1, 'movable')).toBe('시♭');
    expect(solfaName('B', -1, -1, 'movable')).toBe('파');
    expect(solfaName('A', 0, 0, 'movable')).toBe('라'); // A단조 으뜸음은 라
  });
  it('영어 음이름', () => {
    expect(solfaName('C', 1, 0, 'letter')).toBe('C♯');
  });
  it('parse 가 글자·변화표·조표를 남김', () => {
    const n = parseMusicXML(xml).notes[0];
    expect(n.step).toBeTruthy();
    expect(typeof n.fifths).toBe('number');
  });
});

import { withSolfa } from '../src/score/solfa';
describe('계이름 가사', () => {
  it('음마다 가사 한 개, 붙임줄 뒤 음은 빼고', () => {
    const out = withSolfa(xml, 'fixed');
    const n = parseMusicXML(xml).notes.length;
    const lyr = (out.match(/<lyric /g) ?? []).length;
    expect(lyr).toBeGreaterThanOrEqual(n - 2);
    expect(lyr).toBeLessThanOrEqual(n + 2);
    expect(parseMusicXML(out).notes.map((x) => x.midi)).toEqual(parseMusicXML(xml).notes.map((x) => x.midi));
  });
});
