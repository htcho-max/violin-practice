import { pitchTracker } from './pitchTracker';
import { freqToNote } from './notes';

export type TrackPoint = [number, number | null, number | null]; // [초, 센트, midi]
const STEP = 0.05;

function pickMime(): string {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (MR.isTypeSupported?.(m)) return m;
  return '';
}

/** 녹음과 동시에 0.05초마다 음정(평균율 기준)을 기록 */
export class PracticeRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private unsub: (() => void) | null = null;
  private startedTracker = false;
  private t0 = 0;
  private nextT = 0;
  track: TrackPoint[] = [];
  mime = '';

  get recording() { return this.rec?.state === 'recording'; }
  get elapsed() { return this.rec ? performance.now() / 1000 - this.t0 : 0; }

  /** 상태를 처음으로 (스트림이 끊기거나 시작에 실패했을 때) */
  private reset() {
    this.unsub?.();
    this.unsub = null;
    this.rec = null;
    if (this.startedTracker) { pitchTracker.stop(); this.startedTracker = false; }
  }

  async start(a4: number) {
    if (this.rec && this.rec.state !== 'inactive') return;
    this.rec = null;
    try {
      if (!pitchTracker.running) { await pitchTracker.start(); this.startedTracker = true; }
      const stream = pitchTracker.mediaStream!;
      this.mime = pickMime();
      const rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime } : undefined);
      this.rec = rec;
      this.chunks = [];
      this.track = [];
      rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      // 스트림이 끊겨 저절로 멈춘 경우 (전화, 마이크 해제 등)
      rec.onstop = () => { if (this.rec === rec && !this.stopping) this.reset(); };
      rec.onerror = () => { if (this.rec === rec) this.reset(); };
      this.t0 = performance.now() / 1000;
      this.nextT = 0;
      this.unsub = pitchTracker.subscribe((r) => {
        const t = r.time - this.t0;
        if (t < this.nextT) return;
        this.nextT = Math.round((t + STEP) / STEP) * STEP;
        const n = r.freq ? freqToNote(r.freq, a4) : null;
        this.track.push([Math.round(t * 100) / 100, n ? Math.round(n.cents * 10) / 10 : null, n?.midi ?? null]);
      });
      rec.start(1000);
    } catch (e) {
      this.reset();
      throw e;
    }
  }

  private stopping = false;
  /** 녹음 중이 아니면 null */
  stop(): Promise<{ blob: Blob; track: TrackPoint[]; durationSec: number; mime: string } | null> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') { this.reset(); return Promise.resolve(null); }
    this.stopping = true;
    return new Promise((resolve) => {
      const durationSec = this.elapsed;
      rec.onstop = () => {
        const mime = rec.mimeType || this.mime || 'audio/webm';
        const out = { blob: new Blob(this.chunks, { type: mime }), track: this.track, durationSec, mime };
        this.stopping = false;
        this.reset();
        resolve(out);
      };
      this.unsub?.();
      this.unsub = null;
      try { rec.stop(); } catch { this.stopping = false; this.reset(); resolve(null); }
    });
  }
}

export const recorder = new PracticeRecorder();

/** 녹음 요약: 소리 난 시간, 평균 |센트|, ±10센트 안 비율 */
export function trackStats(track: TrackPoint[]): { voicedSec: number; meanAbs: number | null; within10: number | null } {
  const voiced = track.filter((p) => p[1] !== null) as [number, number, number][];
  if (!voiced.length) return { voicedSec: 0, meanAbs: null, within10: null };
  const meanAbs = voiced.reduce((a, p) => a + Math.abs(p[1]), 0) / voiced.length;
  const within10 = voiced.filter((p) => Math.abs(p[1]) <= 10).length / voiced.length;
  return { voicedSec: voiced.length * STEP, meanAbs, within10 };
}
