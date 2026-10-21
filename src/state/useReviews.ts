import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type ReviewItem } from '../data/db';

/** 복습함 (scoreId 를 주면 그 악보만) */
export function useReviews(scoreId?: number): ReviewItem[] {
  const [rows, setRows] = useState<ReviewItem[]>([]);
  useEffect(() => {
    const q = () => (scoreId === undefined ? db.reviews.toArray() : db.reviews.where('scoreId').equals(scoreId).toArray());
    const sub = liveQuery(q).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, [scoreId]);
  return rows;
}

/** 악보를 지울 때 그 악보의 복습 마디도 같이 */
export async function deleteScoreWithReviews(scoreId: number) {
  await db.transaction('rw', db.scores, db.reviews, async () => {
    await db.scores.delete(scoreId);
    await db.reviews.where('scoreId').equals(scoreId).delete();
  });
}
