import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { db } from '../data/db';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../data/settings';
import { setOutputLatency } from '../audio/latency';
import { SYNC_APPLIED_EVENT } from '../sync/engine';

interface Ctx { settings: Settings; update: (patch: Partial<Settings>) => void; ready: boolean }
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: () => {}, ready: false });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    db.kv.get('settings')
      .then((row) => setSettings(mergeSettings(row?.value as Partial<Settings> | undefined)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  // 다른 기기에서 바뀐 설정을 받았을 때 다시 읽기
  useEffect(() => {
    const re = () => { db.kv.get('settings').then((row) => setSettings(mergeSettings(row?.value as Partial<Settings> | undefined))).catch(() => {}); };
    window.addEventListener(SYNC_APPLIED_EVENT, re);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, re);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { db.kv.put({ key: 'settings', value: next }).catch(() => {}); }, 300);
      return next;
    });
  }, []);

  useEffect(() => { setOutputLatency(settings.latencyMs / 1000); }, [settings.latencyMs]);

  return <SettingsContext.Provider value={{ settings, update, ready }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
