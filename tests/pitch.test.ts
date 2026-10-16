import { describe, it, expect } from 'vitest';
import { PitchDetector } from 'pitchy';
import { analyzeFrame } from '../src/audio/analyze';
import { centsBetween, midiToFreq, freqToNote, nearestString } from '../src/audio/notes';

const SR = 48000;
const N = 4096;
const det = PitchDetector.forFloat32Array(N);

/** 바이올린처럼 배음이 강한 소리. 2배음이 기음보다 큰 경우도 시험 */
function tone(freq: number, harmonics: number[], noise = 0, phase = 0.3): Float32Array {
  const b = new Float32Array(N);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * freq * (k + 1) * (i / SR) + phase * k); });
    b[i] = 0.2 * v + noise * rnd();
  }
  return b;
}

const VIOLIN = [1, 0.8, 0.6, 0.5, 0.35, 0.3, 0.2, 0.15];
const STRONG_2ND = [0.4, 1, 0.7, 0.5, 0.3];

describe('음높이 감지 정확도 (G3~E6, ±3센트)', () => {
  const midis = Array.from({ length: 34 }, (_, i) => 55 + i); // G3(55) ~ E6(88)
  for (const spec of [{ name: '사인파', h: [1] }, { name: '바이올린형 배음', h: VIOLIN }, { name: '2배음 우세', h: STRONG_2ND }]) {
    it(spec.name, () => {
      let worst = 0;
      for (const m of midis) {
        for (const off of [-10, 0, 10]) {
          const f = midiToFreq(m) * Math.pow(2, off / 1200);
          const r = analyzeFrame(det, tone(f, spec.h, 0.01), SR, -60);
          expect(r.freq, `midi ${m} off ${off}`).not.toBeNull();
          const err = Math.abs(centsBetween(r.freq!, f));
          worst = Math.max(worst, err);
          expect(err, `midi ${m} off ${off}`).toBeLessThan(3);
        }
      }
      console.log(`${spec.name}: 최대 오차 ${worst.toFixed(2)}센트`);
    });
  }

  it('작은 소리는 무시', () => {
    const r = analyzeFrame(det, tone(440, [1]).map((v) => v * 0.001), SR, -50);
    expect(r.freq).toBeNull();
  });

  it('잡음만 있으면 무시', () => {
    const r = analyzeFrame(det, tone(440, [0], 0.3), SR, -60);
    expect(r.freq).toBeNull();
  });
});

describe('음이름', () => {
  it('A4 = 440, 센트 계산', () => {
    const n = freqToNote(445);
    expect(n.name).toBe('A');
    expect(n.octave).toBe(4);
    expect(n.cents).toBeCloseTo(19.56, 1);
  });
  it('A=442 기준', () => {
    expect(freqToNote(442, 442).cents).toBeCloseTo(0, 5);
  });
  it('가까운 개방현', () => {
    expect(nearestString(196.5).string.name).toBe('G');
    expect(nearestString(660).string.name).toBe('E');
    expect(nearestString(293).string.name).toBe('D');
  });
});
