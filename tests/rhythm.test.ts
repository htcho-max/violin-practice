// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMusicXML } from '../src/score/parse';
import { alignNotes } from '../src/score/align';
import { analyzeRhythm } from '../src/score/rhythm';

const note = (step: string, oct: number, dur: number, extra = '') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>quarter</type>${extra}</note>`;
const xml = (measures: string[], parts = 1) => `<?xml version="1.0"?><score-partwise><part-list>${Array.from({ length: parts }, (_, i) => `<score-part id="P${i + 1}"><part-name>${i ? 'Piano' : 'Violin'}</part-name></score-part>`).join('')}</part-list>${Array.from({ length: parts }, (_, i) => `<part id="P${i + 1}">${measures.map((m, k) => `<measure number="${k + 1}">${k === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${m}</measure>`).join('')}</part>`).join('')}</score-partwise>`;

describe('붙임줄', () => {
  it('마디를 넘는 붙임줄은 한 음으로', () => {
    const s = parseMusicXML(xml([
      note('C', 5, 1) + note('D', 5, 1) + note('E', 5, 1) + note('F', 5, 1, '<tie type="start"/>'),
      note('F', 5, 2, '<tie type="stop"/>') + note('G', 5, 2),
    ]));
    expect(s.notes.map((n) => n.midi)).toEqual([72, 74, 76, 77, 79]);
    expect(s.notes[3].dur).toBe(3);
    expect(s.notes[4]).toMatchObject({ measure: 2, index: 0 });
  });
  it('붙임줄 없는 같은 음은 따로', () => {
    const s = parseMusicXML(xml([note('C', 5, 2) + note('C', 5, 2)]));
    expect(s.notes.length).toBe(2);
  });
});

describe('여러 파트', () => {
  it('파트 이름과 고른 파트', () => {
    const s = parseMusicXML(xml([note('C', 5, 4)], 2), { part: 1, allNotes: true });
    expect(s.parts).toEqual(['Violin', 'Piano']);
    expect(s.notes.length).toBe(1);
  });
});

describe('박자 채점', () => {
  const s = parseMusicXML(xml(Array.from({ length: 4 }, () => note('C', 5, 1) + note('D', 5, 1) + note('E', 5, 1) + note('F', 5, 1))));
  const exp = s.notes;
  const play = (shift: (i: number) => number, spb = 0.6) => exp.map((n, i) => ({ midi: n.midi, cents: 0, start: 2 + i * spb + shift(i) }));
  it('고른 연주는 오차 거의 0, 템포 100', () => {
    const r = analyzeRhythm(s, alignNotes(exp, play(() => 0)))!;
    expect(Math.round(r.bpm)).toBe(100);
    expect(r.meanAbs).toBeLessThan(0.01);
  });
  it('한 음만 늦으면 그 음이 잡힘', () => {
    const r = analyzeRhythm(s, alignNotes(exp, play((i) => (i === 6 ? 0.15 : 0))))!;
    const worst = [...r.notes].sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0];
    expect(worst.key).toBe('2:2');
    expect(worst.err).toBeGreaterThan(0.2);
    expect(r.notes.filter((n) => n.key !== '2:2').every((n) => Math.abs(n.err) < 0.06)).toBe(true);
  });
  it('점점 빨라지면 drift 양수, 개별 오차는 작게', () => {
    let t = 2;
    const pl = exp.map((n, i) => { const st = t; t += 0.65 - i * 0.008; return { midi: n.midi, cents: 0, start: st }; });
    const r = analyzeRhythm(s, alignNotes(exp, pl))!;
    expect(r.drift!).toBeGreaterThan(0.05);
    expect(r.meanAbs).toBeLessThan(0.08);
  });
});
