import { describe, it, expect } from 'vitest';
import { justCents, midiToFreq } from '../src/audio/notes';
import { streak, addDays, formatDuration } from '../src/data/dates';
import { transitions, itemMs, totalMs } from '../src/state/session';
import { MedianWindow } from '../src/audio/smoothing';

describe('순정률', () => {
  const g3 = midiToFreq(55);
  it('순정 장3도는 0센트, 평균율 장3도는 +13.7센트', () => {
    expect(justCents(g3 * 1.25, g3).cents).toBeCloseTo(0, 6);
    expect(justCents(midiToFreq(59), g3).cents).toBeCloseTo(13.69, 1);
    expect(justCents(midiToFreq(59), g3).semis).toBe(4);
  });
  it('옥타브 위 5도', () => {
    const r = justCents(g3 * 3, g3);
    expect(r.semis).toBe(7);
    expect(r.cents).toBeCloseTo(0, 6);
  });
  it('으뜸음 아래 음도 계산', () => {
    const r = justCents(g3 * 0.75, g3); // 아래 4도 = 한 옥타브 아래의 5도
    expect(r.semis).toBe(7);
    expect(r.cents).toBeCloseTo(0, 6);
  });
});

describe('날짜', () => {
  it('연속 일수: 오늘 안 했으면 어제부터', () => {
    const d = new Set(['2026-10-14', '2026-10-15']);
    expect(streak(d, '2026-10-16')).toBe(2);
    d.add('2026-10-16');
    expect(streak(d, '2026-10-16')).toBe(3);
    expect(streak(new Set(['2026-10-13']), '2026-10-16')).toBe(0);
  });
  it('월말 넘기기', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('시간 표시', () => {
    expect(formatDuration(65)).toBe('1분 5초');
    expect(formatDuration(3720)).toBe('1시간 2분');
  });
});

describe('연습 세션', () => {
  const items = [{ key: 'a', label: 'A', minutes: 1 }, { key: 'b', label: 'B', minutes: 2 }];
  it('일시정지·이동·재개 시간 계산', () => {
    let s = transitions.start(items, 0);
    s = transitions.pause(s, 30_000);
    expect(itemMs(s, 0, 999_999)).toBe(30_000);
    s = transitions.resume(s, 40_000);
    s = transitions.goto(s, 1, 50_000);
    expect(s.accum[0]).toBe(40_000);
    expect(itemMs(s, 1, 60_000)).toBe(10_000);
    expect(totalMs(s, 60_000)).toBe(50_000);
    s = transitions.goto(s, 0, 70_000);
    expect(itemMs(s, 0, 75_000)).toBe(45_000);
    expect(s.accum[1]).toBe(20_000);
  });
  it('일시정지 중 이동하면 계속 멈춤', () => {
    let s = transitions.pause(transitions.start(items, 0), 1000);
    s = transitions.goto(s, 1, 5000);
    expect(s.runningSince).toBeNull();
    expect(itemMs(s, 1, 100_000)).toBe(0);
  });
});

describe('중앙값 필터', () => {
  it('튀는 값 제거', () => {
    const m = new MedianWindow(5);
    [440, 441, 880, 440, 439].forEach((v) => m.push(v));
    expect(m.push(441)).toBe(441);
  });
});
