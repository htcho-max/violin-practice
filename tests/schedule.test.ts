import { describe, it, expect } from 'vitest';
import { TickScheduler, TapTempo, METERS } from '../src/audio/schedule';

describe('메트로놈 스케줄러', () => {
  it('10분 재생 후에도 오차 1ms 미만', () => {
    const s = new TickScheduler();
    s.bpm = 120;
    s.reset(0);
    let ticks = 0;
    let maxErr = 0;
    // 25ms마다 100ms 앞까지 예약 (실제 루프와 같게)
    for (let now = 0; now < 600; now += 0.025) {
      for (const t of s.advance(now + 0.1)) {
        maxErr = Math.max(maxErr, Math.abs(t.time - ticks * 0.5));
        ticks++;
      }
    }
    expect(ticks).toBeGreaterThanOrEqual(1200);
    expect(maxErr).toBeLessThan(0.001);
  });

  it('클릭이 중복되거나 빠지지 않음', () => {
    const s = new TickScheduler();
    s.bpm = 97;
    s.subdivision = 3;
    s.reset(1);
    const times: number[] = [];
    for (let now = 0; now < 30; now += 0.025 + Math.random() * 0.02) times.push(...s.advance(now + 0.1).map((t) => t.time));
    const step = 60 / 97 / 3;
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(step, 9);
  });

  it('4/4 강박, 6/8 두 번째 강박, 분할 박', () => {
    const s = new TickScheduler();
    s.meter = METERS.find((m) => m.id === '6/8')!;
    s.subdivision = 2;
    s.reset(0);
    const kinds = s.advance(6).slice(0, 12).map((t) => t.kind);
    expect(kinds.slice(0, 2)).toEqual(['accent', 'sub']);
    expect(kinds[2]).toBe('beat');
    expect(kinds[6]).toBe('secondary');
  });

  it('강조 끄면 모두 같은 박', () => {
    const s = new TickScheduler();
    s.accent = false;
    s.reset(0);
    expect(new Set(s.advance(4).map((t) => t.kind))).toEqual(new Set(['beat']));
  });

  it('BPM 바꾸면 다음 박부터 적용', () => {
    const s = new TickScheduler();
    s.bpm = 60;
    s.reset(0);
    s.advance(1.05); // 0, 1
    s.bpm = 120;
    const t = s.advance(3).map((x) => x.time);
    expect(t[0]).toBeCloseTo(2, 9);
    expect(t[1]).toBeCloseTo(2.5, 9);
  });
});

describe('탭 템포', () => {
  it('500ms 간격 = 120', () => {
    const tt = new TapTempo();
    let r: number | null = null;
    for (let i = 0; i < 5; i++) r = tt.tap(i * 500);
    expect(r).toBe(120);
  });
  it('2초 쉬면 새로 시작', () => {
    const tt = new TapTempo();
    tt.tap(0); tt.tap(1000);
    expect(tt.tap(5000)).toBeNull();
  });
});
