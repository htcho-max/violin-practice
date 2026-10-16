export type TickKind = 'accent' | 'secondary' | 'beat' | 'sub';
export interface Tick { time: number; beat: number; sub: number; kind: TickKind }

export interface Meter { id: string; label: string; beats: number; secondary?: number[] }
export const METERS: Meter[] = [
  { id: '1', label: '박자 없음', beats: 1 },
  { id: '2/4', label: '2/4', beats: 2 },
  { id: '3/4', label: '3/4', beats: 3 },
  { id: '4/4', label: '4/4', beats: 4 },
  { id: '6/8', label: '6/8', beats: 6, secondary: [3] },
];

export interface Subdivision { id: number; label: string; count: number }
export const SUBDIVISIONS: Subdivision[] = [
  { id: 1, label: '♩', count: 1 },
  { id: 2, label: '♫ 8분', count: 2 },
  { id: 3, label: '셋잇단', count: 3 },
  { id: 4, label: '16분', count: 4 },
];

export const MIN_BPM = 30;
export const MAX_BPM = 250;
export const clampBpm = (b: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(b)));

/** 오디오 시계 기준으로 클릭 시각을 계산하는 순수 로직 (테스트 가능) */
export class TickScheduler {
  bpm = 80;
  meter: Meter = METERS[3];
  subdivision = 1;
  accent = true;
  nextTime = 0;
  private beat = 0;
  private sub = 0;

  reset(startTime: number) {
    this.nextTime = startTime;
    this.beat = 0;
    this.sub = 0;
  }

  /** until 이전까지 예약할 클릭들 */
  advance(until: number): Tick[] {
    const out: Tick[] = [];
    while (this.nextTime < until) {
      out.push({ time: this.nextTime, beat: this.beat, sub: this.sub, kind: this.kindOf(this.beat, this.sub) });
      this.nextTime += 60 / this.bpm / this.subdivision;
      this.sub++;
      if (this.sub >= this.subdivision) {
        this.sub = 0;
        this.beat = (this.beat + 1) % this.meter.beats;
      }
    }
    return out;
  }

  private kindOf(beat: number, sub: number): TickKind {
    if (sub > 0) return 'sub';
    if (this.accent && this.meter.beats > 1) {
      if (beat === 0) return 'accent';
      if (this.meter.secondary?.includes(beat)) return 'secondary';
    }
    return 'beat';
  }
}

/** 탭 템포: 최근 간격 평균. 2초 넘게 쉬면 다시 시작 */
export class TapTempo {
  private taps: number[] = [];
  tap(nowMs: number): number | null {
    if (this.taps.length && nowMs - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return clampBpm(60000 / (span / (this.taps.length - 1)));
  }
}
