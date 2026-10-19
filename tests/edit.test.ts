// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML } from '../src/score/parse';
import { editNote, revertMeasure, shiftMarksAfterRest, spell } from '../src/score/edit';

const n = (step: string, oct: number, dur: number, type: string, extra = '', alter = 0) =>
  `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}<voice>1</voice><type>${type}</type></note>`;
const XML = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
<measure number="1"><attributes><divisions>2</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
${n('A', 4, 2, 'quarter')}${n('B', 4, 2, 'quarter')}${n('C', 5, 2, 'quarter', '', 1)}${n('D', 5, 2, 'quarter')}</measure>
<measure number="2">${n('D', 5, 4, 'half')}${n('A', 4, 4, 'half', '<tie type="start"/>')}</measure>
<measure number="3">${n('A', 4, 4, 'half', '<tie type="stop"/>')}<note><rest/><duration>4</duration><voice>1</voice><type>half</type></note></measure>
</part></score-partwise>`;
const ok = (r: { xml: string } | { error: string }) => { if ('error' in r) throw new Error(r.error); return r.xml; };
const notes = (x: string) => parseMusicXML(x).notes;

describe('악보 음 고치기', () => {
  it('반음 올리기·내리기 (조표 고려)', () => {
    let x = ok(editNote(XML, 1, 0, { kind: 'shift', semis: 1 }));
    expect(notes(x)[0].midi).toBe(70);
    expect(x).toContain('<accidental>sharp</accidental>');
    x = ok(editNote(XML, 1, 2, { kind: 'shift', semis: -1 }));
    expect(notes(x)[2].midi).toBe(72);
    expect(x).toContain('<accidental>natural</accidental>');
    expect(spell(66, 2, true)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(70, -1, true)).toEqual({ step: 'B', alter: -1, octave: 4 });
  });
  it('옥타브', () => {
    expect(notes(ok(editNote(XML, 1, 1, { kind: 'shift', semis: 12 })))[1].midi).toBe(83);
  });
  it('짧게 하면 뒤에 쉼표, 길게 하려면 뒤에 쉼표가 있어야 함', () => {
    const x = ok(editNote(XML, 1, 0, { kind: 'dur', type: 'eighth', dot: false }));
    const ns = notes(x);
    expect(ns[0].dur).toBe(0.5);
    expect(ns[1].beat).toBe(1);
    expect(ns.filter((q) => q.measure === 1).length).toBe(4);
    expect('error' in editNote(XML, 1, 0, { kind: 'dur', type: 'half', dot: false })).toBe(true);
    // 2마디 D5 는 뒤가 붙임줄 음이라 길게 못 함, 3마디 A4 는 붙임줄이라 못 바꿈
    expect('error' in editNote(XML, 2, 1, { kind: 'dur', type: 'quarter', dot: false })).toBe(true);
  });
  it('쉼표 뒤 쉼표 먹고 길게', () => {
    // 3마디는 붙임줄 음뿐이므로, 1마디 D5 를 8분으로 줄인 뒤 다시 4분으로
    const a = ok(editNote(XML, 1, 3, { kind: 'dur', type: 'eighth', dot: false }));
    const b = ok(editNote(a, 1, 3, { kind: 'dur', type: 'quarter', dot: false }));
    expect(notes(b)[3].dur).toBe(1);
    expect(b.match(/<rest\/>/g)?.length).toBe(1); // 3마디 쉼표만 남음
  });
  it('쉼표로 바꾸기와 표시 번호 당기기', () => {
    const x = ok(editNote(XML, 1, 1, { kind: 'rest' }));
    expect(notes(x).filter((q) => q.measure === 1).map((q) => q.midi)).toEqual([69, 73, 74]);
    expect(shiftMarksAfterRest({ '1:0': 'a', '1:1': 'b', '1:2': 'c', '2:0': 'd' }, 1, 1)).toEqual({ '1:0': 'a', '1:1': 'c', '2:0': 'd' });
  });
  it('붙임줄 음은 이어진 음까지 함께 바뀜', () => {
    const x = ok(editNote(XML, 2, 1, { kind: 'shift', semis: 2 }));
    const t = notes(x).find((q) => q.measure === 2 && q.index === 1)!;
    expect(t.midi).toBe(71);
    expect(t.dur).toBe(4);
  });
  it('마디 되돌리기', () => {
    const x = ok(editNote(XML, 1, 0, { kind: 'shift', semis: 1 }));
    expect(notes(ok(revertMeasure(x, XML, 1)))[0].midi).toBe(69);
  });
});
