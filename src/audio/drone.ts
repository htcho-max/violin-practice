import { resumeAudio } from './context';
import { stringWave } from './timbre';

export interface DroneVoice { freq: number; gain: number }

/** 지속음. 으뜸음 + (선택) 순정 5도 */
export class Drone {
  private nodes: { osc: OscillatorNode; g: GainNode }[] = [];
  private master: GainNode | null = null;
  volume = 0.3;

  get playing() { return this.nodes.length > 0; }

  async start(voices: DroneVoice[]) {
    const ctx = await resumeAudio();
    this.stop(0.05);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(master).connect(ctx.destination);
    const wave = stringWave(ctx);
    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = v.freq;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(lp);
      osc.start();
      this.nodes.push({ osc, g });
    }
    this.master = master;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) {
      const ctx = this.master.context;
      this.master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    }
  }

  stop(fade = 0.4) {
    if (!this.master) return;
    const ctx = this.master.context;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + fade);
    this.nodes.forEach(({ osc }) => osc.stop(now + fade + 0.05));
    this.nodes = [];
    this.master = null;
  }
}

export const drone = new Drone();

/** 조성 프리셋 (스즈키 4권 곡 기준) */
export interface DronePreset { id: string; label: string; rootMidi: number }
export const DRONE_PRESETS: DronePreset[] = [
  { id: 'G', label: 'G장조', rootMidi: 55 },
  { id: 'D', label: 'D장조', rootMidi: 62 },
  { id: 'Am', label: 'A단조', rootMidi: 57 },
  { id: 'Dm', label: 'D단조', rootMidi: 62 },
];
