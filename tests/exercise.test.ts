// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { STEPS, makeExercise } from '../src/exercise/curriculum';
import { describe as desc } from '../src/exercise/build';
import { parseMusicXML } from '../src/score/parse';
import { options, fingerPassage } from '../src/exercise/fingering';
import { scalePitch, keyById, dOf } from '../src/exercise/theory';

describe('운지', () => {
  it('E현 3포지션 4번 = D6', () => {
    const o = options({ d: dOf('D', 6), alter: 0 }, { positions: [1, 3] });
    expect(o).toEqual([{ string: 3, pos: 3, finger: 4 }]);
  });
  it('1포지션 G장조는 이동이 없다', () => {
    const k = keyById('G');
    const ps = Array.from({ length: 15 }, (_, i) => scalePitch(k, 25 + i));
    const f = fingerPassage(ps, { positions: [1] });
    expect(f.every((x) => x && (x.pos === 1 || x.pos === 0))).toBe(true);
    expect(f[0]).toEqual({ string: 0, pos: 0, finger: 0 });
  });
});

describe('모든 단계 악보 만들기', () => {
  for (const s of STEPS) {
    for (const perBeat of [1, 2, 3, 4]) {
      it(`${s.id} ${perBeat}`, () => {
        const m = makeExercise(s.spec, { perBeat, bowing: 'slur2', fingers: 'all', seed: 3 });
        expect(m.error).toBeUndefined();
        const p = parseMusicXML(m.xml);
        for (const [, len] of p.measureLen) expect(len).toBe(4);
        expect(p.notes.length).toBeGreaterThan(8);
        expect(m.notes.filter((n) => n.p && !n.f).length).toBe(0); // 모든 음에 운지
        if (s.spec.positions === '1-3') expect(m.shiftKeys.length).toBeGreaterThan(0);
        if (s.spec.positions === '1') expect(m.shiftKeys.length).toBe(0);
        if (perBeat === 4 && s.id.startsWith('D')) console.log(s.id, desc(m.notes));
      });
    }
  }
});

import { BOW_BASES, BOW_VARIANTS, BOW_KEYS } from '../src/exercise/bow';
describe('활 연습 (세브치크식)', () => {
  for (const b of BOW_BASES) for (const k of b.keys ? BOW_KEYS : ['G']) for (const v of BOW_VARIANTS) {
    it(`${b.id} ${k} ${v.id}`, () => {
      const m = makeExercise({ key: k, pattern: 'bow', positions: '1-3', base: b.id, variant: v.id }, { perBeat: 4, bowing: 'detache', fingers: 'shifts', seed: 1 });
      expect(m.error).toBeUndefined();
      const p = parseMusicXML(m.xml);
      expect(p.measures.length).toBe(3);
      for (const [, len] of p.measureLen) expect(len).toBe(4);
      expect(p.notes.length).toBe(33);
      expect(m.notes.filter((n) => n.p && !n.f).length).toBe(0);
      if (v.pattern.groups[0] > 1) expect(m.xml).toContain('<slur type="start"');
    });
  }
});
