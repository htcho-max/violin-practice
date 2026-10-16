import { resumeAudio } from './context';
import { TickScheduler, type Tick, type Meter } from './schedule';
import { noteClick, clearClicks } from './clicks';

export type ClickSound = 'beep' | 'wood';
const LOOKAHEAD = 0.1;

class Metronome {
  core = new TickScheduler();
  sound: ClickSound = 'wood';
  volume = 0.8;
  private ctx: AudioContext | null = null;
  private worker: Worker | null = null;
  private noise: AudioBuffer | null = null;
  private visualListeners = new Set<(t: Tick) => void>();
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  running = false;

  async start() {
    if (this.running) return;
    const ctx = await resumeAudio();
    this.ctx = ctx;
    if (!this.noise) this.noise = makeNoise(ctx);
    this.core.reset(ctx.currentTime + 0.08);
    this.running = true;
    if (!this.worker) {
      this.worker = new Worker(new URL('./tickWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = () => this.pump();
    }
    this.worker.postMessage('start');
    this.pump();
  }

  stop() {
    this.running = false;
    this.worker?.postMessage('stop');
    this.timeouts.forEach(clearTimeout);
    this.timeouts = [];
    clearClicks();
  }

  setBpm(b: number) { this.core.bpm = b; }
  setMeter(m: Meter) { this.core.meter = m; }
  setSubdivision(n: number) { this.core.subdivision = n; }
  setAccent(a: boolean) { this.core.accent = a; }

  onTick(fn: (t: Tick) => void): () => void {
    this.visualListeners.add(fn);
    return () => { this.visualListeners.delete(fn); };
  }

  private pump() {
    const ctx = this.ctx;
    if (!this.running || !ctx) return;
    for (const tick of this.core.advance(ctx.currentTime + LOOKAHEAD)) {
      this.play(ctx, tick);
      noteClick(tick.time);
      const delay = Math.max(0, (tick.time - ctx.currentTime) * 1000);
      const h = setTimeout(() => {
        this.timeouts = this.timeouts.filter((x) => x !== h);
        this.visualListeners.forEach((fn) => fn(tick));
      }, delay);
      this.timeouts.push(h);
    }
  }

  private play(ctx: AudioContext, tick: Tick) {
    const level = { accent: 1, secondary: 0.8, beat: 0.65, sub: 0.35 }[tick.kind] * this.volume;
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const t = tick.time;
    if (this.sound === 'beep') {
      const osc = ctx.createOscillator();
      osc.frequency.value = { accent: 1760, secondary: 1480, beat: 1320, sub: 990 }[tick.kind];
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.06);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = { accent: 2600, secondary: 2200, beat: 1800, sub: 1400 }[tick.kind];
      bp.Q.value = 4;
      g.gain.setValueAtTime(level * 3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(bp).connect(g);
      src.start(t);
      src.stop(t + 0.05);
    }
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.05);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  return b;
}

export const metronome = new Metronome();
