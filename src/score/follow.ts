/**
 * 악보 따라가기: 연주한 음을 악보 음과 맞춰 지금 위치를 짐작한다.
 * - 확정된 음(onNote)으로 위치를 옮기고, 지금 울리는 음(live)으로 바로 다음 음만 미리 보여 준다.
 * - 음정이 조금 틀려도(±TOL 반음) 다음 음으로 인정. 한 음 건너뛰기는 바로, 두 음 넘게 건너뛰면
 *   그다음 음까지 맞아야 옮김 (틀린 음이 우연히 몇 음 뒤와 같아서 튀지 않게).
 * - 다른 곳에서 다시 시작하면 최근 4음이 그대로 맞을 때만 옮기고, 멀리(24음 넘게)는 5음이 맞아야.
 */
export const TOL = 0.6;
const FAR = 24;

export class ScoreFollower {
  /** 마지막으로 맞춘 악보 음 순번 (-1 = 아직 시작 전) */
  pos = -1;
  private recent: number[] = [];
  private misses = 0;
  /** 두 음 넘게 건너뛴 후보 (다음 음으로 확인되면 옮김) */
  private pending: number | null = null;
  private liveMidi: number | null = null;
  private liveCount = 0;
  private shown = -1;

  constructor(private midis: number[], private look = 6) {}

  /** 지금 보여 줄 음 순번 */
  get current(): number { return this.shown; }

  private near(j: number, m: number, tol = TOL): boolean { return j >= 0 && j < this.midis.length && Math.abs(this.midis[j] - m) <= tol; }

  /** 끝난 음 하나 (반음 단위, 소수 가능 — 예: 64.3). 바뀐 위치를 돌려줌 */
  onNote(midi: number): number {
    const r = Math.round(midi);
    this.recent.push(r);
    if (this.recent.length > 5) this.recent.shift();
    this.liveMidi = null; this.liveCount = 0;
    // 몇 음째 안 맞으면 다른 곳에서 치는지 먼저 확인
    if (this.misses >= 2 && this.relocate()) return this.shown;
    const nx = this.pos + 1;
    if (this.near(nx, midi)) return this.accept(nx);
    // 건너뛴 후보가 이 음으로 확인되면
    if (this.pending !== null && this.near(this.pending + 1, midi)) return this.accept(this.pending + 1);
    // 방금 맞춘 음을 다시(활 바꿈 등) — 틀린 것 아님
    if (this.pos >= 0 && this.near(this.pos, midi)) return this.shown;
    const j = this.find(r, nx + 1);
    if (j === nx + 1) return this.accept(j); // 한 음 건너뜀
    this.misses++;
    if (j >= 0) { this.pending = j; return this.shown; }
    this.pending = null;
    // 틀린 음이지만 바로 다음 음 근처(±2반음)면 그 음을 친 것으로
    if (this.misses === 1 && this.near(nx, midi, 2)) { this.pos = nx; this.shown = nx; return this.shown; }
    return this.shown;
  }

  private accept(j: number): number {
    this.pos = j; this.shown = j; this.misses = 0; this.pending = null;
    return j;
  }

  /** 지금 울리는 음 (한 프레임마다, 무음이면 null, 소수 가능). 보여 줄 위치를 돌려줌 — 바로 다음 음만 미리 */
  onLive(midi: number | null): number {
    const r = midi === null ? null : Math.round(midi);
    if (r === this.liveMidi) this.liveCount++; else { this.liveMidi = r; this.liveCount = 1; }
    if (midi === null || this.liveCount < 5) return this.shown;
    if (this.shown === this.pos && this.near(this.pos + 1, midi)) this.shown = this.pos + 1;
    return this.shown;
  }

  /** 처음으로 */
  reset(): void { this.pos = -1; this.shown = -1; this.recent = []; this.misses = 0; this.pending = null; this.liveMidi = null; this.liveCount = 0; }

  private find(midi: number, from: number, look = this.look): number {
    for (let j = Math.max(0, from); j < Math.min(this.midis.length, from + look); j++) if (this.midis[j] === midi) return j;
    return -1;
  }

  /** 최근 4음(멀면 5음)이 악보 다른 곳과 그대로 맞으면 그리로 (가까운 곳 먼저) */
  private relocate(): boolean {
    const at = (len: number): number[] => {
      if (this.recent.length < len) return [];
      const seq = this.recent.slice(-len), out: number[] = [];
      for (let s = 0; s + len <= this.midis.length; s++) {
        let ok = true;
        for (let k = 0; k < len; k++) if (this.midis[s + k] !== seq[k]) { ok = false; break; }
        if (ok) out.push(s + len - 1);
      }
      return out;
    };
    const nearest = (c: number[]) => c.reduce((b, e) => (Math.abs(e - this.pos) < Math.abs(b - this.pos) ? e : b), c[0]);
    const c4 = at(4);
    if (!c4.length) return false;
    let best = nearest(c4);
    if (Math.abs(best - this.pos) > FAR) {
      const c5 = at(5);
      if (!c5.length) return false;
      best = nearest(c5);
    }
    this.accept(best);
    return true;
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
