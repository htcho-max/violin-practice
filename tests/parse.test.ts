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

import { noteShape } from '../src/score/player';

const artXml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><notations><slur type="start" number="1"/></notations></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><notations><slur type="stop" number="1"/></notations></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><notations><articulations><staccato/><accent/></articulations></notations></note>
</measure>
<measure number="2"><direction><direction-type><words>pizz.</words></direction-type></direction>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
<direction><direction-type><words>arco</words></direction-type></direction>
<note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><notations><tied type="start"/><slur type="start" number="1"/></notations></note>
<note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><tie type="stop"/><notations><tied type="stop"/></notations></note>
</measure>
<measure number="3"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><notations><slur type="stop" number="1"/></notations></note></measure>
</part></score-partwise>`;

describe('연주법', () => {
  const s = parseMusicXML(artXml);
  const a = s.notes.map((n) => n.art ?? {});
  it('이음줄·스타카토·악센트·피치카토를 읽음', () => {
    expect(a[0]).toEqual({ slurNext: true });
    expect(a[1]).toEqual({ slurIn: true, slurNext: true });
    expect(a[2]).toEqual({ slurIn: true });
    expect(a[3]).toEqual({ stacc: true, accent: true });
    expect(a[4]).toEqual({ pizz: true });
    expect(a[5]).toEqual({ slurNext: true }); // 붙임줄로 합친 음도 이음줄 이어짐
    expect(a[6]).toEqual({ slurIn: true });
  });
  it('소리 길이: 스타카토 < 보통 < 이음줄', () => {
    const ev = (i: number) => ({ note: s.notes[i], time: 0, dur: 0.5 });
    const st = noteShape(ev(3)), slur = noteShape(ev(0)), plain = noteShape({ note: { ...s.notes[0], art: undefined }, time: 0, dur: 0.5 });
    expect(st.len).toBeLessThan(plain.len);
    expect(plain.len).toBeLessThan(slur.len);
    expect(slur.len).toBeGreaterThan(0.5);
    expect(st.gain).toBeGreaterThan(1);
    expect(noteShape(ev(1)).attack).toBeGreaterThan(st.attack);
    expect(noteShape(ev(4)).pizz).toBe(true);
  });
});

import { drawRangeFor } from '../src/score/osmd';
describe('OSMD 그리기 구간', () => {
  it('못갖춘마디 0 이 있으면 순서가 하나 밀림', () => {
    expect(drawRangeFor([0, 1, 2, 3, 4], 0, 4)).toEqual({ drawFromMeasureNumber: 1, drawUpToMeasureNumber: 5 });
    expect(drawRangeFor([0, 1, 2, 3, 4], 2, 3)).toEqual({ drawFromMeasureNumber: 3, drawUpToMeasureNumber: 4 });
  });
  it('15마디부터 시작하는 악보', () => {
    expect(drawRangeFor([15, 16, 17, 18], 15, 16)).toEqual({ drawFromMeasureNumber: 1, drawUpToMeasureNumber: 2 });
    expect(drawRangeFor([15, 16, 17, 18], 17, 99)).toEqual({ drawFromMeasureNumber: 3, drawUpToMeasureNumber: 4 });
  });
});
