import { PitchDetector } from 'pitchy';
import { getAudioContext, resumeAudio } from './context';
import { analyzeFrame } from './analyze';
import { MedianWindow } from './smoothing';
import { clickNear } from './clicks';

/** freq: 화면 표시용(중앙값으로 부드럽게). raw: 짧은 창(2048)으로 잰 그대로의 값 (비브라토·녹음 분석용) */
export interface PitchReading { freq: number | null; raw: number | null; db: number; clarity: number; time: number }

/** raw 분석 창 길이(초)는 sampleRate 에 따라 다름 */
export const RAW_BUFFER = 2048;

const BUFFER = 4096;

/** 마이크 → 실시간 음높이. 여러 화면에서 같이 쓰도록 하나만 둡니다. */
class PitchTracker {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private detector = PitchDetector.forFloat32Array(BUFFER);
  private rawDetector = PitchDetector.forFloat32Array(RAW_BUFFER);
  private buf = new Float32Array(BUFFER);
  private median = new MedianWindow(5);
  private raf = 0;
  private listeners = new Set<(r: PitchReading) => void>();
  private silentFrames = 0;
  private lastFreq: number | null = null;
  minDb = -50;

  get running() { return this.stream !== null; }
  /** 녹음용으로 같은 마이크 스트림을 씀 */
  get mediaStream() { return this.stream; }
  get sampleRate() { return this.analyser?.context.sampleRate ?? 48000; }

  async start(): Promise<void> {
    if (this.stream) return;
    const ctx = await resumeAudio();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = BUFFER;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.median.reset();
    this.lastFreq = null;
  }

  subscribe(fn: (r: PitchReading) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const an = this.analyser;
    if (!an) return;
    const ctx = getAudioContext();
    an.getFloatTimeDomainData(this.buf);
    const now = ctx.currentTime;
    // 메트로놈 클릭이 분석 창 안에 있으면 직전 값을 유지
    if (clickNear(now, BUFFER / ctx.sampleRate)) {
      this.emit({ freq: this.lastFreq, raw: null, db: -Infinity, clarity: 0, time: performance.now() / 1000 });
      return;
    }
    const r = analyzeFrame(this.detector, this.buf, ctx.sampleRate, this.minDb);
    const raw = r.freq === null ? null : analyzeFrame(this.rawDetector, this.buf.subarray(BUFFER - RAW_BUFFER), ctx.sampleRate, this.minDb).freq;
    let freq: number | null = null;
    if (r.freq !== null) {
      // 반음 이상 튀면 새 음으로 보고 창을 비움
      if (this.lastFreq && Math.abs(1200 * Math.log2(r.freq / this.lastFreq)) > 80) this.median.reset();
      freq = this.median.push(r.freq);
      this.silentFrames = 0;
    } else if (++this.silentFrames > 6) {
      this.median.reset();
    } else {
      freq = this.lastFreq; // 잠깐의 끊김은 유지
    }
    this.lastFreq = freq;
    this.emit({ freq, raw, db: r.db, clarity: r.clarity, time: performance.now() / 1000 });
  };

  private emit(r: PitchReading) {
    this.listeners.forEach((fn) => fn(r));
  }
}

export const pitchTracker = new PitchTracker();
