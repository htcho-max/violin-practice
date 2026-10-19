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
  /** 악보 채점과 함께 녹음한 경우 */
  scoreId?: number;
  runId?: number;
}

/** 악보 연습(채점) 한 번의 기록 */
export interface ScoreRun {
  id?: number;
  createdAt: number;
  date: string;
  scoreId: number;
  title: string;
  pieceId?: string;
  /** 연습곡이면 단계 id */
  exerciseId?: string;
  from: number;
  to: number;
  durationSec: number;
  total: number;
  ok: number;
  wrong: number;
  missed: number;
  meanAbs: number | null;
  /** 박자 오차(ms)와 내 템포 */
  rhythmMs?: number | null;
  bpm?: number | null;
  /** 진행 중인 연습 세션 안에서 했는지 (그러면 시간은 세션에 이미 들어 있음) */
  inSession: boolean;
  recordingId?: number;
  /** 가장 벗어난 마디 몇 개 */
  weakMeasures?: number[];
  /** 음마다 결과 (약한 마디·음정 습관·셈여림 비교에 씀) */
  notes?: import('../score/practice').RunNote[];
}

/** 레슨 노트: 선생님이 짚어 준 것 (곡·마디에 붙일 수 있음) */
export interface LessonNote {
  id?: number;
  createdAt: number;
  /** 레슨 날짜 YYYY-MM-DD */
  date: string;
  scoreId?: number;
  /** 보여줄 곡 이름 (악보 제목) */
  scoreTitle?: string;
  pieceId?: string;
  measure?: number;
  text: string;
  done: boolean;
  doneAt?: number;
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
  /** 여러 파트 악보에서 내 파트 (0부터) */
  part?: number;
  /** 다른 파트도 악보에 보이기 */
  showOthers?: boolean;
  /** 따로 붙인 반주 악보 (MusicXML) */
  accXml?: string;
  accName?: string;
  /** 폴더 id (없으면 분류 안 됨) */
  folder?: string;
  /** 앱이 만든 연습곡 (음계·포지션·에튀드) */
  exercise?: ExerciseMeta;
  /** 내가 악보에 붙인 표시 ("마디:순서" → 활·셈여림·꺾쇠·메모) */
  marks?: import('../score/dynamics').UserMarks;
  /** 앱에서 음을 고치기 전 처음 악보 (처음 고칠 때 한 번 저장) */
  origXml?: string;
  /** 목록용 가벼운 열쇠 (자동으로 채움): 악보 XML 을 읽지 않고 목록을 그리려고 인덱스에 넣음 */
  listKey?: ScoreListKey;
}
/** [만든 시각, 제목, 폴더, 곡 id, 연습곡이면 1] */
export type ScoreListKey = [number, string, string, string, number];
/** 목록에 쓰는 악보 정보 (XML 없이) */
export interface ScoreMeta { id: number; createdAt: number; title: string; folder?: string; pieceId?: string; exercise: boolean }
export const scoreListKey = (s: Partial<ScoreFile>): ScoreListKey => [s.createdAt ?? 0, s.title ?? '', s.folder ?? '', s.pieceId ?? '', s.exercise ? 1 : 0];
export const metaFromKey = (id: number, k: ScoreListKey): ScoreMeta => ({ id, createdAt: k[0], title: k[1], folder: k[2] || undefined, pieceId: k[3] || undefined, exercise: k[4] === 1 });
export interface ExerciseMeta { stepId: string; spec: import('../exercise/curriculum').ExerciseSpec; seed: number; shiftKeys: string[]; tip?: string; tempo: number; progressId?: string }
export interface ExerciseProgress { best: number; mean: number | null; passed: boolean; at: number; bpm?: number; tries: number }

class PracticeDB extends Dexie {
  sessions!: Table<Session, number>;
  pieces!: Table<Piece, string>;
  kv!: Table<KV, string>;
  ladders!: Table<Ladder, number>;
  recordings!: Table<Recording, number>;
  scores!: Table<ScoreFile, number>;
  scoreRuns!: Table<ScoreRun, number>;
  lessonNotes!: Table<LessonNote, number>;
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
    this.version(4).stores({ scoreRuns: '++id, date, scoreId, createdAt' });
    // 연습곡 단계로 바로 찾기 (악보 XML 을 모두 읽지 않게)
    this.version(5).stores({ scores: '++id, createdAt, pieceId, exercise.stepId' });
    this.version(6).stores({ lessonNotes: '++id, date, scoreId, createdAt' });
    // 목록을 XML 없이 읽기: listKey 인덱스의 열쇠만 읽음
    this.version(7).stores({ scores: '++id, createdAt, pieceId, exercise.stepId, listKey' }).upgrade((tx) =>
      tx.table('scores').toCollection().modify((s: ScoreFile) => { s.listKey = scoreListKey(s); }));
    // 악보를 넣거나 고칠 때 listKey 를 늘 맞춰 둠 (가져오기·백업 되돌리기·폴더 옮기기 모두)
    this.scores.hook('creating', (_pk, obj) => { obj.listKey = scoreListKey(obj); });
    this.scores.hook('updating', (mods, _pk, obj) => {
      const m = mods as Record<string, unknown>;
      if (!['createdAt', 'title', 'folder', 'pieceId', 'exercise'].some((k) => k in m) && !Object.keys(m).some((k) => k.startsWith('exercise.'))) return;
      const next: Partial<ScoreFile> = { ...obj };
      for (const [k, v] of Object.entries(m)) if (!k.includes('.')) (next as Record<string, unknown>)[k] = v;
      if ('exercise' in m && m.exercise === undefined) delete next.exercise;
      return { listKey: scoreListKey(next) };
    });
  }
}

export const db = new PracticeDB();

/** 악보 목록: XML 은 읽지 않고 listKey 인덱스 열쇠만 읽음 (악보가 많아도 빠르게) */
export async function loadScoreList(): Promise<ScoreMeta[]> {
  const c = () => db.scores.orderBy('listKey').reverse();
  const [keys, ids] = await Promise.all([c().keys(), c().primaryKeys()]);
  return keys.map((k, i) => metaFromKey(ids[i] as number, k as unknown as ScoreListKey));
}
