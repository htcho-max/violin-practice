import { describe, it, expect } from 'vitest';
import { TempoLadder } from '../src/audio/ladder';
import { pickReview, currentPieces, daysAgo, BOOK1_3_PIECES, BOOK4_PIECES } from '../src/data/pieces';
import { trackStats } from '../src/audio/recorder';
import type { Piece } from '../src/data/db';

describe('템포 트레이너', () => {
  it('성공 3번마다 +4, 목표에서 멈춤', () => {
    const l = new TempoLadder({ startBpm: 60, targetBpm: 70, step: 4, mode: 'success', bars: 4, successes: 3 });
    expect(l.success()).toBeNull();
    expect(l.success()).toBeNull();
    expect(l.success()).toBe(64);
    l.success(); l.fail(); l.success(); l.success();
    expect(l.bpm).toBe(64); // 실패로 초기화돼서 아직 2번
    l.success();
    expect(l.bpm).toBe(68);
    l.success(); l.success(); l.success();
    expect(l.bpm).toBe(70); // 목표를 넘지 않음
    expect(l.done).toBe(true);
    expect(l.success()).toBeNull();
    expect(l.steps.map((s) => s.bpm)).toEqual([60, 64, 68, 70]);
    expect(l.progress).toBe(1);
  });
  it('마디 모드: 4마디마다', () => {
    const l = new TempoLadder({ startBpm: 80, targetBpm: 100, step: 5, mode: 'bars', bars: 4, successes: 3 });
    const got = Array.from({ length: 8 }, () => l.onBar());
    expect(got).toEqual([null, null, null, 85, null, null, null, 90]);
    expect(l.success()).toBeNull(); // 다른 모드 입력은 무시
  });
  it('시작이 목표 이상이면 바로 완료', () => {
    expect(new TempoLadder({ startBpm: 90, targetBpm: 80, step: 4, mode: 'bars', bars: 4, successes: 3 }).done).toBe(true);
  });
});

describe('곡 진도·복습', () => {
  const ps: Piece[] = [
    { id: 'a', book: 1, title: 'A', key: '', status: 'review', lastPracticed: '2026-10-10' },
    { id: 'b', book: 2, title: 'B', key: '', status: 'review' },
    { id: 'c', book: 3, title: 'C', key: '', status: 'done', lastPracticed: '2026-10-01' },
    { id: 'd', book: 4, title: 'D', key: '', status: 'learning', lastPracticed: '2026-10-15' },
    { id: 'e', book: 4, title: 'E', key: '', status: 'tempo', lastPracticed: '2026-10-16' },
  ];
  it('복습: 안 친 곡 → 오래된 순', () => {
    expect(pickReview(ps, 2).map((p) => p.id)).toEqual(['b', 'c']);
    expect(pickReview(ps, 5).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
  it('연습 중 곡: 최근 순', () => {
    expect(currentPieces(ps).map((p) => p.id)).toEqual(['e', 'd']);
  });
  it('며칠 전', () => {
    expect(daysAgo('2026-10-01', '2026-10-16')).toBe(15);
    expect(daysAgo(undefined, '2026-10-16')).toBeNull();
  });
  it('기본 목록 id 중복 없음', () => {
    const ids = [...BOOK4_PIECES, ...BOOK1_3_PIECES].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOOK1_3_PIECES.every((p) => p.status === 'review')).toBe(true);
  });
});

describe('녹음 요약', () => {
  it('평균 오차와 ±10센트 비율', () => {
    const s = trackStats([[0, 5, 69], [0.05, -15, 69], [0.1, null, null], [0.15, 8, 71]]);
    expect(s.meanAbs).toBeCloseTo(28 / 3, 6);
    expect(s.within10).toBeCloseTo(2 / 3, 6);
    expect(s.voicedSec).toBeCloseTo(0.15, 6);
  });
  it('소리 없음', () => {
    expect(trackStats([[0, null, null]]).meanAbs).toBeNull();
  });
});
