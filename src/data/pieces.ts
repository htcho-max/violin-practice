import type { Piece, PieceStatus } from './db';

export const STATUS_LABEL: Record<PieceStatus, string> = {
  learning: '익히는 중',
  tempo: '템포 올리는 중',
  done: '완성',
  review: '복습',
};
export const STATUS_ORDER: PieceStatus[] = ['learning', 'tempo', 'done', 'review'];

const mk = (book: number, i: number, title: string, key = ''): Piece => ({
  id: `b${book}-${String(i).padStart(2, '0')}`, book, title, key, status: book < 4 ? 'review' : 'learning', order: i,
});

/** 스즈키 4권 (지금 연습 중) */
export const BOOK4_PIECES: Piece[] = [
  { ...mk(4, 1, '자이츠 협주곡 2번 3악장', 'G'), id: 'b4-seitz2-3' },
  { ...mk(4, 2, '자이츠 협주곡 5번 1악장', 'D'), id: 'b4-seitz5-1' },
  { ...mk(4, 3, '자이츠 협주곡 5번 3악장', 'D'), id: 'b4-seitz5-3' },
  { ...mk(4, 4, '비발디 협주곡 A단조 1악장', 'Am'), id: 'b4-vivaldi-1' },
  { ...mk(4, 5, '비발디 협주곡 A단조 3악장', 'Am'), id: 'b4-vivaldi-3' },
  { ...mk(4, 6, '바흐 두 대의 바이올린을 위한 협주곡 1악장', 'Dm'), id: 'b4-bach-double-1' },
  { ...mk(4, 7, '무궁동 (뵘)', 'D'), id: 'b4-bohm-perpetual' },
];

/** 스즈키 1~3권 복습 곡 (판본마다 조금 다를 수 있어요 — 앱에서 고치거나 지울 수 있음) */
const B1 = ['반짝반짝 작은 별 변주곡', 'Lightly Row', 'Song of the Wind', 'Go Tell Aunt Rhody', 'O Come, Little Children', 'May Song', 'Long, Long Ago', 'Allegro', 'Perpetual Motion', 'Allegretto', 'Andantino', 'Etude', '미뉴에트 1 (바흐)', '미뉴에트 2 (바흐)', '미뉴에트 3 (바흐)', 'The Happy Farmer (슈만)', '가보트 (고섹)'];
const B2 = ['Chorus from "Judas Maccabaeus" (헨델)', '뮈제트 (바흐)', '사냥꾼의 합창 (베버)', 'Long, Long Ago 변주', '왈츠 (브람스)', '부레 (헨델)', '두 사람의 척탄병 (슈만)', '마녀의 춤 주제 (파가니니)', '미뇽 가보트 (토마)', '가보트 (륄리)', '미뉴에트 G장조 (베토벤)', '미뉴에트 (보케리니)'];
const B3 = ['가보트 (마르티니)', '미뉴에트 (바흐)', '가보트 G단조 (바흐)', '유모레스크 (드보르자크)', '가보트 (베커)', '가보트 D장조 (바흐)', '부레 (바흐)'];
export const BOOK1_3_PIECES: Piece[] = [
  ...B1.map((t, i) => mk(1, i + 1, t)),
  ...B2.map((t, i) => mk(2, i + 1, t)),
  ...B3.map((t, i) => mk(3, i + 1, t)),
];

/** 오늘의 복습 곡: 완성/복습 곡 중 가장 오래 안 친 곡부터 n개 */
export function pickReview(pieces: Piece[], n = 2): Piece[] {
  return pieces
    .filter((p) => p.status === 'done' || p.status === 'review')
    .sort((a, b) => (a.lastPracticed ?? '').localeCompare(b.lastPracticed ?? '') || a.book - b.book || (a.order ?? 0) - (b.order ?? 0))
    .slice(0, n);
}

/** 지금 연습 중인 곡: 익히는 중/템포 올리는 중, 최근 연습한 곡 먼저 */
export function currentPieces(pieces: Piece[]): Piece[] {
  return pieces
    .filter((p) => p.status === 'learning' || p.status === 'tempo')
    .sort((a, b) => (b.lastPracticed ?? '').localeCompare(a.lastPracticed ?? '') || b.book - a.book || (a.order ?? 0) - (b.order ?? 0));
}

export function daysAgo(date: string | undefined, today: string): number | null {
  if (!date) return null;
  const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((d(today) - d(date)) / 864e5);
}
