import { describe, it, expect } from 'vitest';
import { crossfadeLoop, chooseSample, brightness, ENSEMBLE_TOP } from '../src/audio/violinSampler';
import { impulseData, getRoom, ROOM_SPEC } from '../src/audio/room';
import { noteShape, getVoice, type PlayEvent } from '../src/score/player';
import type { ScoreNote } from '../src/score/parse';

describe('루프 이음매', () => {
  it('끝에서 시작으로 뛸 때 파형이 이어짐', () => {
    const sr = 8000;
    // 음높이·위상이 다른 두 사인 → 그냥 루프하면 크게 튐
    const d = Float32Array.from({ length: sr * 3 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / sr + (i > sr * 1.5 ? 1.3 : 0)));
    const raw = Float32Array.from(d);
    const { loopStart, loopEnd } = crossfadeLoop(d, sr, 1, 2.6, 0.2);
    const s = Math.round(loopStart * sr), e = Math.round(loopEnd * sr);
    // 루프 끝 바로 앞 샘플 = 루프 시작 바로 앞 샘플 (원래 소리)
    expect(Math.abs(d[e - 1] - raw[s - 1])).toBeLessThan(0.05);
    // 루프 구간 안은 크기가 거의 그대로 (같은 힘으로 섞기)
    let peak = 0; for (let i = e - 1600; i < e; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeLessThan(1.5);
    // 루프 시작 뒤는 손대지 않음
    expect(d[s + 10]).toBe(raw[s + 10]);
  });
});

describe('샘플 고르기', () => {
  it('솔로는 가장 가까운 음', () => {
    expect(chooseSample(69).name).toBe('A4');
    expect(chooseSample(70).name).toBe('A4');
  });
  it('합주는 여리면 여린 겹(3반음 안), 아니면 센 겹', () => {
    expect(chooseSample(69, 'ensemble', true).name).toBe('A4-p');
    expect(chooseSample(69, 'ensemble').name).toBe('A4-f');
    expect(chooseSample(80, 'ensemble', true).layer).toBe('p'); // B5-p 3반음
    expect(chooseSample(90, 'ensemble', true).name).toBe('D6-f'); // 여린 겹이 멀면 센 겹
    expect(ENSEMBLE_TOP).toBeGreaterThan(86);
  });
  it('세게 칠수록 밝게', () => {
    expect(brightness(0.5)).toBeLessThan(brightness(1));
    expect(brightness(1)).toBeLessThan(brightness(1.4));
    expect(brightness(9)).toBe(brightness(1.5));
  });
});

describe('울림', () => {
  it('임펄스 응답: 정한 길이, 에너지 1, 점점 사라짐, 같은 씨앗이면 같음', () => {
    const sr = 8000, { rt, pre } = ROOM_SPEC.hall;
    const [l, r] = impulseData(sr, rt, pre);
    expect(l.length).toBe(Math.ceil(sr * (pre + rt * 1.1)));
    const e = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s; };
    expect(e(l, 0, l.length)).toBeCloseTo(1, 3);
    expect(e(l, Math.floor(l.length * 0.9), l.length)).toBeLessThan(e(l, 0, Math.floor(l.length * 0.1)) / 1000);
    expect(Array.from(l.slice(0, 2000))).not.toEqual(Array.from(r.slice(0, 2000))); // 좌우가 달라 넓게
    expect(impulseData(sr, rt, pre)[0]).toEqual(l);
  });
  it('저장된 값이 없으면 연습실, 소리 기본은 바이올린', () => {
    expect(getRoom()).toBe('room');
    expect(getVoice()).toBe('sample');
  });
});

describe('음 끝 모양', () => {
  const ev = (art: ScoreNote['art']): PlayEvent => ({ note: { midi: 69, measure: 1, index: 0, beat: 0, dur: 1, art } as ScoreNote, time: 0, dur: 0.6 });
  it('보통은 줄이 조금 울리고, 이음줄은 짧게 겹쳐 넘기고, 스타카토는 짧게', () => {
    expect(noteShape(ev(undefined)).release).toBeGreaterThan(noteShape(ev({ slurNext: true })).release);
    expect(noteShape(ev({ stacc: true })).release).toBeLessThan(noteShape(ev(undefined)).release);
    expect(noteShape(ev({ slurIn: true })).slurIn).toBe(true);
    expect(noteShape(ev({ slurIn: true, stacc: true })).slurIn).toBe(false);
  });
});
