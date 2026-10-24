import { describe, it, expect } from 'vitest';
import { ScoreFollower, followScrollDelta } from '../src/score/follow';

const M = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
const play = (f: ScoreFollower, ms: number[]) => ms.map((m) => f.onNote(m));

describe('악보 따라가기', () => {
  it('차례대로 치면 한 음씩', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 64, 65])).toEqual([0, 1, 2, 3]);
  });
  it('지금 울리는 음으로 바로 다음 음만 미리 (5프레임 이어져야)', () => {
    const f = new ScoreFollower(M);
    play(f, [60, 62]);
    for (let k = 0; k < 4; k++) expect(f.onLive(64)).toBe(1);
    expect(f.onLive(64)).toBe(2);
    const g = new ScoreFollower(M);
    play(g, [60, 62]);
    for (let k = 0; k < 8; k++) g.onLive(67); // 몇 음 뒤 음은 미리 보여 주지 않음
    expect(g.current).toBe(1);
  });
  it('한 음 건너뛰면 바로, 여러 음 건너뛰면 다음 음까지 맞아야', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 65])).toEqual([0, 1, 3]);
    const g = new ScoreFollower(M);
    expect(play(g, [60, 62, 67])).toEqual([0, 1, 1]);
    expect(g.onNote(69)).toBe(5);
  });
  it('틀린 음이 우연히 몇 음 뒤와 같아도 튀지 않음', () => {
    const f = new ScoreFollower(M);
    play(f, [60, 62]);
    expect(f.onNote(69)).toBe(1); // 69 는 5번이지만 바로 옮기지 않음
    expect(f.onNote(64)).toBe(2); // 원래 자리 다음 음
  });
  it('음정이 조금 틀려도 다음 음으로 (±0.6반음)', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60.2, 61.5, 64.55])).toEqual([0, 1, 2]);
  });
  it('같은 음을 다시 내면(활 바꿈) 그대로', () => {
    const f = new ScoreFollower(M);
    expect(play(f, [60, 62, 62, 62, 64])).toEqual([0, 1, 1, 1, 2]);
  });
  it('멀리 옮길 때는 5음이 맞아야', () => {
    const L = [...Array.from({ length: 40 }, (_, i) => 55 + (i % 7)), 80, 81, 82, 83, 84];
    const f = new ScoreFollower(L);
    play(f, [55, 56]);
    expect(play(f, [81, 82, 83, 84])[3]).toBe(1); // 4음 맞아도 멀어서 그대로
    const g = new ScoreFollower(L);
    play(g, [55, 56]);
    expect(play(g, [80, 81, 82, 83, 84])[4]).toBe(44);
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
