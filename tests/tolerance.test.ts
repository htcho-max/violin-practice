// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toneOf, tolFor, TOLERANCES } from '../src/score/tolerance';
import { mergeSettings } from '../src/data/settings';

describe('음정 판정 기준', () => {
  it('보통은 ±10/±20', () => {
    const t = tolFor('normal');
    expect([toneOf(10, t), toneOf(-11, t), toneOf(20, t), toneOf(21, t)]).toEqual(['good', 'warn', 'warn', 'bad']);
  });
  it('관대는 ±15/±30, 엄격은 ±5/±10', () => {
    expect([toneOf(14, TOLERANCES.relaxed), toneOf(-25, TOLERANCES.relaxed), toneOf(31, TOLERANCES.relaxed)]).toEqual(['good', 'warn', 'bad']);
    expect([toneOf(5, TOLERANCES.strict), toneOf(8, TOLERANCES.strict), toneOf(-12, TOLERANCES.strict)]).toEqual(['good', 'warn', 'bad']);
  });
  it('저장된 설정에 값이 없거나 이상하면 보통', () => {
    expect(mergeSettings({}).pitchTolerance).toBe('normal');
    expect(tolFor(undefined).id).toBe('normal');
    expect(tolFor('xx' as never).id).toBe('normal');
  });
});

import { parseMusicXML } from '../src/score/parse';
describe('악보 템포', () => {
  const xml = (snd: string) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>V</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${snd}<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  it('sound tempo 를 읽는다', () => {
    expect(parseMusicXML(xml('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>70</per-minute></metronome></direction-type><sound tempo="70"/></direction>')).tempo).toBe(70);
    expect(parseMusicXML(xml('')).tempo).toBeUndefined();
  });
});
