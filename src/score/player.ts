import { resumeAudio } from '../audio/context';
import { stringWave } from '../audio/timbre';
import { midiToFreq } from '../audio/notes';
import type { ParsedScore, ScoreNote } from './parse';
import { loadViolinSamples, scheduleViolinNote } from '../audio/violinSampler';
import { noteClick, clearClicks } from '../audio/clicks';
import { outputLatency } from '../audio/latency';

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
  return applyFermatas({ events, clicks, total: acc * q, acc: accEv });
}

/** 늘임표: 그 음을 1.8배로 늘리고 뒤는 그만큼 밀기 (재생 때만. 채점 기준 박 위치는 그대로) */
export const FERMATA = 1.8;
export function applyFermatas(plan: Plan): Plan {
  const wins = plan.events.filter((e) => e.note.art?.fermata).map((e) => ({ s: e.time, d: e.dur, x: e.dur * (FERMATA - 1) }));
  if (!wins.length) return plan;
  const w = (t: number) => {
    let out = t;
    for (const v of wins) {
      if (t >= v.s + v.d - 1e-9) out += v.x;
      else if (t > v.s) out += ((t - v.s) / v.d) * v.x;
    }
    return out;
  };
  const ev = (e: PlayEvent): PlayEvent => { const a = w(e.time), b = w(e.time + e.dur); return { ...e, time: a, dur: b - a }; };
  return { events: plan.events.map(ev), acc: plan.acc.map(ev), clicks: plan.clicks.map((c) => ({ ...c, time: w(c.time) })), total: w(plan.total) };
}

/** 꾸밈음·트릴 등을 실제로 낼 짧은 음들로 (시각은 계획의 초). 꾸밈 없는 음은 그 음 하나 */
export interface Piece { midi: number; time: number; len: number; legato: boolean }
export const GRACE = 0.07;
/** 몇 초 앞까지 미리 예약할지 */
const AHEAD = 2.5;
export function expandOrnaments(e: PlayEvent, len: number): Piece[] {
  const a = e.note.art ?? {};
  const out: Piece[] = [];
  const g = a.grace ?? [];
  g.forEach((m, k) => out.push({ midi: m, time: Math.max(0, e.time - (g.length - k) * GRACE), len: GRACE * 0.95, legato: true }));
  const o = a.orn;
  if (!o) { out.push({ midi: e.note.midi, time: e.time, len, legato: false }); return out; }
  const step = Math.min(0.075, Math.max(0.04, e.dur / 4));
  const M = e.note.midi;
  let seq: number[];
  if (o.kind === 'trill') {
    const n = Math.max(2, Math.floor(len / step));
    seq = Array.from({ length: n }, (_, k) => (k % 2 ? o.upper : M));
    seq[seq.length - 1] = M; // 끝은 원래 음
  } else if (o.kind === 'invmordent') seq = [M, o.upper];
  else if (o.kind === 'mordent') seq = [M, o.lower];
  else seq = [o.upper, M, o.lower];
  seq.forEach((m, k) => out.push({ midi: m, time: e.time + k * step, len: step * 1.02, legato: k > 0 }));
  // 남은 길이는 원래 음으로 (트릴은 이미 끝까지 채움)
  const used = seq.length * step;
  if (o.kind !== 'trill' && len - used > 0.02) out.push({ midi: M, time: e.time + used, len: len - used, legato: true });
  else if (o.kind === 'trill') out[out.length - 1].len = Math.max(step, len - (seq.length - 1) * step);
  return out;
}

/** 연주법에 따라 소리 내는 길이·어택·세기 (초 단위 길이 dur 기준) */
export interface NoteShape { len: number; attack: number; gain: number; pizz: boolean }
export function noteShape(e: PlayEvent): NoteShape {
  const a = e.note.art ?? {};
  const d = e.dur;
  let len: number;
  if (a.stacc && a.tenuto) len = d * 0.75; // 포르타토
  else if (a.stacc) len = a.slurNext || a.slurIn ? Math.max(0.07, d * 0.55) : Math.max(0.06, Math.min(d * 0.45, 0.35)); // 같은 활 스타카토는 조금 길게
  else if (a.slurNext) len = d + 0.04; // 이음줄: 다음 음과 살짝 겹쳐 끊김 없이
  else if (a.tenuto) len = d * 0.98;
  else len = d * 0.86; // 보통(데타셰): 활 바꾸는 틈
  // 이음줄 안으로 들어오는 음은 새로 긋지 않으니 부드럽게
  let attack = a.slurIn && !a.stacc ? 0.04 : 0.012;
  let gain = a.slurIn && !a.accent ? 0.85 : 1;
  if (a.accent) { gain = 1.35; attack = 0.005; }
  if (a.bow === 'down' && !a.slurIn && !a.accent) attack = Math.min(attack, 0.009); // 내림활은 조금 또렷하게
  // 셈여림 (mf 기준)
  if (a.vel !== undefined) gain *= Math.max(0.35, Math.min(1.5, a.vel / 0.78));
  return { len, attack, gain, pizz: !!a.pizz };
}

const pluckCache = new Map<string, AudioBuffer>();
/** 피치카토: 카플러스-스트롱 줄 뜯는 소리 (음높이별로 한 번 만들어 둠) */
function pluckBuffer(ctx: BaseAudioContext, f: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${Math.round(f * 10)}`;
  const hit = pluckCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate, n = Math.floor(sr * 1.2);
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  const period = sr / f;
  const L = Math.max(2, Math.floor(period));
  const frac = period - L;
  const line = new Float32Array(L + 1);
  for (let i = 0; i <= L; i++) line[i] = Math.random() * 2 - 1;
  // 조금 부드럽게 (손가락으로 뜯는 소리)
  for (let i = 1; i <= L; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  let idx = 0, prev = 0;
  const decay = 0.996;
  for (let i = 0; i < n; i++) {
    const j = (idx + 1) % (L + 1);
    const v = line[idx] * (1 - frac) + line[j] * frac;
    const y = decay * 0.5 * (v + prev);
    prev = v;
    out[i] = line[idx];
    line[idx] = y;
    idx = j;
  }
  // 크기 맞추기
  let peak = 0; for (let i = 0; i < Math.min(n, 2000); i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  pluckCache.set(key, buf);
  return buf;
}
function pluckNote(ctx: BaseAudioContext, out: AudioNode, f: number, a: number, dur: number, gain: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, f);
  const g = ctx.createGain();
  const len = Math.min(1.1, Math.max(0.25, dur));
  g.gain.setValueAtTime(0.55 * gain, a);
  g.gain.setTargetAtTime(0.0001, a + len * 0.8, 0.06);
  src.connect(g).connect(out);
  src.start(a);
  src.stop(a + len + 0.3);
  return src;
}

/** 바이올린 비슷한 소리로 재생. stop() 을 돌려줌 */
export class ScorePlayer {
  /** 아직 소리 나는(또는 예약된) 노드 — 끝나면 저절로 빠짐 */
  private nodes = new Set<AudioScheduledSourceNode>();
  private keep = (...ns: AudioScheduledSourceNode[]) => {
    for (const n of ns) { this.nodes.add(n); n.addEventListener?.('ended', () => this.nodes.delete(n)); }
  };
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ctx: AudioContext | null = null;
  playing = false;
  usedSample = false;
  /** 첫 박(카운트인 포함 계획의 0초)의 AudioContext 시각 */
  startedAt = 0;
  /** play/stop 할 때마다 증가: 샘플을 불러오는 동안 멈추거나 다시 누르면 앞의 재생은 취소 */
  private gen = 0;

  async play(
    plan: Plan,
    opts: { a4: number; click: boolean | 'visual'; onBeat?: (k: number, accent: boolean) => void; volume?: number; voice?: Voice; onNote?: (e: PlayEvent | null, idx?: number) => void; onEnd?: () => void; mute?: boolean; accVolume?: number },
  ) {
    this.stop();
    const gen = this.gen;
    const ctx = await resumeAudio();
    if (gen !== this.gen) return;
    this.ctx = ctx;
    // 실제 바이올린 샘플 (못 불러오면 합성음으로)
    const useSample = (opts.voice ?? 'sample') === 'sample' && (await loadViolinSamples(ctx));
    if (gen !== this.gen) return;
    this.playing = true;
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
    const accGain = ctx.createGain();
    accGain.gain.value = opts.accVolume ?? 0.6;
    accGain.connect(master);
    // 화면 표시(지금 음·박 깜빡임)는 기기 출력 지연 + 이어폰 지연 보정만큼 늦춤
    const lat = ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0) + outputLatency();
    const visual = (abs: number, fn: () => void) => this.timers.push(setTimeout(fn, Math.max(0, (abs - ctx.currentTime + lat) * 1000)));

    /** 바이올린 소리 한 음 (샘플 → 합성음) */
    const violinTone = (out: AudioNode, synthOut: AudioNode, midi: number, a: number, len: number, gain: number, attack: number, vib: boolean) => {
      if (useSample) { const n = scheduleViolinNote(ctx, out, midi, a, len, opts.a4, gain, attack); if (n) { this.keep(n); return; } }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      const f = midiToFreq(midi, opts.a4);
      osc.frequency.value = f;
      // 살짝 늦게 들어오는 비브라토 (긴 음만)
      if (vib) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, a);
        depth.gain.linearRampToValueAtTime(f * 0.004, a + 0.35);
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(a);
        lfo.stop(a + len + 0.05);
        this.keep(lfo);
      }
      const g = ctx.createGain();
      const L = Math.max(0.05, len), gg = gain / 0.9;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(gg, a + Math.min(Math.max(0.03, attack), L / 3));
      g.gain.setValueAtTime(0.85 * gg, a + L * 0.6);
      g.gain.linearRampToValueAtTime(0, a + L);
      osc.connect(g).connect(synthOut);
      osc.start(a);
      osc.stop(a + L + 0.02);
      this.keep(osc);
    };
    const playEvent = (e: PlayEvent, out: AudioNode, synthOut: AudioNode, base: number) => {
      const sh = noteShape(e);
      for (const pc of expandOrnaments(e, sh.len)) {
        const a = t0 + pc.time;
        const isMain = pc.time === e.time && pc.midi === e.note.midi && !e.note.art?.orn;
        if (sh.pizz) { this.keep(pluckNote(ctx, out, midiToFreq(pc.midi, opts.a4), a, isMain ? e.dur : pc.len, sh.gain)); continue; }
        violinTone(out, synthOut, pc.midi, a, pc.len, base * sh.gain, pc.legato ? 0.008 : sh.attack, isMain && e.dur > 0.5);
      }
    };

    // 예약할 일: 시각(계획의 초)과 실제로 예약하는 함수. 2.5초 앞까지만 조금씩 예약해 긴 곡도 가볍게
    type Job = { at: number; run: () => void };
    const jobs: Job[] = [];
    for (const e of plan.acc) {
      jobs.push({ at: Math.max(0, e.time - GRACE * (e.note.art?.grace?.length ?? 0)), run: () => {
        if (e.inst === 'piano') { this.keep(...pianoNote(ctx, accGain, midiToFreq(e.note.midi, opts.a4), t0 + e.time, e.dur)); return; }
        if (!useSample) { this.keep(...pianoNote(ctx, accGain, midiToFreq(e.note.midi, opts.a4), t0 + e.time, e.dur)); return; }
        playEvent(e, accGain, accGain, 0.8);
      } });
    }
    for (const [idx, e] of plan.events.entries()) {
      jobs.push({ at: Math.max(0, e.time - GRACE * (e.note.art?.grace?.length ?? 0)), run: () => {
        visual(t0 + e.time, () => opts.onNote?.(e, idx));
        if (!opts.mute) playEvent(e, master, lp, 0.9);
      } });
    }
    const firstNote = plan.events.length ? plan.events[0].time : Infinity;
    for (const [k, c] of plan.clicks.entries()) {
      jobs.push({ at: c.time, run: () => {
        // 눈으로 보는 박자 (깜빡임)
        if (opts.onBeat) visual(t0 + c.time, () => opts.onBeat?.(k, c.accent));
        if (opts.click === 'visual') return; // 소리 없이
        if (!opts.click && c.time >= firstNote - 1e-6) return; // 카운트인만
        const a = t0 + c.time;
        noteClick(a); // 음높이 분석에서 클릭 소리는 빼도록 (실제 소리 나는 시각)
        const osc = ctx.createOscillator();
        osc.frequency.value = c.accent ? 1760 : 1320;
        const g = ctx.createGain();
        g.gain.setValueAtTime(c.accent ? 0.35 : 0.22, a);
        g.gain.exponentialRampToValueAtTime(0.001, a + 0.05);
        osc.connect(g).connect(ctx.destination);
        osc.start(a);
        osc.stop(a + 0.06);
        this.keep(osc);
      } });
    }
    jobs.sort((a, b) => a.at - b.at);
    let ptr = 0;
    const pump = () => {
      if (gen !== this.gen) return;
      const horizon = ctx.currentTime + AHEAD - t0;
      while (ptr < jobs.length && jobs[ptr].at <= horizon) jobs[ptr++].run();
      if (ptr >= jobs.length && this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
    };
    pump();
    if (ptr < jobs.length) this.pumpTimer = setInterval(pump, 250);
    this.timers.push(setTimeout(() => { this.playing = false; opts.onNote?.(null); opts.onEnd?.(); }, (t0 - ctx.currentTime + plan.total + lat) * 1000 + 100));
  }

  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  stop() {
    this.gen++;
    if (this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
    clearClicks();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const now = this.ctx?.currentTime ?? 0;
    for (const n of this.nodes) { try { n.stop(now); } catch { /* 이미 끝남 */ } }
    this.nodes.clear();
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
