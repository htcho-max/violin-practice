import { useEffect } from 'react';

type Sentinel = { release: () => Promise<void> };
let sentinel: Sentinel | null = null;
let holders = 0;

async function acquire() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (wl && !sentinel) {
      const s = await wl.request('screen');
      // 기다리는 사이 더 이상 필요 없어졌으면 바로 풀기
      if (holders <= 0 || sentinel) s.release().catch(() => {}); else sentinel = s;
    }
  } catch { /* 지원 안 하면 무시 */ }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && holders > 0) { sentinel = null; acquire(); }
  });
}

/** active인 동안 화면이 꺼지지 않게 */
export function useWakeLock(active: boolean, enabled: boolean) {
  useEffect(() => {
    if (!active || !enabled) return;
    holders++;
    acquire();
    return () => {
      holders--;
      if (holders <= 0 && sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
    };
  }, [active, enabled]);
}
