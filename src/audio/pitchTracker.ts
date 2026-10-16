import { PitchDetector } from 'pitchy';
import { getAudioContext, resumeAudio } from './context';
import { analyzeFrame } from './analyze';
import { MedianWindow } from './smoothing';
import { clickNear } from './clicks';

export interface PitchReading { freq: number | null; db: number; clarity: number; time: number }

const BUFFER = 4096;

/** 마이크 → 실시간 음높이. 여러 화면에서 같이 쓰도록 하나만 둡니다. */
class PitchTracker {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private detector = PitchDetector.forFloat32Array(BUFFER);
  private buf = new Float32Array(BUFFER);
  private median = new MedianWindow(5);
  private raf = 0;
  private listeners = new Set<(r: PitchReading) => void>();
  private silentFrames = 0;
  private lastFreq: number | null = null;
  minDb = -50;

  get running() { return this.stream !== null; }

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
      this.emit({ freq: this.lastFreq, db: -Infinity, clarity: 0, time: now });
      return;
    }
    const r = analyzeFrame(this.detector, this.buf, ctx.sampleRate, this.minDb);
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
    this.emit({ freq, db: r.db, clarity: r.clarity, time: now });
  };

  private emit(r: PitchReading) {
    this.listeners.forEach((fn) => fn(r));
  }
}

export const pitchTracker = new PitchTracker();
