import Dexie, { type Table } from 'dexie';

export interface SessionItem { key: string; label: string; sec: number; pieceId?: string }
export interface Session {
  id?: number;
  date: string; // YYYY-MM-DD (현지 날짜)
  startedAt: number;
  totalSec: number;
  items: SessionItem[];
  memo?: string;
}
export type PieceStatus = 'learning' | 'tempo' | 'done' | 'review';
export interface Piece {
  id: string;
  book: number;
  title: string;
  key: string;
  status: PieceStatus;
  targetBpm?: number;
  currentBpm?: number;
  lastPracticed?: string;
  memo?: string;
  order?: number;
}

/** 템포 트레이너 한 번의 기록 */
export interface Ladder {
  id?: number;
  date: string;
  startedAt: number;
  pieceId?: string;
  startBpm: number;
  targetBpm: number;
  reachedBpm: number;
  steps: { bpm: number; at: number }[];
}

/** 녹음 + 음정 곡선 */
export interface Recording {
  id?: number;
  createdAt: number;
  date: string;
  pieceId?: string;
  title: string;
  durationSec: number;
  mime: string;
  blob: Blob;
  /** [초, 센트(평균율 기준), midi] 를 0.05초 간격으로 */
  track: [number, number | null, number | null][];
}
export interface KV { key: string; value: unknown }

/** 사용자가 직접 불러온 악보 (이 기기에만 저장, 앱·저장소에는 포함하지 않음) */
export interface ScoreFile {
  id?: number;
  title: string;
  xml: string;
  pieceId?: string;
  createdAt: number;
  lastFrom?: number;
  lastTo?: number;
}

class PracticeDB extends Dexie {
  sessions!: Table<Session, number>;
  pieces!: Table<Piece, string>;
  kv!: Table<KV, string>;
  ladders!: Table<Ladder, number>;
  recordings!: Table<Recording, number>;
  scores!: Table<ScoreFile, number>;
  constructor() {
    super('violin-practice');
    this.version(1).stores({
      sessions: '++id, date, startedAt',
      pieces: 'id, book, status',
      kv: 'key',
    });
    this.version(2).stores({
      ladders: '++id, date, pieceId',
      recordings: '++id, createdAt, pieceId',
    });
    this.version(3).stores({ scores: '++id, createdAt, pieceId' });
  }
}

export const db = new PracticeDB();
