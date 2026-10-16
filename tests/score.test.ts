// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML, notesInRange } from '../src/score/parse';
import { alignNotes, summarizeScore } from '../src/score/align';

// 테스트용 작은 악보 (직접 만든 음계 — 교재 악보는 저장소에 넣지 않음)
const XML = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>테스트 음계</work-title></work>
<part-list><score-part id="P1"><part-name>Vn</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>12</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice></note>
<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>12</duration><voice>1</voice></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice></note></measure>
<measure number="2"><note><grace/><pitch><step>E</step><octave>5</octave></pitch><voice>1</voice></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice></note>
<note><chord/><pitch><step>A</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice></note>
<note><rest/><duration>6</duration><voice>1</voice></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice></note>
<note><pitch><step>F</step><alter>0</alter><octave>5</octave></pitch><duration>24</duration><voice>1</voice></note></measure>
</part></score-partwise>`;

describe('MusicXML 읽기', () => {
  const s = parseMusicXML(XML);
  it('제목·마디·음', () => {
    expect(s.title).toBe('테스트 음계');
    expect(s.measures).toEqual([1, 2]);
    expect(s.notes.map((n) => n.midi)).toEqual([69, 71, 73, 74, 81, 76, 76, 76, 77]);
  });
  it('꾸밈음 제외, 화음은 높은 음, 박 위치', () => {
    const m2 = s.notes.filter((n) => n.measure === 2);
    expect(m2[0]).toMatchObject({ midi: 81, beat: 0, dur: 0.5 });
    expect(m2[1].beat).toBe(1); // 쉼표 뒤
    expect(m2[4]).toMatchObject({ midi: 77, beat: 2, dur: 2 });
  });
  it('구간', () => { expect(notesInRange(s, 2, 2).length).toBe(5); });
  it('잘못된 파일', () => { expect(() => parseMusicXML('<x')).toThrow(); });
});

describe('음표별 채점 (순서 맞추기)', () => {
  const s = parseMusicXML(XML);
  const exp = s.notes;
  const p = (midi: number, cents: number) => ({ midi, cents, start: 0 });
  it('모두 맞게 연주 (반복 E5 는 한 음으로 이어져도 됨)', () => {
    const r = alignNotes(exp, [p(69, 2), p(71, 12), p(73, -6), p(74, 0), p(81, 3), p(76, 5), p(77, -20)]);
    expect(r.map((x) => x.status)).toEqual(Array(9).fill('ok'));
    expect(r[1].cents).toBe(12);
    expect(r[6].cents).toBe(5); // 세 번째 E5 도 같은 값
    const sum = summarizeScore(r);
    expect(sum.ok).toBe(9);
    expect(sum.byMeasure.get(1)).toBe(5);
  });
  it('한 음 빼먹고, 한 음 틀리고, 앞에 군더더기', () => {
    const r = alignNotes(exp, [p(62, 0), p(69, 0), p(73, 4), p(75, 0), p(81, 0), p(76, 0), p(77, 0)]);
    expect(r[1].status).toBe('missed'); // B4 빠짐
    expect(r[3].status).toBe('wrong'); // D5 대신 D#5
    expect(r[3].playedMidi).toBe(75);
    expect(r[0].status).toBe('ok');
    const sum = summarizeScore(r);
    expect(sum.missed).toBe(1);
    expect(sum.wrong).toBe(1);
  });
  it('아무것도 안 치면 모두 놓침', () => {
    expect(summarizeScore(alignNotes(exp, [])).missed).toBe(9);
  });
});

import { planPlayback } from '../src/score/player';
describe('악보 재생 계획', () => {
  const s = parseMusicXML(XML);
  it('마디 길이·박자', () => {
    expect(s.time).toEqual([4, 4]);
    expect(s.measureLen.get(1)).toBe(4);
    expect(s.measureLen.get(2)).toBe(4);
  });
  it('♩=60, 카운트인 4박: 첫 음 4초, 2마디 첫 음 8초', () => {
    const p = planPlayback(s, { bpm: 60, from: 1, to: 2, countIn: true });
    expect(p.events[0].time).toBeCloseTo(4);
    expect(p.events[4].time).toBeCloseTo(8);
    expect(p.events[4].dur).toBeCloseTo(0.5);
    expect(p.events[5].time).toBeCloseTo(9); // 쉼표 뒤
    expect(p.total).toBeCloseTo(12);
    expect(p.clicks.length).toBe(12);
    expect(p.clicks.filter((c) => c.accent).length).toBe(3);
  });
  it('구간만, ♩=120', () => {
    const p = planPlayback(s, { bpm: 120, from: 2, to: 2, countIn: false });
    expect(p.events.length).toBe(5);
    expect(p.events[0].time).toBe(0);
    expect(p.total).toBeCloseTo(2);
  });
});
