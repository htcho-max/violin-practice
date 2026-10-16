export type LadderMode = 'bars' | 'success';
export interface LadderConfig { startBpm: number; targetBpm: number; step: number; mode: LadderMode; bars: number; successes: number }

/** 템포 트레이너: N마디마다, 또는 성공 N번마다 BPM을 올림 (순수 로직) */
export class TempoLadder {
  bpm: number;
  barCount = 0;
  successCount = 0;
  steps: { bpm: number; at: number }[] = [];
  done = false;

  constructor(public cfg: LadderConfig, now = 0) {
    this.bpm = cfg.startBpm;
    this.steps.push({ bpm: this.bpm, at: now });
    if (cfg.startBpm >= cfg.targetBpm) this.done = true;
  }

  /** 마디가 하나 끝날 때. BPM이 바뀌면 새 값을 돌려줌 */
  onBar(now = 0): number | null {
    if (this.done || this.cfg.mode !== 'bars') return null;
    if (++this.barCount < this.cfg.bars) return null;
    return this.raise(now);
  }

  /** 깨끗하게 연주했을 때 */
  success(now = 0): number | null {
    if (this.done || this.cfg.mode !== 'success') return null;
    if (++this.successCount < this.cfg.successes) return null;
    return this.raise(now);
  }

  /** 틀렸을 때: 성공 횟수를 처음부터 */
  fail() { this.successCount = 0; }

  get progress(): number {
    const span = this.cfg.targetBpm - this.cfg.startBpm;
    return span <= 0 ? 1 : Math.min(1, (this.bpm - this.cfg.startBpm) / span);
  }

  private raise(now: number): number {
    this.barCount = 0;
    this.successCount = 0;
    this.bpm = Math.min(this.cfg.targetBpm, this.bpm + this.cfg.step);
    this.steps.push({ bpm: this.bpm, at: now });
    if (this.bpm >= this.cfg.targetBpm) this.done = true;
    return this.bpm;
  }
}
