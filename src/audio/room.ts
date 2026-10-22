/**
 * 울림 (리버브): 방·공연장 울림을 계산으로 만든 임펄스 응답으로 합성곱.
 * 녹음 샘플은 울림이 거의 없는 "마른" 소리라, 작은 울림만 더해도 실제 악기 소리처럼 들림.
 */
export type Room = 'off' | 'room' | 'hall';
export const ROOM_KEY = 'violin-reverb';
export const ROOMS: { id: Room; label: string }[] = [
  { id: 'off', label: '끔' },
  { id: 'room', label: '연습실' },
  { id: 'hall', label: '공연장' },
];

/** 울림 길이(RT60, 초)·앞 지연·젖은 소리 크기 */
export const ROOM_SPEC: Record<Exclude<Room, 'off'>, { rt: number; pre: number; wet: number; dry: number }> = {
  room: { rt: 0.9, pre: 0.008, wet: 0.2, dry: 1 },
  hall: { rt: 2.1, pre: 0.02, wet: 0.3, dry: 0.92 },
};

export function getRoom(): Room {
  try {
    const v = localStorage.getItem(ROOM_KEY);
    if (v === 'off' || v === 'room' || v === 'hall') return v;
  } catch { /* 저장소 못 씀 */ }
  return 'room';
}
export function setRoom(r: Room) {
  try { localStorage.setItem(ROOM_KEY, r); } catch { /* 무시 */ }
}

/** 같은 씨앗이면 같은 수열 (테스트·캐시용) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * 스테레오 임펄스 응답 (두 채널). 앞 지연 → 이른 반사 몇 개 → 점점 어두워지며 사라지는 꼬리.
 * 채널마다 에너지(제곱합)를 1 로 맞춤 → 젖은 소리 크기는 wet 값으로만 정함.
 */
export function impulseData(sr: number, rt: number, pre: number, seed = 7): [Float32Array, Float32Array] {
  const len = Math.ceil(sr * (pre + rt * 1.1));
  const out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101);
    const x = out[ch];
    const p0 = Math.floor(pre * sr);
    // 이른 반사: 8~70ms 사이 6개 (채널마다 다르게)
    for (let k = 0; k < 6; k++) {
      const t = 0.008 + r() * 0.062;
      const i = p0 + Math.floor(t * sr);
      if (i < len) x[i] += (r() < 0.5 ? -1 : 1) * (0.6 - k * 0.07);
    }
    // 꼬리: 지수 감쇠 잡음, 시간이 갈수록 높은 소리가 먼저 사라짐 (한 극 저역 통과)
    const T = len - p0;
    let y = 0;
    for (let i = 0; i < T; i++) {
      const t = i / sr;
      const n = r() * 2 - 1;
      const a = 0.15 + 0.7 * (i / T); // 처음엔 밝게, 끝은 어둡게
      y = a * y + (1 - a) * n;
      const fadeIn = Math.min(1, t / 0.012); // 꼬리는 반사 뒤에 부드럽게
      x[p0 + i] += y * Math.exp((-6.9 * t) / rt) * fadeIn * 0.9;
    }
    let e = 0;
    for (let i = 0; i < len; i++) e += x[i] * x[i];
    const k = e > 0 ? 1 / Math.sqrt(e) : 1;
    for (let i = 0; i < len; i++) x[i] *= k;
  }
  return out;
}

const irCache = new WeakMap<BaseAudioContext, Map<Room, AudioBuffer>>();
function impulse(ctx: BaseAudioContext, room: Exclude<Room, 'off'>): AudioBuffer {
  let m = irCache.get(ctx);
  if (!m) { m = new Map(); irCache.set(ctx, m); }
  const hit = m.get(room);
  if (hit) return hit;
  const { rt, pre } = ROOM_SPEC[room];
  const [l, r] = impulseData(ctx.sampleRate, rt, pre);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(l, 0);
  buf.copyToChannel(r, 1);
  m.set(room, buf);
  return buf;
}

/** 입력 → (마른 소리 + 울림) → dest. 울림 꼬리가 끝날 만큼 뒤에 dispose() 로 떼어 냄 */
export function roomBus(ctx: BaseAudioContext, room: Room, dest: AudioNode = ctx.destination): { input: GainNode; tail: number; dispose: () => void } {
  const input = ctx.createGain();
  if (room === 'off') {
    input.connect(dest);
    return { input, tail: 0, dispose: () => input.disconnect() };
  }
  const spec = ROOM_SPEC[room];
  const dry = ctx.createGain();
  dry.gain.value = spec.dry;
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = impulse(ctx, room);
  const wet = ctx.createGain();
  wet.gain.value = spec.wet;
  input.connect(dry).connect(dest);
  input.connect(conv).connect(wet).connect(dest);
  return {
    input,
    tail: spec.pre + spec.rt * 1.1,
    dispose: () => { for (const n of [input, dry, conv, wet]) n.disconnect(); },
  };
}
