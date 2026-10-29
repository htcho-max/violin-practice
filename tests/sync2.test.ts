/** 동기화: 되돌리기·껐다 켜기·여러 항목 kv 합치기·시계 차이·세브치크 변형 겹침 */
import { describe, expect, it, vi } from 'vitest';
import { hasSqlite } from './helpers/fakeD1';
import { device, on, server, xml, URL_, KEY } from './helpers/syncDevices';

const tick = () => new Promise((r) => setTimeout(r, 5));
const session = (sec: number) => ({ date: '2026-10-05', startedAt: sec, totalSec: sec, items: [] });

const sqliteOk = await hasSqlite();

describe.skipIf(!sqliteOk)('동기화 (어려운 경우)', () => {
  it('동기화 중 백업 되돌리기: 다른 기기 기록은 지우지 않고, 되돌린 것은 퍼짐', async () => {
    await server();
    const A = await device();
    await on(A, async () => { await A.db.pieces.put({ id: 'p1', book: 4, title: '곡', key: 'D', status: 'learning' }); });
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const backup = await on(A, async () => (await A.bk.makeBackup(false)).text());
    const B = await device();
    await on(B, () => B.eng.enableSync(URL_, KEY));
    await on(B, () => B.db.sessions.add(session(700)));
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect(await on(A, () => A.db.sessions.count())).toBe(1);
    // A 에서 곡 상태 바꾼 뒤 옛 백업으로 되돌림
    await on(A, () => A.db.pieces.update('p1', { status: 'done' }));
    await on(A, () => A.eng.syncNow());
    await on(A, () => A.bk.restoreBackup(backup));
    await tick();
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    // B 의 연습 기록은 그대로 (A 에도 다시 들어옴), 곡 상태는 되돌린 값으로
    expect(await on(B, () => B.db.sessions.count())).toBe(1);
    expect(await on(A, () => A.db.sessions.count())).toBe(1);
    expect((await on(B, () => B.db.pieces.get('p1')))!.status).toBe('learning');
    expect((await on(A, () => A.db.pieces.get('p1')))!.status).toBe('learning');
  });

  it('동기화 전에 만든 백업을 되돌려도 서버에 겹쳐 생기지 않음 (같은 새 id)', async () => {
    const env = await server();
    const A = await device();
    const sid = await on(A, () => A.db.scores.add({ title: '곡', xml: xml('곡'), createdAt: 1 }));
    await on(A, () => A.db.scoreRuns.add({ createdAt: 2, date: '2026-10-01', scoreId: sid, title: '곡', from: 1, to: 2, durationSec: 5, total: 4, ok: 4, wrong: 0, missed: 0, meanAbs: 1, inSession: false, recordingId: 77 }));
    const old = await on(A, async () => (await A.bk.makeBackup(false)).text());
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const gid = (await on(A, () => A.db.scores.toArray()))[0].id!;
    await on(A, () => A.bk.restoreBackup(old));
    await on(A, () => A.eng.syncNow());
    expect((await on(A, () => A.db.scores.toArray())).map((x) => x.id)).toEqual([gid]);
    const runs = await on(A, () => A.db.scoreRuns.toArray());
    expect(runs.map((r) => [r.scoreId, r.recordingId])).toEqual([[gid, undefined]]); // 없는 녹음은 떼어 냄
    const n = await env.DB.prepare("SELECT COUNT(*) AS c FROM rec WHERE t = 'scores'").first<{ c: number }>();
    expect(n!.c).toBe(1);
  });

  it('껐다 다시 켜도 끈 동안 고친 것·지운 것이 살아 있음', async () => {
    await server();
    const A = await device();
    await on(A, async () => { await A.db.pieces.put({ id: 'p1', book: 4, title: '곡', key: 'D', status: 'learning' }); });
    const sid = await on(A, () => A.db.sessions.add(session(100)));
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const gid = (await on(A, () => A.db.sessions.toArray()))[0].id!;
    expect(gid).not.toBe(sid);
    on(A, async () => A.eng.disableSync());
    await on(A, () => A.db.pieces.update('p1', { status: 'done', memo: '끝' }));
    await on(A, () => A.db.sessions.delete(gid));
    await tick();
    await on(A, () => A.eng.enableSync(URL_, KEY));
    expect((await on(A, () => A.db.pieces.get('p1')))).toMatchObject({ status: 'done', memo: '끝' });
    const B = await device();
    await on(B, () => B.eng.enableSync(URL_, KEY));
    expect((await on(B, () => B.db.pieces.get('p1')))).toMatchObject({ status: 'done', memo: '끝' });
    expect(await on(B, () => B.db.sessions.count())).toBe(0);
  });

  it('한 줄에 여러 항목(kv): 항목별로 합침 — 처음 켤 때도', async () => {
    await server();
    const A = await device();
    await on(A, async () => {
      await A.db.kv.put({ key: 'drill-ladders', value: { '1:3': { base: 80, idx: 1, done: false, at: 100, tries: 1 } } });
      await A.db.kv.put({ key: 'score-folders', value: [{ id: 'suzuki-4', name: '스즈키 4권' }] });
      await A.db.kv.put({ key: 'exercise-progress', value: { s1: { best: 80, at: 10 } } });
    });
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const B = await device();
    await on(B, async () => {
      await B.db.kv.put({ key: 'score-folders', value: [{ id: 'suzuki-4', name: '스즈키 4권' }, { id: 'f-mine', name: '찬양' }] });
      await B.db.kv.put({ key: 'exercise-progress', value: { s1: { best: 95, at: 20 }, s2: { best: 50, at: 5 } } });
    });
    await on(B, () => B.eng.enableSync(URL_, KEY));
    await on(A, () => A.eng.syncNow());
    for (const D of [A, B]) {
      const f = (await on(D, () => D.db.kv.get('score-folders')))!.value as { id: string }[];
      expect(f.map((x) => x.id)).toEqual(['suzuki-4', 'f-mine']);
      const ep = (await on(D, () => D.db.kv.get('exercise-progress')))!.value as Record<string, { best: number }>;
      expect([ep.s1.best, ep.s2.best]).toEqual([95, 50]);
    }
    // 두 기기에서 서로 다른 마디 사다리를 동기화 전에 저장
    const gk = Object.keys((await on(A, () => A.db.kv.get('drill-ladders')))!.value as object)[0];
    await on(A, async () => { const v = (await A.db.kv.get('drill-ladders'))!.value as Record<string, unknown>; await A.db.kv.put({ key: 'drill-ladders', value: { ...v, 'x:1': { at: 300 } } }); });
    await on(B, async () => { const v = ((await B.db.kv.get('drill-ladders'))?.value ?? {}) as Record<string, unknown>; await B.db.kv.put({ key: 'drill-ladders', value: { ...v, 'y:2': { at: 400 } } }); });
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    for (const D of [A, B]) expect(Object.keys((await on(D, () => D.db.kv.get('drill-ladders')))!.value as object).sort()).toEqual([gk, 'x:1', 'y:2'].sort());
  });

  it('한 기기 시계가 빨라도 다른 기기에서 나중에 고친 것이 이김', async () => {
    await server();
    const A = await device();
    await on(A, async () => { await A.db.pieces.put({ id: 'p1', book: 4, title: '곡', key: 'D', status: 'learning' }); });
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const B = await device();
    await on(B, () => B.eng.enableSync(URL_, KEY));
    const real = Date.now;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + 10 * 60_000); // A 시계 10분 빠름
    await on(A, () => A.db.pieces.update('p1', { status: 'tempo' }));
    await on(A, () => A.eng.syncNow());
    spy.mockRestore();
    await on(B, () => B.eng.syncNow());
    await on(B, () => B.db.pieces.update('p1', { status: 'done' }));
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect((await on(A, () => A.db.pieces.get('p1')))!.status).toBe('done');
  });

  it('같은 세브치크 변형을 두 기기에서 따로 열어도 기록이 한 악보로 모임', async () => {
    await server();
    const pack = { kind: 'violin-sevcik-pack', version: 2, id: 'sev-c', title: '팩', theme: xml('주제'), variants: [{ n: 1, label: '', k: 1, xml: xml('v1') }] };
    const A = await device();
    await on(A, () => A.sev.importPack(new Blob([JSON.stringify(pack)])));
    await on(A, () => A.eng.enableSync(URL_, KEY));
    const B = await device();
    await on(B, () => B.eng.enableSync(URL_, KEY));
    // 동기화 전에 둘 다 변형 1 을 열고 연습
    const va = await on(A, () => A.sev.variantScore('sev-c', 1));
    const vb = await on(B, () => B.sev.variantScore('sev-c', 1));
    expect(va).not.toBe(vb);
    const run = (scoreId: number, ok: number) => ({ createdAt: ok, date: '2026-10-05', scoreId, title: 't', from: 1, to: 2, durationSec: 5, total: 10, ok, wrong: 0, missed: 0, meanAbs: 1, inSession: false });
    await on(A, () => A.db.scoreRuns.add(run(va, 7)));
    await on(B, () => B.db.scoreRuns.add(run(vb, 9)));
    await on(B, () => B.db.scores.update(vb, { marks: { '1:0': { bow: 'up' } } as never }));
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    await tick();
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    const win = (await on(A, () => A.sev.scoreMap('sev-c')))[1];
    const lose = win === va ? vb : va;
    expect([va, vb]).toContain(win);
    for (const D of [A, B]) {
      expect(await on(D, () => D.sev.scoreMap('sev-c'))).toEqual({ 1: win });
      const runs = await on(D, () => D.db.scoreRuns.toArray());
      expect(runs.map((r) => [r.scoreId, r.ok]).sort()).toEqual([[win, 7], [win, 9]]);
      expect(await on(D, () => D.db.scores.get(lose))).toBeUndefined();
      expect((await on(D, () => D.db.scores.get(win)))!.marks).toEqual({ '1:0': { bow: 'up' } });
    }
  });
});
