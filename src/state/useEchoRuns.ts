import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type EchoRun } from '../data/db';

/** 따라 하기 기록 (최근 순) */
export function useEchoRuns(): EchoRun[] {
  const [rows, setRows] = useState<EchoRun[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.echoRuns.orderBy('createdAt').reverse().toArray()).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}
