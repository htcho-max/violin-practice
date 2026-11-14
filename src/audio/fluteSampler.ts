import MANIFEST from './fluteSamples.json';

/**
 * 플루트 소리 (반주·합주 파트용). 클라리넷·플룻 앱의 기본 플룻 소리와 같은 녹음:
 * VSCO 2 Community Edition 플루트 susvib (비브라토), CC0 — public/flute/NOTICE.txt.
 * 장3도~완전4도 간격 10음(C4~C7), 4초. 4초보다 긴 음은 지속음 구간을 파형 위상을 맞춰 겹쳐 이어 붙임.
 */
/** [파일 이름, 실음 midi, 샘플 자체 음정 오차(센트), 어택 길이(초)] */
export type FluteRow = [string, number, number, number];
export const FLUTE_ROWS: FluteRow[] = (MANIFEST as unknown as { vib: FluteRow[] }).vib;
/** 플루트 파트 이름 */
export const isFluteName = (name: string) => /flute|flöte|flauto|flûte|플루트|플룻|piccolo|피콜로/i.test(name) || /^fl\.?\s*\d*$/i.test(name.trim());

const buffers = new Map<string, AudioBuffer>();
let loading: Promise<boolean> | null = null;
export const fluteReady = () => FLUTE_ROWS.every((r) => buffers.has(r[0]));

export function loadFluteSamples(ctx: BaseAudioContext): Promise<boolean> {
  if (!loading) {
    const base = import.meta.env.BASE_URL;
    loading = Promise.all(FLUTE_ROWS.map(async ([name]) => {
      if (buffers.has(name)) return;
      const res = await fetch(`${base}flute/${name}.mp3`);
      if (!res.ok) throw new Error(name);
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    })).then(() => true, () => { loading = null; return false; });
  }
  return loading;
}

/** 가장 가까운 샘플과 재생 속도 (샘플 음정 오차까지 보정) */
export function chooseFlute(midi: number, a4 = 440): { row: FluteRow; rate: number } {
  let best = FLUTE_ROWS[0];
  for (const r of FLUTE_ROWS) if (Math.abs(r[1] - midi) < Math.abs(best[1] - midi)) best = r;
  const semis = midi - best[1] - best[2] / 100 + 12 * Math.log2(a4 / 440);
  return { row: best, rate: Math.pow(2, semis / 12) };
}

const START = 0.02; // 샘플 앞 (인코더 지연)
const XF = 0.3; // 긴 음: 다음 조각과 겹쳐 넘기는 시간
/** 샘플 지속음 -18 dBFS → 바이올린 샘플과 비슷한 크기로 */
const LOUD = 1.2;

export interface FluteOpts {
  /** 이음줄 안으로 들어오는 음: 혀 소리(어택)를 건너뛰고 부드럽게 */ slurIn?: boolean;
  accent?: boolean;
  /** 셈여림 세기 (mf=1, 0.35~1.5): 밝기 */ level?: number;
  /** 끝나고 사라지는 시간 (초) */ release?: number;
}

/** 한 음 예약 (midi 는 실음). 소리 나는 노드들을 돌려줌. 샘플이 아직 없으면 null */
export function scheduleFluteNote(
  ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, a4 = 440, gain = 1, o: FluteOpts = {},
): AudioBufferSourceNode[] | null {
  const pick = chooseFlute(midi, a4);
  const buffer = buffers.get(pick.row[0]);
  if (!buffer) return null;
  const rate = pick.rate, attack = pick.row[3];
  const level = Math.max(0.35, Math.min(1.5, o.level ?? 1));
  const g0 = gain * LOUD;
  const len = Math.max(0.06, dur);
  const rel = Math.max(0.04, o.release ?? 0.09);
  const env = ctx.createGain();
  const att = o.slurIn ? 0.05 : o.accent ? 0.006 : 0.012;
  env.gain.setValueAtTime(o.slurIn ? g0 * 0.35 : 0, when);
  env.gain.linearRampToValueAtTime(o.accent ? g0 * 1.25 : g0, when + att);
  if (o.accent) env.gain.linearRampToValueAtTime(g0, when + att + 0.12);
  env.gain.setValueAtTime(g0, Math.max(when + att + 0.13, when + len - 0.01));
  env.gain.setTargetAtTime(0, when + len, rel / 2);
  const stopAt = when + len + rel * 3;
  // 여리면 조금 어둡게, 세면 밝게
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(18000, 2500 + 9000 * (level / 1.5) ** 2);
  lp.Q.value = 0.5;
  env.connect(lp).connect(dest);
  const srcs: AudioBufferSourceNode[] = [];
  const first = o.slurIn ? START + attack : START;
  const loopFrom = Math.min(buffer.duration - 1.2, attack + 0.6);
  const root = pick.row[1] + pick.row[2] / 100;
  let t = when, off = first;
  for (let k = 0; k < 12; k++) {
    const avail = (buffer.duration - off - 0.08) / rate;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const xg = ctx.createGain();
    src.connect(xg).connect(env);
    const last = t + avail >= stopAt;
    if (k > 0) { xg.gain.setValueAtTime(0, t); xg.gain.linearRampToValueAtTime(1, t + XF); }
    if (!last) { xg.gain.setValueAtTime(1, t + avail - XF); xg.gain.linearRampToValueAtTime(0, t + avail); }
    src.start(t, off);
    src.stop(last ? stopAt : t + avail + 0.01);
    srcs.push(src);
    if (last) break;
    off = alignedOffset(buffer, off + (avail - XF) * rate, loopFrom, root);
    t = t + avail - XF;
  }
  return srcs;
}

/** 같은 녹음의 두 자리를 겹쳐 이을 때 위상 맞추기: target 근처에서 from 자리 파형과 가장 닮은 곳 (초) */
const alignCache = new WeakMap<AudioBuffer, Map<string, number>>();
export function alignedOffset(buf: AudioBuffer, from: number, target: number, rootMidi: number): number {
  const key = `${Math.round(from * 1000)}:${Math.round(target * 1000)}`;
  let m = alignCache.get(buf);
  if (!m) { m = new Map(); alignCache.set(buf, m); }
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const W = 2048, a = Math.floor(from * sr), t0 = Math.floor(target * sr);
  const span = Math.max(Math.round(0.12 * sr), Math.round(sr / (440 * Math.pow(2, (rootMidi - 69) / 12))));
  let best = t0;
  if (a + W < d.length) {
    let ea = 0;
    for (let i = 0; i < W; i++) ea += d[a + i] * d[a + i];
    const score = (t: number) => {
      let c = 0, et = 0;
      for (let i = 0; i < W; i++) { c += d[a + i] * d[t + i]; et += d[t + i] * d[t + i]; }
      return c / Math.sqrt(ea * et + 1e-12);
    };
    const lo = Math.max(0, t0 - span), hi = Math.min(d.length - W - 1, t0 + span);
    let bestC = -Infinity;
    for (let t = lo; t <= hi; t += 4) { const c = score(t); if (c > bestC) { bestC = c; best = t; } }
    const c0 = best;
    for (let t = Math.max(lo, c0 - 4); t <= Math.min(hi, c0 + 4); t++) { const c = score(t); if (c > bestC) { bestC = c; best = t; } }
  }
  const r = best / sr;
  m.set(key, r);
  return r;
}
