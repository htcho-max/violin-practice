/** 최근 N개 값의 중앙값 */
export class MedianWindow {
  private values: number[] = [];
  constructor(private size = 5) {}
  push(v: number): number {
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
    const s = [...this.values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  reset() { this.values = []; }
  get length() { return this.values.length; }
}

/** 소리 크기(dBFS) */
export function rmsDb(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}
