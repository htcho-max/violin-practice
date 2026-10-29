import { useEffect, useState } from 'react';
import { getStatus, loadConfig, onStatus, syncNow, type SyncStatus } from './engine';
import { onLocalChange } from './track';

let started = false;
/** 동기화가 켜져 있으면 알아서: 앱 열 때, 다시 볼 때, 바뀐 뒤 몇 초, 몇 분마다 */
export function startAutoSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => { if (loadConfig() && navigator.onLine !== false) syncNow().catch(() => {}); };
  const soon = (ms: number) => { if (!loadConfig()) return; if (timer) clearTimeout(timer); timer = setTimeout(run, ms); };
  soon(1500);
  onLocalChange(() => soon(5000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(500); else run(); });
  window.addEventListener('online', () => soon(1000));
  setInterval(() => { if (document.visibilityState === 'visible') run(); }, 120_000);
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(getStatus());
  useEffect(() => onStatus(setS), []);
  return s;
}
