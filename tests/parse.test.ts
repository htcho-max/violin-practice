// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML } from '../src/score/parse';

const xml = (nums: string[]) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${nums
  .map((n, i) => `<measure number="${n}"${i === 0 ? ' implicit="yes"' : ''}>${i === 0 ? '<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>' : ''}<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note></measure>`)
  .join('')}</part></score-partwise>`;

describe('마디 번호', () => {
  it('못갖춘마디 0 을 1번과 겹치지 않게 읽음', () => {
    const s = parseMusicXML(xml(['0', '1', '2']));
    expect(s.measures).toEqual([0, 1, 2]);
    expect(s.notes.map((n) => n.measure)).toEqual([0, 1, 2]);
  });
  it('번호가 없거나 겹치면 앞 번호 + 1', () => {
    expect(parseMusicXML(xml(['', '', '5', '5'])).measures).toEqual([1, 2, 5, 6]);
  });
});
