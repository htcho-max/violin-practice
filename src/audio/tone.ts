import { resumeAudio } from './context';
import { stringWave } from './timbre';

/** 기준음 재생. stop()을 돌려줍니다. durationSec 없으면 계속 재생 */
export async function playTone(freq: number, durationSec?: number, volume = 0.25): Promise<() => void> {
  const ctx = await resumeAudio();
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(stringWave(ctx));
  osc.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.05);
  osc.connect(lp).connect(g).connect(ctx.destination);
  osc.start(t);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + 0.15);
    osc.stop(now + 0.2);
  };
  if (durationSec) {
    g.gain.setValueAtTime(volume, t + durationSec - 0.2);
    g.gain.linearRampToValueAtTime(0, t + durationSec);
    osc.stop(t + durationSec + 0.05);
    stopped = true;
  }
  return stop;
}
