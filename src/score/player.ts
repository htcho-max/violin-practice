import { resumeAudio } from '../audio/context';
import { stringWave } from '../audio/timbre';
import { midiToFreq } from '../audio/notes';
import type { ParsedScore, ScoreNote } from './parse';
import { loadViolinSamples, scheduleViolinNote } from '../audio/violinSampler';

export type Voice = 'sample' | 'synth';

export interface PlayEvent { note: ScoreNote; time: number; dur: number; inst?: 'violin' | 'piano' } // 초
/** 반주 파트 (parse 를 allNotes 로 읽은 것) */
export interface AccPart { score: ParsedScore; inst: 'violin' | 'piano' }
export type Plan = { events: PlayEvent[]; clicks: { time: number; accent: boolean }[]; total: number; acc: PlayEvent[] };
/** 파트 이름으로 소리 고르기 */
export const instFor = (name: string): 'violin' | 'piano' => (/piano|klavier|피아노|pf\.?$|keyboard|organ|harp|cembalo|harpsichord/i.test(name) ? 'piano' : 'violin');
export interface PlanOptions { bpm: number; from: number; to: number; countIn: boolean }

/** 구간의 음을 시간(초)으로. bpm 은 4분음표 기준 */
export function planPlayback(s: ParsedScore, o: PlanOptions, accParts: AccPart[] = []): Plan {
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
  const accEv: PlayEvent[] = [];
  for (const ap of accParts) {
    for (const n of ap.score.notes) if (start.has(n.measure)) accEv.push({ note: n, time: (start.get(n.measure)! + n.beat) * q, dur: n.dur * q, inst: ap.inst });
  }
  accEv.sort((a, b) => a.time - b.time);
  return { events, clicks, total: acc * q, acc: accEv };
}

/** 바이올린 비슷한 소리로 재생. stop() 을 돌려줌 */
export class ScorePlayer {
  private nodes: AudioScheduledSourceNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ctx: AudioContext | null = null;
  playing = false;
  usedSample = false;
  /** 첫 박(카운트인 포함 계획의 0초)의 AudioContext 시각 */
  startedAt = 0;

  async play(
    plan: Plan,
    opts: { a4: number; click: boolean; volume?: number; voice?: Voice; onNote?: (e: PlayEvent | null) => void; onEnd?: () => void; mute?: boolean; accVolume?: number },
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
    this.startedAt = t0;
    // 반주
    if (plan.acc.length) {
      const accGain = ctx.createGain();
      accGain.gain.value = opts.accVolume ?? 0.6;
      accGain.connect(master);
      for (const e of plan.acc) {
        const a = t0 + e.time;
        if (e.inst === 'piano') { this.nodes.push(...pianoNote(ctx, accGain, midiToFreq(e.note.midi, opts.a4), a, e.dur)); continue; }
        if (useSample) { const n = scheduleViolinNote(ctx, accGain, e.note.midi, a, e.dur * 0.98, opts.a4, 0.8); if (n) { this.nodes.push(n); continue; } }
        this.nodes.push(...pianoNote(ctx, accGain, midiToFreq(e.note.midi, opts.a4), a, e.dur));
      }
    }
    for (const e of plan.events) {
      const a0 = t0 + e.time;
      this.timers.push(setTimeout(() => opts.onNote?.(e), Math.max(0, (a0 - ctx.currentTime) * 1000)));
      if (opts.mute) continue;
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

/** 간단한 피아노 비슷한 소리 (반주용): 빠른 어택, 지수 감쇠 */
function pianoNote(ctx: AudioContext, out: AudioNode, f: number, a: number, dur: number): AudioScheduledSourceNode[] {
  const g = ctx.createGain();
  const len = Math.min(Math.max(dur, 0.15), 2.5) + 0.3;
  g.gain.setValueAtTime(0, a);
  g.gain.linearRampToValueAtTime(0.32, a + 0.008);
  g.gain.exponentialRampToValueAtTime(0.12, a + 0.25);
  g.gain.setTargetAtTime(0.0001, a + Math.max(0.2, dur * 0.95), 0.08);
  g.connect(out);
  const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o1.connect(g); o2.connect(g2).connect(g);
  o1.start(a); o2.start(a); o1.stop(a + len); o2.stop(a + len);
  return [o1, o2];
}

/** 재생 계획을 i 번째 음부터 잘라서 0초부터 시작하게 (재생 중 템포 바꿀 때) */
export function slicePlan(plan: Plan, i: number): Plan {
  const start = plan.events[i]?.time ?? 0;
  return {
    events: plan.events.slice(i).map((e) => ({ ...e, time: e.time - start })),
    clicks: plan.clicks.filter((c) => c.time >= start - 1e-6).map((c) => ({ ...c, time: c.time - start })),
    total: plan.total - start,
    acc: plan.acc.filter((e) => e.time >= start - 1e-6).map((e) => ({ ...e, time: e.time - start })),
  };
}
