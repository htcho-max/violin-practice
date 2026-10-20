/**
 * 악보 따라가기 (메트로놈 없이): 연주한 음을 악보 음과 맞춰 지금 위치를 짐작한다.
 * - 확정된 음(onNote)으로 위치를 옮기고, 지금 울리는 음(live)으로 다음 음을 미리 보여 준다.
 * - 몇 음 건너뛰거나 틀려도 따라가고, 다른 곳에서 다시 시작하면 (연속 3음 일치) 그리로 옮긴다.
 */
export class ScoreFollower {
  /** 마지막으로 맞춘 악보 음 순번 (-1 = 아직 시작 전) */
  pos = -1;
  private recent: number[] = [];
  private misses = 0;
  private liveMidi: number | null = null;
  private liveCount = 0;

  constructor(private midis: number[], private look = 6) {}

  /** 지금 보여 줄 음 순번 */
  get current(): number { return this.shown; }
  private shown = -1;

  /** 끝난 음 하나. 바뀐 위치를 돌려줌 */
  onNote(midi: number): number {
    this.recent.push(midi);
    if (this.recent.length > 4) this.recent.shift();
    const j = this.find(midi, this.pos + 1);
    if (j >= 0) {
      this.pos = j; this.misses = 0;
    } else {
      this.misses++;
      // 틀린 음이지만 바로 다음 음 근처(±2반음)면 그 음을 친 것으로
      const nx = this.pos + 1;
      if (this.misses === 1 && nx < this.midis.length && Math.abs(this.midis[nx] - midi) <= 2) this.pos = nx;
      else if (this.misses >= 2) this.relocate();
    }
    this.shown = this.pos;
    this.liveMidi = null; this.liveCount = 0;
    return this.shown;
  }

  /** 지금 울리는 음 (한 프레임마다, 무음이면 null). 보여 줄 위치를 돌려줌 */
  onLive(midi: number | null): number {
    if (midi === this.liveMidi) this.liveCount++; else { this.liveMidi = midi; this.liveCount = 1; }
    if (midi === null || this.liveCount < 3) return this.shown;
    // 지금 울리는 음이 방금 맞춘 음과 같으면 그대로
    if (this.pos >= 0 && this.midis[this.pos] === midi && this.shown === this.pos) return this.shown;
    const j = this.find(midi, this.pos + 1, 3);
    if (j >= 0) this.shown = j;
    return this.shown;
  }

  /** 처음으로 */
  reset(): void { this.pos = -1; this.shown = -1; this.recent = []; this.misses = 0; this.liveMidi = null; this.liveCount = 0; }

  private find(midi: number, from: number, look = this.look): number {
    for (let j = Math.max(0, from); j < Math.min(this.midis.length, from + look); j++) if (this.midis[j] === midi) return j;
    return -1;
  }

  /** 최근 3~4음이 악보 다른 곳과 그대로 맞으면 그리로 (가까운 곳 먼저) */
  private relocate(): void {
    for (const len of [4, 3]) {
      if (this.recent.length < len) continue;
      const seq = this.recent.slice(-len);
      let best = -1, bestD = Infinity;
      for (let s = 0; s + len <= this.midis.length; s++) {
        let ok = true;
        for (let k = 0; k < len; k++) if (this.midis[s + k] !== seq[k]) { ok = false; break; }
        if (!ok) continue;
        const end = s + len - 1, d = Math.abs(end - this.pos);
        if (d < bestD) { bestD = d; best = end; }
      }
      if (best >= 0) { this.pos = best; this.misses = 0; return; }
    }
  }
}

/**
 * 지금 음이 있는 줄이 보이는 영역 위에서 2~3번째 줄에 오도록 스크롤할 양 (px, 아래로 +).
 * rowTop: 지금 줄 윗변, viewTop/viewH: 보이는 영역 (같은 좌표계), lineH: 줄 간격.
 * 이미 2~3번째 줄 자리면 null. 벗어나면 2번째 줄 자리(위에 한 줄 남김)로.
 */
export function followScrollDelta(rowTop: number, viewTop: number, viewH: number, lineH: number): number | null {
  const rel = rowTop - viewTop;
  const want = Math.min(lineH * 1.15, viewH * 0.3);
  const lo = Math.min(lineH * 0.5, want), hi = Math.max(want, Math.min(lineH * 2.2, viewH * 0.6));
  if (rel >= lo && rel <= hi) return null;
  return rel - want;
}
