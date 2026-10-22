import TUNING from './violinSamples.json';
import ENSEMBLE from './stringSamples.json';

/**
 * 실제 바이올린 녹음 샘플로 한 음씩 예약.
 * - solo: 바이올린 한 대 (public/violin, NOTICE.txt)
 * - ensemble: 현악 합주(바이올린 섹션), 세게/여리게 두 겹 (public/strings, CC0)
 * 긴 음은 샘플 가운데를 이음매 없이 되풀이(교차 페이드 루프)해서 끊기지 않게,
 * 이음줄 안 음은 활을 새로 긋지 않으니 샘플의 첫 활 소리를 건너뜀,
 * 셈여림에 따라 밝기(높은 배음)를 바꿈, 끝은 지수로 사라지며 울림으로 이어짐.
 */
export type SampleSet = 'solo' | 'ensemble';
interface Smp { name: string; midi: number; cents: number; layer: 'f' | 'p'; gain: number }
interface SetDef { dir: string; samples: Smp[]; loop: [number, number]; xfade: number; onset: number; /** 이음줄 안 음은 이만큼 더 건너뜀 */ slurSkip: number; minAttack: number }

const SETS: Record<SampleSet, SetDef> = {
  solo: {
    dir: 'violin',
    samples: Object.entries(TUNING as unknown as Record<string, [number, number]>)
      .map(([name, [midi, cents]]) => ({ name, midi, cents, layer: 'f' as const, gain: 1 }))
      .sort((a, b) => a.midi - b.midi),
    loop: [2.0, 5.6], xfade: 0.35, onset: 0.02, slurSkip: 0.12, minAttack: 0,
  },
  ensemble: {
    dir: 'strings',
    samples: Object.entries(ENSEMBLE as unknown as Record<string, [number, number, 'f' | 'p', number]>)
      .map(([name, [midi, cents, layer, gain]]) => ({ name, midi, cents, layer, gain }))
      .sort((a, b) => a.midi - b.midi),
    loop: [1.1, 2.8], xfade: 0.3, onset: 0.06, slurSkip: 0.2, minAttack: 0.03, // 합주 녹음은 처음 0.1초쯤 천천히 커져서 조금 건너뜀
  },
};
/** 합주 샘플이 없는 높은 음(D6 위 4반음 넘게)은 솔로 샘플로 */
export const ENSEMBLE_TOP = 90;

interface Loaded { buffer: AudioBuffer; loopStart: number; loopEnd: number }
const buffers: Record<SampleSet, Map<string, Loaded>> = { solo: new Map(), ensemble: new Map() };
const loading: Partial<Record<SampleSet, Promise<boolean>>> = {};

export function samplesReady(set: SampleSet = 'solo') { return buffers[set].size === SETS[set].samples.length; }

/**
 * 루프 이음매 만들기: 루프 끝 바로 앞 xf 초를 루프 시작 바로 앞 구간과 같은 힘(equal-power)으로 섞음.
 * 그러면 끝 → 시작으로 뛸 때 파형이 이어져 '딸깍'이나 음색 튐이 없음. data 를 그 자리에서 고침.
 * 돌려주는 값: 루프 시작·끝 (초)
 */
export function crossfadeLoop(data: Float32Array, sr: number, start: number, end: number, xf: number): { loopStart: number; loopEnd: number } {
  const e = Math.min(data.length, Math.floor(end * sr));
  const X = Math.max(1, Math.min(Math.floor(xf * sr), Math.floor(start * sr), Math.floor((e - start * sr) / 2)));
  const s = Math.floor(start * sr);
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X;
    const a = Math.cos((t * Math.PI) / 2), b = Math.sin((t * Math.PI) / 2);
    data[e - X + i] = data[e - X + i] * a + data[s - X + i] * b;
  }
  return { loopStart: s / sr, loopEnd: e / sr };
}

export function loadSampleSet(ctx: BaseAudioContext, set: SampleSet): Promise<boolean> {
  if (!loading[set]) {
    const base = import.meta.env.BASE_URL;
    const def = SETS[set];
    loading[set] = Promise.all(def.samples.map(async (s) => {
      const res = await fetch(`${base}${def.dir}/${s.name}.mp3`);
      if (!res.ok) throw new Error(s.name);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const d = buffer.getChannelData(0);
      const end = Math.min(def.loop[1], buffer.duration - 0.05);
      const lp = crossfadeLoop(d, buffer.sampleRate, def.loop[0], end, def.xfade);
      for (let ch = 1; ch < buffer.numberOfChannels; ch++) crossfadeLoop(buffer.getChannelData(ch), buffer.sampleRate, def.loop[0], end, def.xfade);
      buffers[set].set(s.name, { buffer, ...lp });
    })).then(() => true, () => { loading[set] = undefined; buffers[set].clear(); return false; });
  }
  return loading[set]!;
}
/** 예전 이름 (솔로) */
export const loadViolinSamples = (ctx: BaseAudioContext) => loadSampleSet(ctx, 'solo');

/**
 * 가장 가까운 샘플과 재생 속도 (샘플 자체 음정 오차까지 보정).
 * soft: 여리게 — 합주는 여린 겹이 3반음 안에 있으면 그것을.
 */
export function chooseSample(midi: number, set: SampleSet = 'solo', soft = false): Smp {
  const all = SETS[set].samples;
  const near = (ss: Smp[]) => ss.reduce((b, s) => (Math.abs(s.midi - midi) < Math.abs(b.midi - midi) ? s : b), ss[0]);
  if (soft) {
    const p = all.filter((s) => s.layer === 'p');
    if (p.length) { const q = near(p); if (Math.abs(q.midi - midi) <= 3) return q; }
  }
  return near(all.filter((s) => s.layer === 'f'));
}

export function pickSample(midi: number, a4 = 440, set: SampleSet = 'solo', soft = false): { buffer: AudioBuffer; rate: number; loopStart: number; loopEnd: number; gain: number } | null {
  const best = chooseSample(midi, set, soft);
  const b = buffers[set].get(best.name);
  if (!b) return null;
  const semis = midi - best.midi - best.cents / 100 + 12 * Math.log2(a4 / 440);
  return { ...b, rate: Math.pow(2, semis / 12), gain: best.gain };
}

/** 셈여림 세기(mf=1, 0.35~1.5) → 밝기 (저역 통과 주파수 Hz). 여리면 부드럽고 세면 밝게 */
export const brightness = (level: number) => 3500 * Math.pow(2, ((Math.max(0.35, Math.min(1.5, level)) - 0.35) / 1.15) * 2);

export interface NoteOpts {
  set?: SampleSet;
  /** 이음줄 안으로 들어오는 음 (활을 새로 긋지 않음) */
  slurIn?: boolean;
  /** 셈여림 세기 (mf=1) — 밝기·여린 겹 고르기 */
  level?: number;
  /** 끝나고 사라지는 시간 (초) */
  release?: number;
}

/** 한 음 예약. 끝나는 노드를 돌려줌 */
export function scheduleViolinNote(
  ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, a4 = 440, gain = 1, attack = 0.012, o: NoteOpts = {},
): AudioBufferSourceNode | null {
  let set = o.set ?? 'solo';
  if (set === 'ensemble' && (midi > ENSEMBLE_TOP || !samplesReady('ensemble'))) set = 'solo';
  const level = o.level ?? 1;
  const s = pickSample(midi, a4, set, level < 0.8);
  if (!s) return null;
  const def = SETS[set];
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = s.rate;
  const len = Math.max(0.06, dur);
  const rel = Math.max(0.03, o.release ?? Math.min(0.12, len * 0.3));
  const att = Math.max(def.minAttack, Math.min(attack, len * 0.5));
  // 이음줄 안 음은 앞의 활 긋는 소리를 건너뛰고 지속음부터
  const offset = def.onset + (o.slurIn ? def.slurSkip : 0);
  // 긴 음: 샘플이 모자라면 루프
  if ((len + rel * 2) * s.rate > s.loopEnd - offset - 0.02) {
    src.loop = true;
    src.loopStart = s.loopStart;
    src.loopEnd = s.loopEnd;
  }
  const peak = gain * s.gain;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + att);
  // 긴 음은 활이 조금 살아났다가 살짝 줄어듦 (너무 기계적이지 않게)
  if (len > 1) {
    g.gain.linearRampToValueAtTime(peak * 1.06, when + len * 0.45);
    g.gain.linearRampToValueAtTime(peak * 0.95, when + len);
  } else {
    g.gain.setValueAtTime(peak, when + Math.max(att, len - 0.001));
  }
  // 끝: 지수로 사라짐 (울림으로 자연스럽게 이어짐)
  g.gain.setTargetAtTime(0, when + len, rel / 4);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = brightness(level);
  lp.Q.value = 0.5;
  src.connect(lp).connect(g).connect(dest);
  src.start(when, offset);
  src.stop(when + len + rel * 1.6 + 0.02);
  return src;
}
