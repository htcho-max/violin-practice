import { describe, it, expect } from 'vitest';
import { chartSpots, relSpot, recommend } from '../src/score/fingering';
import { STRINGS } from '../src/score/fingering';
import {
  HIGH, LOW, autoBoard, fretPos, hitInPos, keyShape, liveString, nextInRun, noteHits, noteRows, positionSpots, randomSpot, scaleRun,
  spell, spelledName, spotChip, spotMidi, spotTitle, type ShapeFinger,
  DEFAULT_POSITIONS, boardDots, boardJoins, cleanPositions, hitIn, positionBand, spotShort, spotsIn, togglePosition,
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
    expect(noteRows(null, [1, 2, 3]).slice(-1)[0].note.midi).toBe(STR_E + relSpot(3, 8).semis);
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
      const s = randomSpot([3], 2, () => i / 20)!;
      expect(s.pos).toBe(3);
      expect(spell(spotMidi(s), 2)).not.toBeNull();
      expect(s.stretch).toBe(false);
    }
  });
});

/** 손가락 간격 글자 (테스트용): 반음으로 붙으면 | */
const pat = (fs: ShapeFinger[]) => fs.map((f, i) => (i ? (f.semis - fs[i - 1].semis === 1 ? '|' : ' ') : '') + f.finger).join('');
const names = (fs: ShapeFinger[]) => fs.map((f) => spelledName(f.note));

describe('운지표: 조별 손가락 자리 (지판 반음 막대)', () => {
  it('D장조 1포지션: E현 1|2 3 4, A현 1 2|3 4, G현 1 2 3|4', () => {
    expect(pat(keyShape(2, 1, 3))).toBe('1|2 3 4');
    expect(pat(keyShape(2, 1, 2))).toBe('1 2|3 4');
    expect(names(keyShape(2, 1, 2))).toEqual(['B4', 'C♯5', 'D5', 'E5']);
    expect(pat(keyShape(2, 1, 0))).toBe('1 2 3|4');
  });
  it('다장조 1포지션 E현은 모두 온음 (낮은 1)', () => {
    const s = keyShape(0, 1, 3);
    expect(pat(s)).toBe('1 2 3 4');
    expect(s[0].rel).toBe(1);
  });
  it('다장조 2포지션 A현: C D E F = 1 2 3|4 (1번이 낮은 자리면 손 모양이 같이 내려감)', () => {
    const s = keyShape(0, 2, 2);
    expect(names(s)).toEqual(['C5', 'D5', 'E5', 'F5']);
    expect(pat(s)).toBe('1 2 3|4');
  });
  it('A장조 3포지션 A현: D E F♯ G♯ (높은 3, 늘린 4 — 낮은 1 C♯ 은 뺌)', () => {
    const s = keyShape(3, 3, 2);
    expect(names(s)).toEqual(['D5', 'E5', 'F♯5', 'G♯5']);
    expect(s[3].rel).toBe(8);
  });
  it('A장조 1포지션 G현: A B C♯ D (G♯ 낮은 1 은 뺌)', () => {
    expect(names(keyShape(3, 1, 0))).toEqual(['A3', 'B3', 'C♯4', 'D4']);
  });
  it('모든 조·포지션·줄에서 손가락 넷, 간격은 반음·온음', () => {
    for (const f of [0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5]) for (const p of [0.5, 1, 2, 3, 4, 5, 6, 7]) for (let s = 0; s < 4; s++) {
      const sh = keyShape(f, p, s);
      expect(sh).toHaveLength(4);
      expect(pat(sh)).toMatch(/^1[| ]2[| ]3[| ]4$/);
    }
  });
});

describe('한 화면 운지표: 고른 음 자리', () => {
  it('A4 자리: G현(5~7th) · D현(1st 4 …) · A현 개방 — 줄마다 한 곳', () => {
    const h = noteHits(69);
    expect(h.map((x) => x.string)).toEqual([0, 1, 2]);
    expect(h.map((x) => x.semis)).toEqual([14, 7, 0]);
    expect(h[2].open).toBe(true);
    expect(h[1].spots.map((s) => s.pos)).toEqual([0.5, 1, 2, 3, 4]); // ½ 포지션은 늘린 4번
    expect(noteHits(69, [1]).map((x) => x.string)).toEqual([1, 2]);
  });
  it('지금 포지션 안 자리 (개방현은 어느 포지션이나)', () => {
    const [g, d, a] = noteHits(69);
    expect(hitInPos(g, 1)).toBeNull();
    expect(hitInPos(g, 5)!.finger).toBe(4);
    expect(hitInPos(d, 3)!.finger).toBe(2);
    expect(hitInPos(a, 7)!.open).toBe(true);
    expect(noteHits(74).every((h) => h.spots.every((s) => STRINGS[h.string] + h.semis === 74))).toBe(true);
  });
  it('자동 지판 보기: 넓거나 가로 방향이면 가로', () => {
    expect(autoBoard(390, false)).toBe('v');
    expect(autoBoard(844, true)).toBe('h');
    expect(autoBoard(720, false)).toBe('h');
    expect(autoBoard(700, true)).toBe('h');
  });
});

describe('실시간 점 줄 고르기', () => {
  it('목표 줄이 정해졌으면 그 줄', () => {
    expect(liveString(69.2, [1], 2)).toBe(2);
    expect(liveString(80, [1], 0)).toBe(0);
  });
  it('아니면 지금 포지션에서 그 음을 내는 줄 (목표 자리가 있는 줄 먼저)', () => {
    expect(liveString(71, [1], null)).toBe(2); // B4: A현 1st 1 (D현은 1st 에 안 닿음)
    expect(liveString(74, [3], null)).toBe(2); // D5: A현 3rd 1
    expect(liveString(69, [1], null)).toBe(1); // A4: 1포지션 D현 4 (손가락 자리 먼저)
    expect(liveString(69, [1], null, [2])).toBe(1); // 개방현 줄은 손가락 자리가 없어 그대로 D현
    expect(liveString(62, [1], null, [0])).toBe(0); // D4: G현 4 를 먼저
    expect(liveString(76, [7], null)).toBe(1); // E5: 7th 에서 D현 2 … 가 낮은 줄
    expect(liveString(50, [1], null)).toBeNull(); // G3 아래
    expect(liveString(81.4, [1], null)).toBe(3); // A5 쯤: 1st 는 E현만
  });
});

describe('음계 따라 짚기', () => {
  it('D장조 1포지션: G3 부터 B5 까지 올라가는 음계 (개방현 포함, 늘림 빼고)', () => {
    const r = scaleRun([1], 2);
    expect(r.map((x) => spelledName(x.note))).toEqual([
      'G3', 'A3', 'B3', 'C♯4', 'D4', 'E4', 'F♯4', 'G4', 'A4', 'B4', 'C♯5', 'D5', 'E5', 'F♯5', 'G5', 'A5', 'B5',
    ]);
    expect(r[0].open).toBe(true);
    expect(r.find((x) => x.note.midi === 62)!.string).toBe(0); // D4 는 G현 4번 (낮은 줄 먼저)
    expect(r.every((x) => !x.stretch)).toBe(true);
  });
  it('3포지션은 3포지션 자리로', () => {
    const r = scaleRun([3], 0);
    expect(r.filter((x) => !x.open).every((x) => x.pos === 3)).toBe(true);
    expect(spelledName(r[r.length - 1].note)).toBe('D6');
  });
  it('끝에서 내려오고 맨 아래에서 다시 올라감', () => {
    const r = scaleRun([1], 2);
    expect(nextInRun(r, 55, 1)).toMatchObject({ item: { note: { midi: 57 } }, dir: 1 });
    expect(nextInRun(r, 83, 1)).toMatchObject({ item: { note: { midi: 81 } }, dir: -1 });
    expect(nextInRun(r, 55, -1)).toMatchObject({ item: { note: { midi: 57 } }, dir: 1 });
    expect(nextInRun(r, null, 1)!.item.note.midi).toBe(55);
    expect(nextInRun(r, 60, 1)!.item.note.midi).toBe(61); // 목록에 없는 C4 → 위 C♯4
    expect(nextInRun(r, 90, 1)).toMatchObject({ item: { note: { midi: 83 } }, dir: -1 });
    expect(nextInRun([], 60, 1)).toBeNull();
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

describe('포지션 여러 개 고르기', () => {
  it('켜고 끄기: 마지막 하나는 끌 수 없고, 낮은 포지션부터 정리', () => {
    expect(togglePosition([1], 1)).toEqual([1]);
    expect(togglePosition([1, 3], 3)).toEqual([1]);
    expect(togglePosition([1, 3], 0.5)).toEqual([0.5, 1, 3]);
    expect(togglePosition([3], 1)).toEqual([1, 3]);
    expect(cleanPositions([3, 1, 3, 9])).toEqual([1, 3]);
    expect(cleanPositions([])).toBeNull();
    expect(cleanPositions('1')).toBeNull();
    expect(cleanPositions(undefined)).toBeNull();
    expect(DEFAULT_POSITIONS).toEqual([1, 3]);
  });
  it('음 줄: 고른 포지션 중 하나에서라도 낼 수 있는 음만 (개방현은 언제나)', () => {
    const r13 = noteRows(null, [1, 3]);
    expect(r13.length).toBe(87 - 55 + 1); // G3 ~ 3rd 늘린 4번 D♯6
    expect(noteRows(null, [1]).length).toBe(30);
    const r7 = noteRows(null, [7]).map((r) => r.note.midi);
    expect(r7.slice(0, 3)).toEqual([55, 62, 66]); // 개방 G·D 다음 7th G현 F♯4 부터
    expect(r7.length).toBe(31);
    expect(noteRows(null, [0.5]).slice(-1)[0].note.midi).toBe(76 + 7); // ½ E현 늘린 4번 B5
    expect(noteRows(2, [1, 3]).every((r) => spell(r.note.midi, 2))).toBe(true); // 조 거르기 그대로
  });
  it('자리 글자: 고른 포지션 자리만 (늘림 표시, 개방현 먼저)', () => {
    const c = (m: number, ps: number[]) => spotsIn(m, ps).map(spotChip);
    expect(c(74, [1, 3])).toEqual(['A현 1st 3', 'A현 3rd 1']);
    expect(c(73, [1, 3])).toEqual(['A현 1st 2', 'D현 3rd 4 (늘림)', 'A현 3rd 1']);
    expect(c(69, [1, 3])).toEqual(['A현 개방 0', 'D현 1st 4', 'D현 3rd 2']);
    expect(c(74, [3])).toEqual(['A현 3rd 1']);
    expect(c(56, [0.5])).toEqual(['G현 ½ 1']); // ½ 포지션 G현 A♭3
    expect(spotShort(spotsIn(69, [1])[0])).toBe('A현 개방');
    // 보통 포지션 자리는 chartSpots 와 같음
    for (let m = 55; m <= 94; m++) expect(spotsIn(m, [1, 2, 3, 4, 5, 6, 7]).map(spotChip).sort()).toEqual(chartSpots(m, 7).map(spotChip).sort());
  });
  it('지판 동그라미: 같은 줄·같은 반음은 하나로, 번호는 낮은 포지션 손가락', () => {
    expect(boardDots([1], null)).toHaveLength(32);
    const d = boardDots([1, 3], null);
    expect(d).toHaveLength(44); // 줄마다 1~11반음
    expect(d.filter((x) => x.spots.length > 1)).toHaveLength(20);
    const d5 = d.find((x) => x.string === 2 && x.semis === 5)!;
    expect(spelledName(d5.note)).toBe('D5');
    expect(d5.spots.map((s) => [s.pos, s.finger])).toEqual([[1, 3], [3, 1]]);
    const dA = boardDots([1, 3], 2).filter((x) => x.string === 2);
    expect(dA.map((x) => spelledName(x.note))).toEqual(['B4', 'C♯5', 'D5', 'E5', 'F♯5', 'G5']);
    expect(boardJoins([1, 3], 2).filter((j) => j.string === 2)).toEqual([{ string: 2, from: 4, to: 5 }, { string: 2, from: 9, to: 10 }]);
    expect(boardJoins([1, 3], null)).toEqual([]);
    expect(positionBand(1, null)).toEqual({ pos: 1, lo: 1, hi: 8 });
    expect(positionBand(3, null)).toEqual({ pos: 3, lo: 4, hi: 11 });
  });
  it('고른 음 자리: 고른 포지션 안 / 다른 포지션', () => {
    const [d, a] = noteHits(74).filter((h) => h.string >= 1);
    expect(hitIn(a, [1, 3]).map((s) => s.pos)).toEqual([1, 3]);
    expect(hitIn(d, [1, 3])).toEqual([]);
    expect(hitIn(d, [1, 5]).map((s) => s.pos)).toEqual([5]);
    expect(hitIn(noteHits(69)[2], [7])[0].open).toBe(true);
  });
  it('다음 음 자동: 고른 포지션들의 조 음을 낮은 음부터, 같은 음은 낮은 포지션 자리', () => {
    const r = scaleRun([1, 3], 2);
    expect(spelledName(r[0].note)).toBe('G3');
    expect(spelledName(r[r.length - 1].note)).toBe('D6');
    expect(r.find((x) => x.note.midi === 74)).toMatchObject({ string: 2, pos: 1, finger: 3 });
    expect(r.find((x) => x.note.midi === 85)).toMatchObject({ string: 3, pos: 3, finger: 3 });
    expect(r.every((x) => x.open || [1, 3].includes(x.pos))).toBe(true);
    expect(nextInRun(r, 83, 1)!.item.note.midi).toBe(85);
    expect(nextInRun(r, 86, 1)).toMatchObject({ item: { note: { midi: 85 } }, dir: -1 });
    expect(scaleRun([3, 1], 2)).toEqual(r);
  });
  it('골라 주기·실시간 점: 고른 포지션 안에서', () => {
    for (let i = 0; i < 30; i++) expect([1, 3]).toContain(randomSpot([1, 3], null, () => i / 30)!.pos);
    expect(liveString(74, [3], null)).toBe(2);
    expect(liveString(86, [1, 3], null)).toBe(3); // D6: 3rd E현 4
    expect(liveString(88, [1, 3], null)).toBe(3); // E6: 고른 포지션에 없으면 낮은 포지션 자리 (4th E현)
  });
});
