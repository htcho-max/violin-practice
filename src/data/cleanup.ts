import { db, type Recording, type ScoreRun } from './db';

export const KEEP_LATEST = 3;

/** 녹음 자동 정리 계획: 악보 채점 녹음만, 악보마다 처음·가장 잘한·최근 3개는 남김. 따로 녹음한 것은 그대로 */
export interface CleanupPlan { remove: number[]; keep: number; bytes: number; scores: number }

type RecLite = Pick<Recording, 'id' | 'createdAt' | 'scoreId' | 'runId'> & { size: number };
type RunLite = Pick<ScoreRun, 'id' | 'ok' | 'total' | 'meanAbs' | 'recordingId'>;

export function planCleanup(recs: RecLite[], runs: RunLite[], keepLatest = KEEP_LATEST): CleanupPlan {
  const runOf = new Map<number, RunLite>();
  for (const r of runs) if (r.recordingId !== undefined) runOf.set(r.recordingId, r);
  const byScore = new Map<number, RecLite[]>();
  for (const r of recs) {
    if (r.scoreId === undefined || r.id === undefined) continue;
    byScore.set(r.scoreId, [...(byScore.get(r.scoreId) ?? []), r]);
  }
  const remove: number[] = []; let bytes = 0, keep = 0, scores = 0;
  for (const list of byScore.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    const keepIds = new Set<number>([list[0].id!, ...list.slice(-keepLatest).map((r) => r.id!)]);
    // 가장 잘한 것: 맞은 음 비율이 높고, 같으면 평균 센트가 작은 것
    let best: RecLite | null = null, bs = -1;
    for (const r of list) {
      const run = runOf.get(r.id!);
      if (!run || !run.total) continue;
      const s = run.ok / run.total - (run.meanAbs ?? 50) / 10000;
      if (s > bs) { bs = s; best = r; }
    }
    if (best) keepIds.add(best.id!);
    const rm = list.filter((r) => !keepIds.has(r.id!));
    if (rm.length) scores++;
    for (const r of rm) { remove.push(r.id!); bytes += r.size; }
    keep += list.length - rm.length;
  }
  return { remove, keep, bytes, scores };
}

/** 지금 기기의 녹음으로 계획 세우기 (녹음 내용은 크기만 봄) */
export async function makeCleanupPlan(): Promise<CleanupPlan> {
  const recs: RecLite[] = [];
  await db.recordings.each((r) => { recs.push({ id: r.id, createdAt: r.createdAt, scoreId: r.scoreId, runId: r.runId, size: r.blob?.size ?? 0 }); });
  const runs = await db.scoreRuns.toArray();
  return planCleanup(recs, runs.map((r) => ({ id: r.id, ok: r.ok, total: r.total, meanAbs: r.meanAbs, recordingId: r.recordingId })));
}

/** 녹음만 지움. 채점 기록(음마다 결과 포함)은 남기고 recordingId 만 뗌 */
export async function applyCleanup(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  await db.transaction('rw', db.recordings, db.scoreRuns, async () => {
    await db.recordings.bulkDelete(ids);
    await db.scoreRuns.filter((r) => r.recordingId !== undefined && set.has(r.recordingId)).modify((r) => { delete r.recordingId; r.recCleared = true; });
  });
}
