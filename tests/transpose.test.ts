// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import src0 from '../scripts/test-score.musicxml?raw';
import { transposeXml, newFifths, keyName, firstKey } from '../src/score/transpose';
import { parseMusicXML } from '../src/score/parse';

const xml = (fifths: number, notes: string) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>V</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;
const n = (step: string, oct: number, alter = 0, acc = '') => `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>1</duration><type>quarter</type>${acc ? `<accidental>${acc}</accidental>` : ''}</note>`;

describe('조 옮김', () => {
  it('새 조표', () => {
    expect(newFifths(2, 2)).toBe(4); // D → E
    expect(newFifths(2, -2)).toBe(0); // D → C
    expect(newFifths(0, 1)).toBe(-5); // C → Db
    expect(newFifths(0, -1)).toBe(5); // C → B
    expect(newFifths(-3, 5)).toBe(-4); // Eb → Ab
    expect(keyName(4)).toBe('E장조');
    expect(keyName(0, 'minor')).toBe('A단조');
  });
  it('음 이름과 임시표: D장조 F#5 G5 G#5 → E장조 G#5 A5 A#5', () => {
    const out = transposeXml(xml(2, n('F', 5, 1) + n('G', 5) + n('G', 5, 1, 'sharp') + n('C', 5, 1)), 2);
    const p = parseMusicXML(out);
    expect(p.notes.map((x) => x.midi)).toEqual([80, 81, 82, 75]);
    expect(firstKey(out).fifths).toBe(4);
    expect((out.match(/<accidental>/g) ?? []).length).toBe(1);
    expect(out).toMatch(/<step>A<\/step><alter>1<\/alter><octave>5<\/octave>/);
  });
  it('아래로 옮기기: G장조 → F장조 (−2), 옥타브 넘김', () => {
    const out = transposeXml(xml(1, n('C', 5) + n('D', 4) + n('B', 4)), -2);
    expect(parseMusicXML(out).notes.map((x) => x.midi)).toEqual([70, 60, 69]);
    expect(firstKey(out).fifths).toBe(-1);
    expect(out).toMatch(/<step>B<\/step><alter>-1<\/alter><octave>4<\/octave>/);
  });
  it('옥타브 위 (+12) 는 이름 그대로 옥타브만', () => {
    const out = transposeXml(xml(2, n('F', 5, 1)), 12);
    expect(out).toMatch(/<step>F<\/step><alter>1<\/alter><octave>6<\/octave>/);
  });
  it('실제 악보 전체를 옮겨도 음이 정확히 s 반음씩', () => {
    const src = src0;
    const a = parseMusicXML(src).notes.map((x) => x.midi);
    for (const s of [-5, -1, 1, 3, 7]) {
      const b = parseMusicXML(transposeXml(src, s)).notes.map((x) => x.midi);
      expect(b).toEqual(a.map((m) => m + s));
    }
  });
  it('중간에 조표가 바뀌어도 (Bb장조 → C장조, +2)', () => {
    const two = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>V</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>-2</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${n('B', 4, -1)}${n('E', 5, -1)}</measure><measure number="2"><attributes><key><fifths>0</fifths></key></attributes>${n('B', 4)}${n('F', 5, 1, 'sharp')}</measure></part></score-partwise>`;
    const out = transposeXml(two, 2);
    expect(parseMusicXML(out).notes.map((x) => x.midi)).toEqual([72, 77, 73, 80]);
    expect((out.match(/<fifths>(-?\d+)<\/fifths>/g) ?? []).join()).toBe('<fifths>0</fifths>,<fifths>2</fifths>');
  });
});
