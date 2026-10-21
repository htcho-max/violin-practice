import { describe, it, expect } from 'vitest';
import { recommend, candidates } from '../src/score/fingering';

const run = (midis: number[], o = {}) => recommend(midis.map((midi) => ({ midi, dur: 0.5 })), o);

describe('포지션 추천', () => {
  it('라장조 음계 한 옥타브는 모두 1포지션', () => {
    const r = run([62, 64, 66, 67, 69, 71, 73, 74]);
    expect(r.every((x) => x && x.pos === 1)).toBe(true);
    expect(r.map((x) => x!.finger)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });
  it('E현 위쪽 C#6·D6 은 3포지션', () => {
    const r = run([76, 78, 80, 81, 83, 85, 86]);
    expect(r[5]!.pos).toBe(3);
    expect(r[6]!.pos).toBe(3);
    expect(r[6]!.finger).toBe(4);
  });
  it('최고 포지션보다 높은 음은 추천 없음, 높이면 됨', () => {
    expect(run([88])[0]).toBeNull(); // E6
    expect(run([88], { maxPos: 5 })[0]!.pos).toBeGreaterThanOrEqual(4);
  });
  it('G3 아래는 칠 수 없음', () => {
    expect(candidates(54)).toEqual([]);
  });
  it('내가 정한 포지션·손가락을 따름', () => {
    const r = recommend([{ midi: 74, fixPos: 3 }, { midi: 76 }]);
    expect(r[0]!.pos).toBe(3);
    expect(r[0]).toEqual({ string: 2, pos: 3, finger: 1 }); // A현 3포지션 1번
    expect(recommend([{ midi: 76, fixFinger: 4 }])[0]).toEqual({ string: 2, pos: 1, finger: 4 });
  });
});

describe('인쇄된 손가락 번호·하모닉스·포지션 표시', () => {
  it('B4 3, G4 1 처럼 인쇄돼 있으면 3포지션(D현)으로, 손가락 없는 음도 그 자리에', () => {
    const r = recommend([{ midi: 62, fixFinger: 0 }, { midi: 71, fixFinger: 3 }, { midi: 69 }, { midi: 67, fixFinger: 1 }, { midi: 69 }, { midi: 69 }]);
    expect(r.slice(1).map((x) => `${x!.pos}${x!.string}${x!.finger}`)).toEqual(['313', '312', '311', '312', '312']);
  });
  it('하모닉스 G4 는 G현 3포지션 4번', () => {
    expect(recommend([{ midi: 67, harm: true, fixFinger: 4 }])[0]).toEqual({ string: 0, pos: 3, finger: 4 });
  });
  it('"여기부터 3포지션" 표시는 다음 음들에도 이어짐', () => {
    const r = recommend([{ midi: 67, prefPos: 3 }, { midi: 69, prefPos: 3 }, { midi: 71, prefPos: 3 }]);
    expect(r.every((x) => x!.pos === 3)).toBe(true);
  });
  it('손가락으로 안 되는 음은 그 손가락 조건을 빼고 추천', () => {
    expect(recommend([{ midi: 67, fixFinger: 4 }])[0]).not.toBeNull();
  });
});
