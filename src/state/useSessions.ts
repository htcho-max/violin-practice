import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Session } from '../data/db';

/** 저장된 연습 기록 (변경되면 자동 갱신) */
export function useSessions(): Session[] {
  const [rows, setRows] = useState<Session[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray()).subscribe({
      next: setRows,
      error: () => {},
    });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}
