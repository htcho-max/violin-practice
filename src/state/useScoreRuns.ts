import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type ScoreRun } from '../data/db';

/** 악보 연습 기록 (scoreId 를 주면 그 악보만) */
export function useScoreRuns(scoreId?: number): ScoreRun[] {
  const [rows, setRows] = useState<ScoreRun[]>([]);
  useEffect(() => {
    const q = () => (scoreId === undefined
      ? db.scoreRuns.orderBy('createdAt').reverse().toArray()
      : db.scoreRuns.where('scoreId').equals(scoreId).reverse().sortBy('createdAt'));
    const sub = liveQuery(q).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, [scoreId]);
  return rows;
}

export const runPct = (r: ScoreRun) => Math.round((r.ok / Math.max(1, r.total)) * 100);
export const runText = (r: ScoreRun) =>
  `${r.from}~${r.to}마디 · 맞은 음 ${runPct(r)}%${r.meanAbs !== null ? ` · ±${Math.round(r.meanAbs)}센트` : ''}${r.rhythmMs ? ` · 박자 ±${Math.round(r.rhythmMs)}ms` : ''}`;
