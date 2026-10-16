import { describe, it, expect } from 'vitest';
import { PitchDetector } from 'pitchy';
import { analyzeFrame } from '../src/audio/analyze';
import { NoteSegmenter, equalRef, justRef, summarize } from '../src/audio/segment';
import { analyzeVibrato, windowGain, vibratoAdvice } from '../src/audio/vibrato';
import { JUST_RATIOS, midiToFreq, freqToMidiFloat } from '../src/audio/notes';

const SR = 48000;
const HARM = [1, 0.8, 0.6, 0.5, 0.35, 0.3, 0.2];

/** 주파수 곡선 f(t)를 따르는 바이올린형 소리 (위상 누적) */
function render(dur: number, f: (t: number) => number | null): Float32Array {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const fr = f(i / SR);
    if (fr === null) { out[i] = 0; continue; }
    ph += (2 * Math.PI * fr) / SR;
    let v = 0;
    HARM.forEach((a, k) => { v += a * Math.sin((k + 1) * ph); });
    out[i] = 0.12 * v;
  }
  return out;
}

/** 60fps 로 2048 샘플 창을 잘라 분석 (앱의 raw 경로와 같게) */
function track(sig: Float32Array, win = 2048): { t: number; f: number | null }[] {
  const det = PitchDetector.forFloat32Array(win);
  const out: { t: number; f: number | null }[] = [];
  for (let t = win / SR; t < sig.length / SR; t += 1 / 60) {
    const end = Math.floor(t * SR);
    out.push({ t, f: analyzeFrame(det, sig.subarray(end - win, end), SR, -60).freq });
  }
  return out;
}

describe('비브라토 분석 (실제 감지기 통과)', () => {
  for (const c of [{ rate: 5.5, width: 20 }, { rate: 6.5, width: 30 }, { rate: 4.5, width: 12 }]) {
    it(`${c.rate}Hz ±${c.width}센트`, () => {
      const base = midiToFreq(69);
      const sig = render(2, (t) => base * Math.pow(2, (c.width * Math.sin(2 * Math.PI * c.rate * t)) / 1200));
      const pts = track(sig).filter((p) => p.f).map((p) => ({ t: p.t, cents: (freqToMidiFloat(p.f!) - 69) * 100 }));
      const v = analyzeVibrato(pts.slice(-60), 2048 / SR)!;
      expect(v).not.toBeNull();
      console.log(`  ${c.rate}Hz ±${c.width} → ${v.rateHz.toFixed(2)}Hz ±${v.widthCents.toFixed(1)}, 중심 ${v.centerCents.toFixed(1)}`);
      expect(Math.abs(v.rateHz - c.rate)).toBeLessThan(0.3);
      expect(Math.abs(v.widthCents - c.width) / c.width).toBeLessThan(0.2);
      expect(Math.abs(v.centerCents)).toBeLessThan(4);
    });
  }

  it('위로 치우친 비브라토는 경고', () => {
    const base = midiToFreq(69);
    const sig = render(2, (t) => base * Math.pow(2, (15 + 20 * Math.sin(2 * Math.PI * 6 * t)) / 1200));
    const pts = track(sig).filter((p) => p.f).map((p) => ({ t: p.t, cents: (freqToMidiFloat(p.f!) - 69) * 100 }));
    const v = analyzeVibrato(pts.slice(-60), 2048 / SR)!;
    expect(v.topCents).toBeGreaterThan(25);
    expect(vibratoAdvice(v).join(' ')).toMatch(/위까지/);
  });

  it('흔들림 없는 음은 null', () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ t: i / 60, cents: 3 + (i % 2 ? 0.5 : -0.5) }));
    expect(analyzeVibrato(pts)).toBeNull();
  });

  it('창 감쇠 계산', () => {
    expect(windowGain(6, 2048 / 48000)).toBeCloseTo(0.896, 2);
  });
});

describe('음 나누기', () => {
  /** 음 목록(주파수 곡선)을 세그먼터에 통과 */
  function run(sig: Float32Array, ref = equalRef(440)) {
    const seg = new NoteSegmenter(ref);
    const notes = [];
    for (const p of track(sig, 4096)) { const n = seg.push(p.t, p.f); if (n) notes.push(n); }
    const last = seg.flush(); if (last) notes.push(last);
    return notes;
  }

  it('음계 4음, 각 음의 평균 오차', () => {
    const plan = [{ m: 69, c: 0 }, { m: 71, c: 12 }, { m: 73, c: -8 }, { m: 74, c: 4 }];
    const sig = render(2.4, (t) => { const p = plan[Math.min(3, Math.floor(t / 0.6))]; return midiToFreq(p.m) * Math.pow(2, p.c / 1200); });
    const notes = run(sig);
    expect(notes.map((n) => n.midi)).toEqual([69, 71, 73, 74]);
    notes.forEach((n, i) => expect(Math.abs(n.meanCents - plan[i].c)).toBeLessThan(2));
    expect(summarize(notes)[0].midi).toBe(71); // 가장 많이 틀린 음
  });

  it('도착 음정이 높았다가 고쳐 잡으면 corrected', () => {
    // 이동해서 +25센트로 도착, 0.35초 뒤 0으로 고침
    const sig = render(1.6, (t) => (t < 0.5 ? midiToFreq(71) : midiToFreq(74) * Math.pow(2, (t < 0.85 ? 25 : 0) / 1200)));
    const notes = run(sig);
    const d = notes.find((n) => n.midi === 74)!;
    expect(d.arrivalCents).toBeGreaterThan(18);
    expect(Math.abs(d.settledCents!)).toBeLessThan(8);
    expect(d.corrected).toBe(true);
  });

  it('바로 정확히 도착하면 corrected 아님', () => {
    const sig = render(1.4, (t) => (t < 0.5 ? midiToFreq(71) : midiToFreq(74)));
    const d = run(sig).find((n) => n.midi === 74)!;
    expect(d.corrected).toBe(false);
  });

  it('무음 사이 같은 음 두 번 = 두 음', () => {
    const sig = render(1.6, (t) => (t > 0.6 && t < 0.9 ? null : midiToFreq(69)));
    expect(run(sig).length).toBe(2);
  });

  it('드론(G) 기준 순정 장3도 B는 0센트', () => {
    const g = 55;
    const sig = render(1, () => midiToFreq(g) * 2 * 1.25); // B4 순정
    const n = run(sig, justRef(g, 440, JUST_RATIOS))[0];
    expect(n.midi).toBe(71);
    expect(Math.abs(n.meanCents)).toBeLessThan(2);
  });
});
