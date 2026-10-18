// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML, applyUserMarks } from '../src/score/parse';
import { velocities, DYN_LEVEL } from '../src/score/dynamics';
import { noteShape } from '../src/score/player';

const note = (step: string, extra = '') => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration>${extra}</note>`;
const dir = (inner: string) => `<direction><direction-type>${inner}</direction-type></direction>`;
const xml = (measures: string[]) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${measures
  .map((b, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${b}</measure>`)
  .join('')}</part></score-partwise>`;

describe('셈여림', () => {
  it('표시가 없으면 vel 없음', () => {
    const s = parseMusicXML(xml([note('C') + note('D') + note('E') + note('F')]));
    expect(s.notes.every((n) => n.art?.vel === undefined)).toBe(true);
    expect(velocities([0, 1], [])).toBeNull();
  });
  it('p → 크레센도 → f 사이를 고르게 올림', () => {
    const s = parseMusicXML(xml([
      dir('<dynamics><p/></dynamics>') + note('C') + dir('<wedge type="crescendo"/>') + note('D') + note('E') + note('F'),
      dir('<wedge type="stop"/>') + dir('<dynamics><f/></dynamics>') + note('G') + note('A') + note('B') + note('C'),
    ]));
    const v = s.notes.map((n) => n.art!.vel!);
    expect(v[0]).toBeCloseTo(DYN_LEVEL.p);
    expect(v[1]).toBeCloseTo(DYN_LEVEL.p); // 꺾쇠 시작 음
    expect(v[2]).toBeGreaterThan(v[1]);
    expect(v[3]).toBeGreaterThan(v[2]);
    expect(v[3]).toBeLessThan(DYN_LEVEL.f);
    expect(v[4]).toBeCloseTo(DYN_LEVEL.f);
    expect(v[7]).toBeCloseTo(DYN_LEVEL.f);
  });
  it('끝 셈여림이 없는 디크레센도는 한 단계 내림, 글자 dim. 도 꺾쇠처럼', () => {
    const s = parseMusicXML(xml([
      dir('<dynamics><f/></dynamics>') + note('C') + dir('<wedge type="diminuendo"/>') + note('D') + note('E') + dir('<wedge type="stop"/>') + note('F'),
      dir('<words>dim.</words>') + note('G') + note('A') + note('B') + note('C'),
    ]));
    const v = s.notes.map((n) => n.art!.vel!);
    expect(v[3]).toBeCloseTo(DYN_LEVEL.f - 0.13);
    expect(v[7]).toBeLessThan(v[4]);
  });
  it('sf 는 그 음만 세게, 활 표시 읽기', () => {
    const s = parseMusicXML(xml([
      dir('<dynamics><p/></dynamics>') + note('C', '<notations><technical><down-bow/></technical></notations>') + dir('<dynamics><sf/></dynamics>') + note('D', '<notations><technical><up-bow/></technical></notations>') + note('E') + note('F'),
    ]));
    expect(s.notes[0].art!.bow).toBe('down');
    expect(s.notes[1].art!.bow).toBe('up');
    expect(s.notes[1].art!.vel!).toBeGreaterThan(1);
    expect(s.notes[2].art!.vel!).toBeCloseTo(DYN_LEVEL.p);
  });
  it('세기가 소리 크기에 반영', () => {
    const s = parseMusicXML(xml([dir('<dynamics><pp/></dynamics>') + note('C') + dir('<dynamics><ff/></dynamics>') + note('D') + note('E') + note('F')]));
    const g = (i: number) => noteShape({ note: s.notes[i], time: 0, dur: 0.5 }).gain;
    expect(g(0)).toBeLessThan(0.6);
    expect(g(1)).toBeGreaterThan(1.2);
  });
});

describe('내 표시 합치기', () => {
  const base = parseMusicXML(xml([note('C', '<notations><technical><up-bow/></technical></notations>') + note('D') + note('E') + note('F'), note('G') + note('A') + note('B') + note('C')]));
  it('표시가 없으면 그대로', () => {
    expect(applyUserMarks(base, undefined)).toBe(base);
    expect(applyUserMarks(base, {})).toBe(base);
  });
  it('활은 내 표시가 우선, 셈여림·꺾쇠는 세기로', () => {
    const s = applyUserMarks(base, { '1:0': { bow: 'down', dyn: 'p' }, '1:1': { hair: 'cresc' }, '1:3': { hair: 'end' }, '2:0': { dyn: 'f', text: '여기!' } });
    expect(s.notes[0].art!.bow).toBe('down');
    const v = s.notes.map((n) => n.art!.vel!);
    expect(v[0]).toBeCloseTo(DYN_LEVEL.p);
    expect(v[2]).toBeGreaterThan(v[1]);
    expect(v[4]).toBeCloseTo(DYN_LEVEL.f);
    // 원본은 그대로
    expect(base.notes[0].art!.bow).toBe('up');
    expect(base.notes[0].art!.vel).toBeUndefined();
  });
});
