import { describe, it, expect } from 'vitest';
import type { ScoreRun } from '../src/data/db';
import type { Scored } from '../src/score/align';
import type { RunNote } from '../src/score/practice';
import { weakSpots, topWeakSpots, ladderStep, newLadder, ladderBpm, pitchHabits, stringFinger, dynCompare, meanDb, toRunNotes, scaleHas } from '../src/score/practice';

const DAY = 864e5;
const NOW = 100 * DAY;
function run(id: number, at: number, notes: RunNote[], extra: Partial<ScoreRun> = {}): ScoreRun {
  return { id, createdAt: at, date: '2026-10-19', scoreId: 7, title: '곡', from: 1, to: 3, durationSec: 30, total: notes.length, ok: 0, wrong: 0, missed: 0, meanAbs: null, inSession: false, notes, ...extra };
}
// 1마디는 잘함, 2마디는 음을 자주 틀림, 3마디는 맞지만 음정이 25센트씩 벗어남
const goodRun = (at: number): RunNote[] => [
  [1, 0, 69, 3, 0, null], [1, 1, 71, -2, 0, null],
  [2, 0, 72, null, 1, null], [2, 1, 74, 5, 0, null],
  [3, 0, 76, 25, 0, null], [3, 1, 77, 22, 0, null],
];

describe('약한 마디', () => {
  it('맞은 음 비율과 평균 센트로 약한 마디를 고르고 약한 순으로', () => {
    const w = weakSpots([run(1, NOW - DAY, goodRun(0)), run(2, NOW - 2 * DAY, goodRun(0))], { now: NOW });
    expect(w.map((x) => x.measure)).toEqual([2, 3]);
    expect(w[0].okRate).toBeCloseTo(0.5);
    expect(w[1].meanAbs).toBeCloseTo(23.5);
    expect(w[0].tries).toBe(2);
  });
  it('오래된 기록은 빼고, 집중 연습을 끝낸 뒤 기록만 봄', () => {
    expect(weakSpots([run(1, NOW - 60 * DAY, goodRun(0))], { now: NOW })).toEqual([]);
    const w = weakSpots([run(1, NOW - DAY, goodRun(0)), run(2, NOW - 2 * DAY, goodRun(0))], { now: NOW, sinceByMeasure: { 2: NOW - DAY } });
    expect(w.map((x) => x.measure)).toEqual([3]);
  });
  it('음 기록 없는 예전 기록은 weakMeasures 에 두 번 이상 나온 마디', () => {
    const w = weakSpots([run(1, NOW - DAY, [], { notes: undefined, weakMeasures: [5, 6] }), run(2, NOW - 2 * DAY, [], { notes: undefined, weakMeasures: [5] })], { now: NOW });
    expect(w.map((x) => x.measure)).toEqual([5]);
    expect(w[0].okRate).toBeNull();
  });
  it('여러 악보에서 가장 약한 것 몇 개 (끝낸 사다리는 그 뒤 기록만)', () => {
    const a = [run(1, NOW - DAY, goodRun(0)), run(2, NOW - DAY, goodRun(0))];
    const b = [run(3, NOW - DAY, goodRun(0), { scoreId: 9, title: '다른 곡' }), run(4, NOW - DAY, goodRun(0), { scoreId: 9, title: '다른 곡' })];
    const t = topWeakSpots([...a, ...b], { '9:2': { base: 80, idx: 4, done: true, at: NOW, tries: 5 } }, 3, NOW);
    expect(t.length).toBe(3);
    expect(t.some((x) => x.scoreId === 9 && x.measure === 2)).toBe(false);
    expect(t.find((x) => x.scoreId === 9)?.title).toBe('다른 곡');
  });
});

describe('템포 사다리', () => {
  it('60%에서 시작, 통과하면 10%씩, 100% 통과면 끝, 못 하면 같은 칸', () => {
    let l = newLadder(100, 0);
    expect(ladderBpm(l)).toBe(60);
    let r = ladderStep(l, 95, 8, 1); expect(r.passed).toBe(true); l = r.next; expect(ladderBpm(l)).toBe(70);
    r = ladderStep(l, 85, 8, 2); expect(r.passed).toBe(false); l = r.next; expect(ladderBpm(l)).toBe(70);
    r = ladderStep(l, 100, 20, 3); expect(r.passed).toBe(false); // 음정 ±15 넘음
    for (let k = 0; k < 4; k++) l = ladderStep(l, 100, 5, 10 + k).next;
    expect(ladderBpm(l)).toBe(100);
    expect(l.done).toBe(true);
    expect(l.tries).toBe(6);
  });
});

describe('음정 습관', () => {
  it('5번 이상, 평균 ±8센트 넘는 음만', () => {
    const notes: RunNote[] = [];
    for (let k = 0; k < 6; k++) { notes.push([1, k, 73, 14, 0, null]); notes.push([1, 10 + k, 71, 2, 0, null]); }
    notes.push([2, 0, 64, -12, 0, null]); // 한 번뿐
    const h = pitchHabits([run(1, NOW, notes)]);
    expect(h.length).toBe(1);
    expect(h[0].name).toBe('C#5');
    expect(h[0].string).toBe('A현');
    expect(h[0].finger).toBe('2번');
    expect(Math.round(h[0].mean)).toBe(14);
    expect(h[0].tip).toMatch(/C#5를 평균 \+14센트 높게/);
  });
  it('현·손가락 (1포지션)', () => {
    expect(stringFinger(55)).toEqual({ string: 'G현', finger: '개방현' });
    expect(stringFinger(66)).toEqual({ string: 'D현', finger: '2번' });
    expect(stringFinger(83)).toEqual({ string: 'E현', finger: '4번' });
    expect(scaleHas('A', 73)).toBe(true);
    expect(scaleHas('G', 73)).toBe(false);
  });
});

describe('셈여림 비교', () => {
  const sc = (m: number, vel: number, db: number | null): Scored => ({ note: { measure: m, index: 0, midi: 69, beat: 0, dur: 1, art: { vel } }, status: db === null ? 'missed' : 'ok', cents: 0, playedMidi: 69, db });
  it('크레센도인데 소리가 안 커지면 표시', () => {
    const rs = [sc(1, 0.5, -30), sc(1, 0.6, -30), sc(2, 0.7, -30), sc(2, 0.8, -30), sc(3, 0.9, -12), sc(3, 0.9, -12), sc(4, 0.9, -12), sc(4, 0.7, -12), sc(5, 0.6, -24), sc(5, 0.5, -30)];
    const d = dynCompare(rs);
    expect(d.hasDyn).toBe(true);
    expect(d.points.length).toBe(10);
    expect(d.points[0].expected).toBeCloseTo(0);
    // 크레센도 1→3마디 (끝에서 소리가 커짐) 는 괜찮음, 디크레센도 4→5 는 실제로 작아짐 → 표시 없음
    expect(d.flags.length).toBe(0);
    const flat = rs.map((r) => ({ ...r, db: -20 }));
    const f = dynCompare(flat).flags;
    expect(f.map((x) => x.kind)).toEqual(['cresc', 'dim']);
    expect(f[0].fromMeasure).toBe(1);
  });
  it('구간 평균 dB, 기록용 음 목록', () => {
    const tr: [number, number][] = [[0, -40], [1, -20], [1.5, -10], [2, -30]];
    expect(meanDb(tr, 1, 1.6)).toBeCloseTo(-15);
    expect(meanDb(tr, 5, 6)).toBeNull();
    const rn = toRunNotes([sc(3, 0.5, -21.234), { ...sc(4, 0.5, null), status: 'wrong', cents: null }]);
    expect(rn).toEqual([[3, 0, 69, 0, 0, -21.2], [4, 0, 69, null, 1, null]]);
  });
});
