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
