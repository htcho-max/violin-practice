import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from './settings';
import { useWakeLock } from './wakeLock';
import { db } from '../data/db';
import { localDate } from '../data/dates';
import type { RoutineItem } from '../data/settings';

export interface ActiveSession {
  startedAt: number;
  items: RoutineItem[];
  index: number;
  accum: number[]; // 항목별 누적 ms
  runningSince: number | null; // null이면 일시정지
  pieces?: Record<string, string>; // 루틴 항목 → 곡 id
  /** 앱이 마지막으로 살아 있던 시각 (앱이 닫힌 동안 시간이 계속 쌓이지 않게) */
  lastSeen?: number;
}
/** 이만큼 넘게 앱이 꺼져 있었으면 그때 멈춘 것으로 */
const STALE_MS = 3 * 60 * 1000;

const STORE = 'violin-active-session';

function load(): ActiveSession | null {
  try {
    const s: ActiveSession | null = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s || !Array.isArray(s.items) || s.items.length === 0) return null;
    // 앱이 닫혀 있던 시간은 빼고 마지막으로 본 시각에 멈춤
    if (s.runningSince !== null && s.lastSeen && Date.now() - s.lastSeen > STALE_MS) return transitions.pause(s, Math.max(s.runningSince, s.lastSeen));
    return s;
  } catch { return null; }
}
function persist(s: ActiveSession | null) {
  try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch { /* 무시 */ }
}

export function itemMs(s: ActiveSession, i: number, now: number): number {
  return s.accum[i] + (i === s.index && s.runningSince !== null ? now - s.runningSince : 0);
}
export function totalMs(s: ActiveSession, now: number): number {
  return s.accum.reduce((a, _, i) => a + itemMs(s, i, now), 0);
}

/** 순수 상태 전이 (테스트용으로 export) */
export const transitions = {
  start(items: RoutineItem[], now: number): ActiveSession {
    return { startedAt: now, items, index: 0, accum: items.map(() => 0), runningSince: now };
  },
  pause(s: ActiveSession, now: number): ActiveSession {
    if (s.runningSince === null) return s;
    const accum = [...s.accum];
    accum[s.index] += now - s.runningSince;
    return { ...s, accum, runningSince: null };
  },
  resume(s: ActiveSession, now: number): ActiveSession {
    return s.runningSince === null ? { ...s, runningSince: now } : s;
  },
  goto(s: ActiveSession, index: number, now: number): ActiveSession {
    const wasRunning = s.runningSince !== null;
    const p = transitions.pause(s, now);
    return { ...p, index, runningSince: wasRunning ? now : null };
  },
};

interface Ctx {
  session: ActiveSession | null;
  now: number;
  start: (items: RoutineItem[]) => void;
  pause: () => void;
  resume: () => void;
  goto: (i: number) => void;
  finish: (memo?: string) => Promise<void>;
  discard: () => void;
  setPiece: (itemKey: string, pieceId: string | null) => void;
}
const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(load);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { persist(session && { ...session, lastSeen: Date.now() }); }, [session]);
  useEffect(() => {
    if (!session || session.runningSince === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    // 살아 있음 표시 (10초마다, 화면이 가려질 때)
    const mark = () => { try { const cur = JSON.parse(localStorage.getItem(STORE) || 'null'); if (cur) persist({ ...cur, lastSeen: Date.now() }); } catch { /* 무시 */ } };
    mark();
    const beat = setInterval(mark, 10000);
    const onHide = () => { if (document.visibilityState === 'hidden') mark(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(id); clearInterval(beat); document.removeEventListener('visibilitychange', onHide); };
  }, [session]);
  // 다시 화면에 돌아왔을 때 오래 꺼져 있었으면 그 시점에 멈춤
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      let seen = 0;
      try { seen = JSON.parse(localStorage.getItem(STORE) || 'null')?.lastSeen ?? 0; } catch { /* 무시 */ }
      setSession((s) => {
        if (!s || s.runningSince === null || !seen || Date.now() - seen <= STALE_MS) return s;
        return transitions.pause(s, Math.max(s.runningSince, seen));
      });
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
  // 연습 중 화면 꺼짐 방지는 세션 단위 (튜너·악보로 옮겨 가도 유지)
  const { settings } = useSettings();
  useWakeLock(!!session && session.runningSince !== null, settings.wakeLock);
  const saving = useRef(false);

  const start = useCallback((items: RoutineItem[]) => { if (!items.length) return; const t = Date.now(); setNow(t); setSession(transitions.start(items, t)); }, []);
  const pause = useCallback(() => setSession((s) => (s ? transitions.pause(s, Date.now()) : s)), []);
  const resume = useCallback(() => setSession((s) => (s ? transitions.resume(s, Date.now()) : s)), []);
  const goto = useCallback((i: number) => setSession((s) => (s ? transitions.goto(s, i, Date.now()) : s)), []);
  const discard = useCallback(() => setSession(null), []);
  const setPiece = useCallback((itemKey: string, pieceId: string | null) => setSession((s) => {
    if (!s) return s;
    const pieces = { ...(s.pieces ?? {}) };
    if (pieceId) pieces[itemKey] = pieceId; else delete pieces[itemKey];
    return { ...s, pieces };
  }), []);
  const finish = useCallback(async (memo?: string) => {
    if (!session || saving.current) return;
    saving.current = true;
    try {
    const t = Date.now();
    const done = transitions.pause(session, t);
    const items = done.items
      .map((it, i) => ({ key: it.key, label: it.label, sec: Math.round(done.accum[i] / 1000), ...(done.pieces?.[it.key] ? { pieceId: done.pieces[it.key] } : {}) }))
      .filter((it) => it.sec > 0);
    const totalSec = items.reduce((a, b) => a + b.sec, 0);
    if (totalSec > 0) {
      const date = localDate(new Date(done.startedAt));
      await db.sessions.add({ date, startedAt: done.startedAt, totalSec, items, memo: memo || undefined });
      for (const it of items) if (it.pieceId) await db.pieces.update(it.pieceId, { lastPracticed: date });
    }
    setSession(null);
    } finally { saving.current = false; }
  }, [session]);

  return (
    <SessionContext.Provider value={{ session, now, start, pause, resume, goto, finish, discard, setPiece }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error('SessionProvider 필요');
  return c;
}
