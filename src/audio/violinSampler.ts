import TUNING from './violinSamples.json';

/** 실제 바이올린 녹음 샘플 (public/violin, NOTICE.txt 참고). 처음 쓸 때 한 번 불러옴 */
const SAMPLES = Object.entries(TUNING as unknown as Record<string, [number, number]>)
  .map(([name, [midi, cents]]) => ({ name, midi, cents }))
  .sort((a, b) => a.midi - b.midi);

const buffers = new Map<string, AudioBuffer>();
let loading: Promise<boolean> | null = null;

export function samplesReady() { return buffers.size === SAMPLES.length; }

export function loadViolinSamples(ctx: BaseAudioContext): Promise<boolean> {
  if (!loading) {
    const base = import.meta.env.BASE_URL;
    loading = Promise.all(SAMPLES.map(async (s) => {
      const res = await fetch(`${base}violin/${s.name}.mp3`);
      if (!res.ok) throw new Error(s.name);
      buffers.set(s.name, await ctx.decodeAudioData(await res.arrayBuffer()));
    })).then(() => true, () => { loading = null; return false; });
  }
  return loading;
}

/** 가장 가까운 샘플과 재생 속도 (샘플 자체 음정 오차까지 보정) */
export function pickSample(midi: number, a4 = 440): { buffer: AudioBuffer; rate: number } | null {
  let best = SAMPLES[0];
  for (const s of SAMPLES) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
  const buffer = buffers.get(best.name);
  if (!buffer) return null;
  const semis = midi - best.midi - best.cents / 100 + 12 * Math.log2(a4 / 440);
  return { buffer, rate: Math.pow(2, semis / 12) };
}

const ONSET = 0.02; // 샘플 앞의 무음

/** 한 음 예약. 끝나는 노드를 돌려줌 */
export function scheduleViolinNote(
  ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, a4 = 440, gain = 1,
): AudioBufferSourceNode | null {
  const s = pickSample(midi, a4);
  if (!s) return null;
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = s.rate;
  const g = ctx.createGain();
  const len = Math.max(0.06, dur);
  const rel = Math.min(0.12, len * 0.3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.012);
  g.gain.setValueAtTime(gain, when + len - rel * 0.3);
  g.gain.linearRampToValueAtTime(0, when + len + rel);
  src.connect(g).connect(dest);
  src.start(when, ONSET);
  src.stop(when + len + rel + 0.02);
  return src;
}
