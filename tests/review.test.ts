import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import type { ScoreNote } from '../src/score/parse';
import type { Scored } from '../src/score/align';
import type { ReviewItem } from '../src/data/db';
import { measureStats, reviewChanges, reviewMessage, measureRuns, dueGroups, REVIEW_DAYS } from '../src/data/review';
import { TOLERANCES } from '../src/score/tolerance';

const note = (measure: number, midi: number, index = 0): ScoreNote => ({ measure, index, midi, beat: index, dur: 1 } as ScoreNote);
const ok = (m: number, c: number, midi = 69): Scored => ({ note: note(m, midi), status: 'ok', cents: c, playedMidi: midi });
const bad = (m: number, s: 'wrong' | 'missed' = 'wrong'): Scored => ({ note: note(m, 69), status: s, cents: null, playedMidi: s === 'wrong' ? 70 : null });

describe('복습함', () => {
  it('마디별 통계: 멈춘 뒤의 마디는 뺌', () => {
    const st = measureStats([ok(1, 5), ok(1, -30), bad(2), ok(2, 3), bad(3, 'missed'), bad(4, 'missed')]);
    expect(st.map((s) => s.measure)).toEqual([1, 2]);
    expect(st[0].meanAbs).toBeCloseTo(17.5);
    expect(st[1]).toMatchObject({ total: 2, ok: 1 });
    expect(measureStats([bad(1, 'missed')])).toEqual([]);
  });
  it('틀린 마디는 넣고, 복습 날 깨끗하면 다음 칸, 마지막 칸이면 졸업', () => {
    const today = '2026-10-19';
    const c1 = reviewChanges(new Map(), measureStats([ok(1, 3), bad(2), ok(3, 40)]), 7, '곡', today);
    expect(c1.added).toEqual([2, 3]);
    expect(c1.put.every((p) => p.due === '2026-10-20' && p.box === 0 && p.id === `7:${p.measure}`)).toBe(true);
    expect(reviewMessage(c1)).toBe('2·3마디를 복습함에 넣었어요');
    const ex = new Map<string, ReviewItem>(c1.put.map((p) => [p.id, p]));
    // 같은 날 다시 깨끗하게 쳐도 그대로
    const same = reviewChanges(ex, measureStats([ok(2, 2), ok(3, 4)]), 7, '곡', today);
    expect(same.put).toEqual([]);
    expect(reviewMessage(same)).toBeNull();
    // 다음 날 깨끗하게 → box 1, 간격 2일 / 또 틀리면 처음부터
    const next = reviewChanges(ex, measureStats([ok(2, 2), ok(3, 30)]), 7, '곡', '2026-10-20');
    expect(next.advanced).toEqual([2]);
    expect(next.put.find((p) => p.measure === 2)).toMatchObject({ box: 1, due: '2026-10-22' });
    expect(next.again).toEqual([3]);
    expect(next.put.find((p) => p.measure === 3)).toMatchObject({ box: 0, due: '2026-10-21' });
    // 간격 1·2·4·7·14·30
    expect(REVIEW_DAYS).toEqual([1, 2, 4, 7, 14, 30]);
    // 마지막 칸에서 통과 → 졸업
    const last = new Map<string, ReviewItem>([['7:2', { ...c1.put[0], box: REVIEW_DAYS.length - 1, due: '2026-10-19' }]]);
    const g = reviewChanges(last, measureStats([ok(2, 1)]), 7, '곡', today);
    expect(g.graduated).toEqual([2]);
    expect(g.del).toEqual(['7:2']);
    expect(reviewMessage(g)).toBe('2마디 졸업!');
  });
  it('판정 기준을 따름 (관대면 ±30까지 괜찮음, 엄격이면 ±10 넘으면 틀림)', () => {
    const st = measureStats([ok(1, 25), ok(1, 25)]);
    expect(reviewChanges(new Map(), st, 1, 't', '2026-10-19', TOLERANCES.normal).added).toEqual([1]);
    expect(reviewChanges(new Map(), st, 1, 't', '2026-10-19', TOLERANCES.relaxed).added).toEqual([]);
    expect(reviewChanges(new Map(), measureStats([ok(1, 12)]), 1, 't', '2026-10-19', TOLERANCES.strict).added).toEqual([1]);
  });
  it('오늘 복습 묶음과 이어진 마디', () => {
    const it_ = (m: number, due: string, sid = 1): ReviewItem => ({ id: `${sid}:${m}`, scoreId: sid, measure: m, title: 't', box: 0, due, added: due });
    const g = dueGroups([it_(5, '2026-10-19'), it_(3, '2026-10-18'), it_(9, '2026-10-25'), it_(1, '2026-10-19', 2)], '2026-10-19');
    expect(g.map((x) => [x.scoreId, x.measures.map((m) => m.measure)])).toEqual([[1, [3, 5]], [2, [1]]]);
    expect(measureRuns([9, 3, 4, 5, 11, 10])).toEqual([[3, 5], [9, 11]]);
  });
});

describe('복습함 DB (v8)', () => {
  it('v7 에서 v8 로: 기존 표·데이터 그대로, reviews 표 추가', async () => {
    // 예전 앱 (v7) 으로 데이터 넣기
    const old = new Dexie('violin-practice');
    old.version(7).stores({
      sessions: '++id, date, startedAt', pieces: 'id, book, status', kv: 'key', ladders: '++id, date, pieceId', recordings: '++id, createdAt, pieceId',
      scores: '++id, createdAt, pieceId, exercise.stepId, listKey', scoreRuns: '++id, date, scoreId, createdAt', lessonNotes: '++id, date, scoreId, createdAt',
    });
    const sid = await old.table('scores').add({ title: '옛 악보', xml: '<x/>', createdAt: 1, listKey: [1, '옛 악보', '', '', 0] }) as number;
    await old.table('kv').put({ key: 'drill-ladders', value: { [`${sid}:2`]: { base: 72, idx: 1, done: false, at: 1, tries: 1 } } });
    old.close();

    const { db } = await import('../src/data/db');
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(8);
    expect((await db.scores.get(sid))?.title).toBe('옛 악보');
    expect((await db.kv.get('drill-ladders'))?.value).toBeTruthy();
    expect(await db.reviews.count()).toBe(0);

    // 채점 결과 넣기 → 악보 지우면 그 복습도 지움
    const c = reviewChanges(new Map(), measureStats([bad(2), ok(3, 2)]), sid, '옛 악보', '2026-10-19');
    await db.reviews.bulkPut(c.put);
    const other = await db.scores.add({ title: '다른 악보', xml: '<x/>', createdAt: 2 });
    await db.reviews.put({ id: `${other}:1`, scoreId: other, measure: 1, title: '다른 악보', box: 0, due: '2026-10-20', added: '2026-10-19' });
    expect(await db.reviews.where('due').belowOrEqual('2026-10-20').count()).toBe(2);

    // 백업에 들어가고, 되돌리면 그대로
    const { makeBackup, restoreBackup } = await import('../src/data/backup');
    const text = await (await makeBackup(false)).text();
    expect(JSON.parse(text).tables.reviews.map((r: ReviewItem) => r.id).sort()).toEqual([`${other}:1`, `${sid}:2`].sort());

    const { deleteScoreWithReviews } = await import('../src/state/useReviews');
    await deleteScoreWithReviews(sid);
    expect(await db.scores.get(sid)).toBeUndefined();
    expect((await db.reviews.toArray()).map((r) => r.id)).toEqual([`${other}:1`]);

    const res = await restoreBackup(text);
    expect(res.counts.reviews).toBe(2);
    expect(await db.reviews.count()).toBe(2);

    // 복습함이 없던 예전 백업: 악보를 되돌리면 복습함은 비움
    const legacy = JSON.parse(text);
    delete legacy.tables.reviews;
    await restoreBackup(JSON.stringify(legacy));
    expect(await db.reviews.count()).toBe(0);
    expect(await db.scores.count()).toBe(2);
  });
});
