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
      if (done) {
        // 나중에 추가된 4권 곡만 채워 넣기 (지운 곡을 되살리지 않도록 버전별로 한 번)
        const v = await db.kv.get('piecesSeedV');
        if (!v || (v.value as number) < 2) {
          const have = new Set((await db.pieces.toArray()).map((p) => p.id));
          await db.pieces.bulkPut(BOOK4_PIECES.filter((p) => p.order === 7 && !have.has(p.id)));
          await db.kv.put({ key: 'piecesSeedV', value: 2 });
        }
        return;
      }
      await db.pieces.bulkPut(BOOK4_PIECES);
      await db.kv.put({ key: 'piecesSeeded', value: true });
      await db.kv.put({ key: 'piecesSeedV', value: 2 });
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
