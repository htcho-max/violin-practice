import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Piece } from '../data/db';
import { BOOK4_PIECES } from '../data/pieces';

let seeded: Promise<void> | null = null;
/** 처음 한 번 4권 곡을 넣어 둡니다 */
export function seedPieces(): Promise<void> {
  if (!seeded) {
    seeded = db.transaction('rw', db.pieces, db.kv, async () => {
      const done = await db.kv.get('piecesSeeded');
      if (done) return;
      await db.pieces.bulkPut(BOOK4_PIECES);
      await db.kv.put({ key: 'piecesSeeded', value: true });
    }).catch(() => {});
  }
  return seeded;
}

export function usePieces(): Piece[] {
  const [rows, setRows] = useState<Piece[]>([]);
  useEffect(() => {
    seedPieces();
    const sub = liveQuery(() => db.pieces.toArray()).subscribe({
      next: (ps) => setRows(ps.sort((a, b) => b.book - a.book || (a.order ?? 0) - (b.order ?? 0))),
      error: () => {},
    });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}

export const updatePiece = (id: string, patch: Partial<Piece>) => db.pieces.update(id, patch);
