import { describe, it, expect } from 'vitest';
import { toneOf, tolFor, TOLERANCES } from '../src/score/tolerance';
import { mergeSettings } from '../src/data/settings';

describe('음정 판정 기준', () => {
  it('보통은 ±10/±20', () => {
    const t = tolFor('normal');
    expect([toneOf(10, t), toneOf(-11, t), toneOf(20, t), toneOf(21, t)]).toEqual(['good', 'warn', 'warn', 'bad']);
  });
  it('관대는 ±15/±30, 엄격은 ±5/±10', () => {
    expect([toneOf(14, TOLERANCES.relaxed), toneOf(-25, TOLERANCES.relaxed), toneOf(31, TOLERANCES.relaxed)]).toEqual(['good', 'warn', 'bad']);
    expect([toneOf(5, TOLERANCES.strict), toneOf(8, TOLERANCES.strict), toneOf(-12, TOLERANCES.strict)]).toEqual(['good', 'warn', 'bad']);
  });
  it('저장된 설정에 값이 없거나 이상하면 보통', () => {
    expect(mergeSettings({}).pitchTolerance).toBe('normal');
    expect(tolFor(undefined).id).toBe('normal');
    expect(tolFor('xx' as never).id).toBe('normal');
  });
});
