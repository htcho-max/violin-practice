import type { Piece } from './db';

/** 스즈키 4권 기본 목록. 판본에 따라 다르면 앱에서 고칠 수 있게 할 예정 */
export const BOOK4_PIECES: Piece[] = [
  { id: 'b4-seitz2-3', book: 4, title: '자이츠 협주곡 2번 3악장', key: 'G', status: 'learning' },
  { id: 'b4-seitz5-1', book: 4, title: '자이츠 협주곡 5번 1악장', key: 'D', status: 'learning' },
  { id: 'b4-seitz5-3', book: 4, title: '자이츠 협주곡 5번 3악장', key: 'D', status: 'learning' },
  { id: 'b4-vivaldi-1', book: 4, title: '비발디 협주곡 A단조 1악장', key: 'Am', status: 'learning' },
  { id: 'b4-vivaldi-3', book: 4, title: '비발디 협주곡 A단조 3악장', key: 'Am', status: 'learning' },
  { id: 'b4-bach-double-1', book: 4, title: '바흐 두 대의 바이올린을 위한 협주곡 1악장', key: 'Dm', status: 'learning' },
];
