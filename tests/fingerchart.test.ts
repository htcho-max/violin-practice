import { describe, it, expect } from 'vitest';
import { chartSpots, relSpot, recommend } from '../src/score/fingering';
import {
  HIGH, LOW, fretPos, keyShape, noteRows, positionSpots, randomSpot, spell, spelledName, spotChip, spotMidi, spotTitle,
} from '../src/violin/fingerchart';

const chips = (midi: number, maxPos = 7) => chartSpots(midi, maxPos).map(spotChip);

describe('운지표: 음마다 자리', () => {
  it('D5 는 A현 1st 3 · A현 3rd 1 등, 낮은 포지션부터', () => {
    const c = chips(74);
    expect(c).toContain('A현 1st 3');
    expect(c).toContain('A현 3rd 1');
    expect(c[0]).toBe('A현 1st 3');
    expect(c).toContain('D현 7th 1');
    expect(chips(74, 3)).toEqual(['A현 1st 3', 'A현 2nd 2', 'A현 3rd 1']);
  });
  it('G3 은 G현 개방 하나, 개방현은 한 칩', () => {
    expect(chips(55)).toEqual(['G현 개방 0']);
    expect(chips(76).filter((x) => x.includes('개방'))).toEqual(['E현 개방 0']);
    expect(chips(76)[0]).toBe('E현 개방 0');
  });
  it('가장 높은 음: 7포지션 E현 4번 A6, 늘린 4번 A♯6', () => {
    expect(chips(93)).toEqual(['E현 7th 4']);
    expect(chips(94)).toEqual(['E현 7th 4 (늘림)']);
    expect(HIGH).toBe(94);
    expect(chips(95)).toEqual([]);
    const rows = noteRows(null);
    expect(rows[0].note.midi).toBe(LOW);
    expect(rows[rows.length - 1].note.midi).toBe(94);
    expect(rows.length).toBe(94 - 55 + 1);
  });
  it('늘림 표시 (3포지션 D현 4번 늘려 C♯5)', () => {
    expect(chips(73)).toContain('D현 3rd 4 (늘림)');
  });
  it('최고 포지션보다 높은 자리는 숨김', () => {
    expect(chips(88, 3)).toEqual([]);
    expect(noteRows(null, 3).slice(-1)[0].note.midi).toBe(STR_E + relSpot(3, 8).semis);
  });
  it('추천(recommend)이 고르는 자리는 운지표에 있음', () => {
    for (let m = 55; m <= 94; m++) {
      const r = recommend([{ midi: m }], { maxPos: 7 })[0];
      if (!r) continue;
      const s = chartSpots(m, 7);
      expect(s.some((x) => x.string === r.string && (r.finger === 0 ? x.open : x.pos === r.pos && x.finger === r.finger))).toBe(true);
    }
  });
});
const STR_E = 76;

describe('운지표: 조와 철자', () => {
  it('조에 맞는 철자 (F♯ / G♭), 조에 없는 음은 빠짐', () => {
    expect(spelledName(spell(66, 2)!)).toBe('F♯4');
    expect(spelledName(spell(66, -6 + 1)!)).toBe('G♭4'); // D♭장조
    expect(spell(65, 2)).toBeNull();
    expect(spelledName(spell(65, 6)!)).toBe('E♯4');
    expect(spelledName(spell(71, -6)!)).toBe('C♭5'); // G♭장조: B 를 C♭ 로 (옥타브는 글자 기준)
    const d = noteRows(2).map((r) => spelledName(r.note));
    expect(d.slice(0, 8)).toEqual(['G3', 'A3', 'B3', 'C♯4', 'D4', 'E4', 'F♯4', 'G4']);
  });
});

describe('운지표: 포지션 자리', () => {
  it('3포지션 A현 1번은 D5', () => {
    const s = positionSpots(3, 2, null).find((x) => x.finger === 1 && x.rel === 2)!;
    expect(spelledName(s.note)).toBe('D5');
    expect(spotTitle(s, 'D5')).toBe('A현 3포지션 1번 (D5)');
    expect(spotMidi(s)).toBe(74);
  });
  it('반음 모두면 자리 8개 (½ 포지션은 개방현과 겹치는 자리 빼고 7개)', () => {
    expect(positionSpots(1, 0, null)).toHaveLength(8);
    expect(positionSpots(0.5, 0, null)).toHaveLength(7);
    expect(positionSpots(1, 3, 2).map((s) => spelledName(s.note))).toEqual(['F♯5', 'G5', 'A5', 'B5']);
  });
  it('골라 주기는 그 포지션·조 안에서 (늘림 빼고)', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSpot(3, 2, () => i / 20)!;
      expect(s.pos).toBe(3);
      expect(spell(spotMidi(s), 2)).not.toBeNull();
      expect(s.stretch).toBe(false);
    }
  });
});

describe('운지표: 조별 손 모양', () => {
  it('D장조 1포지션: E현 1|2 3 4, A현 1 2|3 4, G현 1 2 3|4', () => {
    expect(keyShape(2, 1, 3).pattern).toBe('1|2 3 4');
    expect(keyShape(2, 1, 3).tags[0]).toBe('1·2 붙음');
    expect(keyShape(2, 1, 2).pattern).toBe('1 2|3 4');
    expect(keyShape(2, 1, 2).fingers.map((f) => spelledName(f.note))).toEqual(['B4', 'C♯5', 'D5', 'E5']);
    expect(keyShape(2, 1, 0).pattern).toBe('1 2 3|4');
    expect(keyShape(2, 1, 0).tags).toEqual(['3·4 붙음', '높은 3']);
  });
  it('다장조 1포지션 E현은 모두 온음 + 낮은 1', () => {
    const s = keyShape(0, 1, 3);
    expect(s.pattern).toBe('1 2 3 4');
    expect(s.tags).toEqual(['모두 온음', '낮은 1']);
  });
  it('다장조 2포지션 A현: C D E F = 1 2 3|4 (1번이 낮은 자리면 손 모양이 같이 내려감)', () => {
    const s = keyShape(0, 2, 2);
    expect(s.fingers.map((f) => spelledName(f.note))).toEqual(['C5', 'D5', 'E5', 'F5']);
    expect(s.pattern).toBe('1 2 3|4');
    expect(s.tags).toContain('낮은 1');
    expect(s.tags).toContain('낮은 4');
  });
  it('A장조 3포지션 A현: D E F♯ G♯ = 1 2 3 4 (높은 3, 늘린 4 — 낮은 1 C♯ 은 뺌)', () => {
    const s = keyShape(3, 3, 2);
    expect(s.fingers.map((f) => spelledName(f.note))).toEqual(['D5', 'E5', 'F♯5', 'G♯5']);
    expect(s.pattern).toBe('1 2 3 4');
    expect(s.tags).toEqual(['모두 온음', '높은 3', '늘린 4']);
  });
  it('A장조 1포지션 G현: A B C♯ D (G♯ 낮은 1 은 뺌)', () => {
    expect(keyShape(3, 1, 0).fingers.map((f) => spelledName(f.note))).toEqual(['A3', 'B3', 'C♯4', 'D4']);
  });
  it('B♭장조는 개방 E 안 씀', () => {
    expect(keyShape(-2, 1, 3).openInKey).toBe(false);
    expect(keyShape(-2, 1, 2).openInKey).toBe(true);
  });
  it('모든 조·포지션·줄에서 손가락 넷, 간격은 반음·온음', () => {
    for (const f of [0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5]) for (const p of [0.5, 1, 2, 3, 4, 5, 6, 7]) for (let s = 0; s < 4; s++) {
      const sh = keyShape(f, p, s);
      expect(sh.fingers).toHaveLength(4);
      expect(sh.pattern).toMatch(/^1[| ]2[| ]3[| ]4$/);
    }
  });
});

describe('지판 반음 자리', () => {
  it('L(1−2^(−n/12)): 12반음은 줄 가운데, 아래로 갈수록 좁아짐', () => {
    expect(fretPos(0)).toBe(0);
    expect(fretPos(12)).toBeCloseTo(0.5, 10);
    expect(fretPos(7, 328)).toBeCloseTo(328 * (1 - 2 ** (-7 / 12)), 10);
    const gaps = Array.from({ length: 19 }, (_, n) => fretPos(n + 1) - fretPos(n));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(gaps[0] / gaps[12]).toBeCloseTo(2, 10);
  });
});
