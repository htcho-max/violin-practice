import { resumeAudio } from '../audio/context';
import { stringWave } from '../audio/timbre';
import { midiToFreq } from '../audio/notes';
import type { ParsedScore, ScoreNote } from './parse';
import { loadViolinSamples, scheduleViolinNote } from '../audio/violinSampler';

export type Voice = 'sample' | 'synth';

export interface PlayEvent { note: ScoreNote; time: number; dur: number } // 초
export interface PlanOptions { bpm: number; from: number; to: number; countIn: boolean }

/** 구간의 음을 시간(초)으로. bpm 은 4분음표 기준 */
export function planPlayback(s: ParsedScore, o: PlanOptions): { events: PlayEvent[]; clicks: { time: number; accent: boolean }[]; total: number } {
  const q = 60 / o.bpm;
  const [beats, unit] = s.time;
  const beatQ = 4 / unit; // 한 박 = 4분음표 몇 개
  const countQ = o.countIn ? beats * beatQ : 0;
  const start = new Map<number, number>();
  let acc = countQ;
  for (const m of s.measures) {
    if (m < o.from || m > o.to) continue;
    start.set(m, acc);
    acc += s.measureLen.get(m) ?? beats * beatQ;
  }
  const events = s.notes
    .filter((n) => start.has(n.measure))
    .map((n) => ({ note: n, time: (start.get(n.measure)! + n.beat) * q, dur: n.dur * q }));
  const clicks: { time: number; accent: boolean }[] = [];
  for (let k = 0; k * beatQ < acc - 1e-9; k++) {
    const tq = k * beatQ;
    clicks.push({ time: tq * q, accent: k % beats === 0 });
  }
  return { events, clicks, total: acc * q };
}

/** 바이올린 비슷한 소리로 재생. stop() 을 돌려줌 */
export class ScorePlayer {
  private nodes: AudioScheduledSourceNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ctx: AudioContext | null = null;
  playing = false;
  usedSample = false;

  async play(
    plan: ReturnType<typeof planPlayback>,
    opts: { a4: number; click: boolean; volume?: number; voice?: Voice; onNote?: (e: PlayEvent | null) => void; onEnd?: () => void },
  ) {
    this.stop();
    const ctx = await resumeAudio();
    this.ctx = ctx;
    this.playing = true;
    // 실제 바이올린 샘플 (못 불러오면 합성음으로)
    const useSample = (opts.voice ?? 'sample') === 'sample' && (await loadViolinSamples(ctx));
    this.usedSample = useSample;
    const t0 = ctx.currentTime + 0.15;
    const wave = stringWave(ctx);
    const master = ctx.createGain();
    master.gain.value = opts.volume ?? 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    lp.connect(master).connect(ctx.destination);
    for (const e of plan.events) {
      const a0 = t0 + e.time;
      this.timers.push(setTimeout(() => opts.onNote?.(e), Math.max(0, (a0 - ctx.currentTime) * 1000)));
      if (useSample) {
        // 다음 음과 살짝 겹치게 (레가토)
        const n = scheduleViolinNote(ctx, master, e.note.midi, a0, e.dur * 0.98, opts.a4, 0.9);
        if (n) { this.nodes.push(n); continue; }
      }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      const f = midiToFreq(e.note.midi, opts.a4);
      osc.frequency.value = f;
      // 살짝 늦게 들어오는 비브라토 (긴 음만)
      if (e.dur > 0.5) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t0 + e.time);
        depth.gain.linearRampToValueAtTime(f * 0.004, t0 + e.time + 0.35);
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t0 + e.time);
        lfo.stop(t0 + e.time + e.dur + 0.05);
        this.nodes.push(lfo);
      }
      const g = ctx.createGain();
      const a = t0 + e.time, len = Math.max(0.05, e.dur * 0.92);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(1, a + Math.min(0.03, len / 3));
      g.gain.setValueAtTime(0.85, a + len * 0.6);
      g.gain.linearRampToValueAtTime(0, a + len);
      osc.connect(g).connect(lp);
      osc.start(a);
      osc.stop(a + len + 0.02);
      this.nodes.push(osc);
    }
    const firstNote = plan.events.length ? plan.events[0].time : Infinity;
    for (const c of plan.clicks) {
      if (!opts.click && c.time >= firstNote - 1e-6) continue; // 카운트인만
      const osc = ctx.createOscillator();
      osc.frequency.value = c.accent ? 1760 : 1320;
      const g = ctx.createGain();
      const a = t0 + c.time;
      g.gain.setValueAtTime(c.accent ? 0.35 : 0.22, a);
      g.gain.exponentialRampToValueAtTime(0.001, a + 0.05);
      osc.connect(g).connect(ctx.destination);
      osc.start(a);
      osc.stop(a + 0.06);
      this.nodes.push(osc);
    }
    this.timers.push(setTimeout(() => { this.playing = false; opts.onNote?.(null); opts.onEnd?.(); }, (t0 - ctx.currentTime + plan.total) * 1000 + 100));
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const now = this.ctx?.currentTime ?? 0;
    for (const n of this.nodes) { try { n.stop(now); } catch { /* 이미 끝남 */ } }
    this.nodes = [];
    this.playing = false;
  }
}

export const scorePlayer = new ScorePlayer();
