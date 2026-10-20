import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { planCleanup, applyCleanup, makeCleanupPlan } from '../src/data/cleanup';

const rec = (id: number, scoreId: number | undefined, t: number) => ({ id, scoreId, createdAt: t, size: 1000 });
const run = (recordingId: number, ok: number, meanAbs = 10) => ({ id: recordingId + 100, ok, total: 10, meanAbs, recordingId });

describe('녹음 자동 정리', () => {
  it('악보마다 처음·가장 잘한·최근 3개를 남기고, 자유 녹음은 건드리지 않음', () => {
    const recs = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => rec(i, 1, i)).concat([rec(20, undefined, 1), rec(21, undefined, 2)]);
    const runs = [run(1, 3), run(2, 5), run(3, 9), run(4, 6), run(5, 6), run(6, 7), run(7, 7), run(8, 8)];
    const p = planCleanup(recs, runs);
    expect(p.remove.sort((a, b) => a - b)).toEqual([2, 4, 5]); // 1 처음, 3 최고, 6~8 최근
    expect(p.keep).toBe(5);
    expect(p.bytes).toBe(3000);
    expect(p.scores).toBe(1);
  });
  it('같은 비율이면 평균 센트가 작은 쪽이 가장 잘한 것', () => {
    const recs = [1, 2, 3, 4, 5, 6].map((i) => rec(i, 1, i));
    const p = planCleanup(recs, [run(2, 9, 20), run(3, 9, 5), run(4, 1), run(5, 1), run(6, 1)]);
    expect(p.remove.sort()).toEqual([2]);
  });
  it('녹음이 적으면 지울 것이 없음', () => {
    expect(planCleanup([rec(1, 1, 1), rec(2, 1, 2), rec(3, 1, 3), rec(4, 1, 4)], []).remove).toEqual([]);
  });
});

import { db } from '../src/data/db';
describe('녹음 자동 정리 (DB)', () => {
  it('녹음만 지우고 채점 기록은 남김', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const rid = await db.recordings.add({ createdAt: i, date: '2026-10-20', title: 't', durationSec: 1, mime: 'audio/webm', blob: new Blob(['x'.repeat(100)]), track: [], scoreId: 7 });
      const runId = await db.scoreRuns.add({ createdAt: i, date: '2026-10-20', scoreId: 7, title: 't', from: 1, to: 2, durationSec: 1, total: 10, ok: i === 2 ? 10 : 5, wrong: 0, missed: 0, meanAbs: 10, inSession: false, recordingId: rid } as never);
      ids.push(runId as number);
    }
    const plan = await makeCleanupPlan();
    expect(plan.remove.length).toBe(1);
    await applyCleanup(plan.remove);
    expect(await db.recordings.count()).toBe(5);
    expect(await db.scoreRuns.count()).toBe(6);
    const cleared = (await db.scoreRuns.toArray()).filter((r) => r.recCleared);
    expect(cleared.length).toBe(1);
    expect(cleared[0].recordingId).toBeUndefined();
  });
});
