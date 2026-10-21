// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML, accName } from '../src/score/parse';
import { sortAcc } from '../src/score/accidentals';

const note = (step: string, alter: number, oct = 5, chord = false) => `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
const XML = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('B', -1, 4)}${note('C', 0)}${note('D', 0)}${note('E', -1)}</measure>
<measure number="2">${note('E', 0)}${note('F', 1)}${note('B', -2, 4)}${note('D', 0, 4)}${note('F', 1, 5, true)}</measure></part></score-partwise>`;

describe('♯·♭ 형광펜', () => {
  it('바뀐 음만 철자를 가짐 (조표·임시표, 제자리표는 없음, 겹음은 위 음)', () => {
    const s = parseMusicXML(XML);
    expect(s.notes.map((n) => n.acc ?? '')).toEqual(['B♭', '', '', 'E♭', '', 'F♯', 'B𝄫', 'F♯']);
  });
  it('철자와 조표 순서', () => {
    expect(accName('E', -1)).toBe('E♭');
    expect(accName('E', 1)).toBe('E♯');
    expect(accName('C', 0)).toBeUndefined();
    expect(sortAcc(['A♭', 'F♯', 'B♭', 'E♭', 'C♯'])).toEqual(['B♭', 'E♭', 'A♭', 'F♯', 'C♯']);
  });
});
