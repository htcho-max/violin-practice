/** 셈여림(p f, 크레센도·디크레센도) → 음마다 세기. 위치는 곡 처음부터 4분음표 단위 */
export type DynEvent =
  | { pos: number; kind: 'dyn'; value: string }
  | { pos: number; kind: 'wedge'; type: 'cresc' | 'dim' | 'stop' }
  | { pos: number; kind: 'words'; type: 'cresc' | 'dim' };

export const DEFAULT_LEVEL = 0.78;
export const DYN_LEVEL: Record<string, number> = { ppp: 0.3, pp: 0.4, p: 0.52, mp: 0.65, mf: 0.78, f: 0.92, ff: 1.05, fff: 1.15 };
const STEP = 0.13;
const clamp = (v: number) => Math.max(0.3, Math.min(1.15, v));

interface Seg { t0: number; t1: number; v0: number; v1: number }

/** 각 위치(4분음표 단위)의 세기. 표시가 하나도 없으면 null */
export function velocities(positions: number[], events: DynEvent[]): number[] | null {
  if (!events.length) return null;
  // 글자 cresc./dim. 은 다음 셈여림 글자까지(최대 8박) 이어지는 꺾쇠로
  const ev: DynEvent[] = [];
  const marks = events.filter((e) => e.kind === 'dyn').sort((a, b) => a.pos - b.pos);
  for (const e of events) {
    if (e.kind !== 'words') { ev.push(e); continue; }
    const next = marks.find((m) => m.pos > e.pos + 1e-6 && m.pos <= e.pos + 8);
    ev.push({ pos: e.pos, kind: 'wedge', type: e.type }, { pos: next ? next.pos : e.pos + 8, kind: 'wedge', type: 'stop' });
  }
  const order = (e: DynEvent) => (e.kind === 'wedge' && e.type === 'stop' ? 0 : e.kind === 'dyn' ? 1 : 2);
  ev.sort((a, b) => a.pos - b.pos || order(a) - order(b));

  const segs: Seg[] = [{ t0: -Infinity, t1: Infinity, v0: DEFAULT_LEVEL, v1: DEFAULT_LEVEL }];
  const spikes = new Map<number, number>();
  let level = DEFAULT_LEVEL;
  let open: { s: number; a: number; type: 'cresc' | 'dim' } | null = null;
  const setConst = (t: number, v: number) => { segs.push({ t0: t, t1: Infinity, v0: v, v1: v }); level = v; };
  const dflt = (a: number, type: 'cresc' | 'dim') => clamp(a + (type === 'cresc' ? STEP : -STEP));
  const close = (t: number, target: number) => {
    if (!open) return;
    if (t > open.s) segs.push({ t0: open.s, t1: t, v0: open.a, v1: target });
    open = null;
    setConst(t, target);
  };
  for (const e of ev) {
    if (e.kind === 'dyn') {
      const v = e.value;
      if (v === 'sf' || v === 'sfz' || v === 'sffz' || v === 'rf' || v === 'rfz') { spikes.set(round(e.pos), Math.max(1.1, level + STEP)); continue; }
      if (v === 'fp') { spikes.set(round(e.pos), DYN_LEVEL.f); if (open) close(e.pos, DYN_LEVEL.p); else setConst(e.pos, DYN_LEVEL.p); continue; }
      const lv = DYN_LEVEL[v];
      if (lv === undefined) continue;
      if (open) close(e.pos, lv); else setConst(e.pos, lv);
      continue;
    }
    if (e.kind !== 'wedge') continue;
    if (e.type === 'stop') {
      if (!open) continue;
      const o: { s: number; a: number; type: 'cresc' | 'dim' } = open;
      const next = marks.find((m) => m.pos >= e.pos - 1e-6 && m.pos <= e.pos + 4 && DYN_LEVEL[m.value] !== undefined);
      close(e.pos, next ? DYN_LEVEL[next.value] : dflt(o.a, o.type));
    } else {
      if (open) close(e.pos, dflt(open.a, open.type));
      open = { s: e.pos, a: level, type: e.type };
    }
  }
  if (open) { const o: { s: number; a: number; type: 'cresc' | 'dim' } = open; close(o.s + 8, dflt(o.a, o.type)); }

  return positions.map((t) => {
    const sp = spikes.get(round(t));
    if (sp !== undefined) return sp;
    let best = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].t0 <= t + 1e-9 && t < segs[i].t1 - 1e-9 && segs[i].t0 >= segs[best].t0) best = i;
    const s = segs[best];
    if (!Number.isFinite(s.t1) || s.t1 === s.t0) return s.v0;
    return s.v0 + ((s.v1 - s.v0) * (t - s.t0)) / (s.t1 - s.t0);
  });
}
const round = (t: number) => Math.round(t * 1000) / 1000;

/** 내가 붙인 표시 (악보 위 "내 표시") */
export interface UserMark {
  bow?: 'up' | 'down';
  dyn?: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
  hair?: 'cresc' | 'dim' | 'end';
  text?: string;
}
export type UserMarks = Record<string, UserMark>;
export const markEmpty = (m: UserMark | undefined) => !m || (!m.bow && !m.dyn && !m.hair && !m.text?.trim());
