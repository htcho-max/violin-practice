import { describe, it, expect } from 'vitest';
import { ScoreFollower, followScrollDelta } from '../src/score/follow';

const M = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
const play = (f: ScoreFollower, ms: number[]) => ms.map((m) => f.onNote(m));

describe('악보 따라가기', () => {
  it('차례대로 치면 한 음씩', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 64, 65])).toEqual([0, 1, 2, 3]);
  });
  it('지금 울리는 음으로 다음 음을 미리 (3프레임 이어져야)', () => {
    const f = new ScoreFollower(M);
    play(f, [60, 62]);
    expect(f.onLive(64)).toBe(1);
    f.onLive(64);
    expect(f.onLive(64)).toBe(2);
  });
  it('음을 건너뛰어도 따라감', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 67])).toEqual([0, 1, 4]);
  });
  it('틀린 음 하나는 다음 음으로 치고 넘어감', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 63, 64])).toEqual([0, 1, 2]);
  });
  it('같은 음이 여러 곳이면 가까운 쪽 (내려오는 71 은 8번)', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 64, 65, 67, 69, 71, 72, 71])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('처음부터 다시 치면 그리로 옮김', () => {
    const f = new ScoreFollower(M);
    play(f, [60, 62, 64, 65, 67, 69, 71, 72, 71, 69]);
    const r = play(f, [60, 62, 64, 65]);
    expect(r[r.length - 1]).toBe(3);
  });
});

describe('자동 넘기기 위치', () => {
  it('2~3번째 줄이면 그대로, 아래로 내려가면 2번째 줄 자리로', () => {
    expect(followScrollDelta(120, 0, 800, 120)).toBeNull();
    expect(followScrollDelta(250, 0, 800, 120)).toBeNull();
    expect(followScrollDelta(400, 0, 800, 120)).toBe(262);
    expect(followScrollDelta(10, 0, 800, 120)).toBe(-128);
  });
});
