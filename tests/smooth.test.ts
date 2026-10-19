import { describe, it, expect } from 'vitest';
import { PitchSmoother } from '../src/audio/smooth';
const f = (midi: number, cents = 0) => 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
describe('실시간 음 (덜 민감하게)', () => {
  it('바늘은 천천히 따라감', () => {
    const s = new PitchSmoother(440, 0.25);
    s.push(1, f(69, 0));
    let r = s.push(1.016, f(69, 30))!;
    expect(r.cents).toBeGreaterThan(0); expect(r.cents).toBeLessThan(5);
    for (let t = 1.032; t < 2; t += 0.016) r = s.push(t, f(69, 30))!;
    expect(r.cents).toBeGreaterThan(28);
  });
  it('짧게 튀는 다른 음은 무시, 이어지면 바뀜', () => {
    const s = new PitchSmoother(440, 0.25, 0.12);
    s.push(1, f(69));
    expect(s.push(1.03, f(71))!.midi).toBe(69);
    expect(s.push(1.06, f(69))!.midi).toBe(69);
    let r = s.push(1.1, f(71))!;
    for (let t = 1.116; t < 1.3; t += 0.016) r = s.push(t, f(71))!;
    expect(r.midi).toBe(71);
  });
  it('소리가 끊기면 잠깐은 유지, 오래 끊기면 비움', () => {
    const s = new PitchSmoother(440, 0.25, 0.12, 0.35);
    s.push(1, f(69));
    expect(s.push(1.2, null)).not.toBeNull();
    expect(s.push(1.5, null)).toBeNull();
  });
});
