import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../data/db';
import type { DrillLadder } from '../score/practice';

const KEY = 'drill-ladders';
/** 마디별 템포 사다리 ("악보id:마디" → 상태). 다른 날에도 이어서 */
export function useDrills(): Record<string, DrillLadder> {
  const [v, setV] = useState<Record<string, DrillLadder>>({});
  useEffect(() => {
    const sub = liveQuery(() => db.kv.get(KEY)).subscribe({ next: (r) => setV((r?.value as Record<string, DrillLadder>) ?? {}), error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return v;
}
export async function saveDrill(key: string, l: DrillLadder | null) {
  await db.transaction('rw', db.kv, async () => {
    const all = { ...(((await db.kv.get(KEY))?.value as Record<string, DrillLadder>) ?? {}) };
    if (l) all[key] = l; else delete all[key];
    await db.kv.put({ key: KEY, value: all });
  });
}
