/**
 * 기기 간 동기화: 두 "기기"(따로 된 IndexedDB·localStorage·모듈)가 같은 가짜 서버(진짜 Worker 코드 + sqlite)와 주고받기
 */
import { describe, expect, it } from 'vitest';
import { hasSqlite } from './helpers/fakeD1';
import { device, on, server, maxSeq, xml, URL_, KEY } from './helpers/syncDevices';

const sqliteOk = await hasSqlite();

describe.skipIf(!sqliteOk)('기기 간 동기화', () => {
  it('두 기기: 처음 켜기(id 정리·합치기) → 고치기·지우기 → 메아리 없음', async () => {
    const env = await server();
    // ---- 기기 A (탭): 옛 작은 id 로 기록이 있음 ----
    const A = await device();
    const a = await on(A, async () => {
      const sid = await A.db.scores.add({ title: '자이츠', xml: xml('자이츠'), createdAt: 1000, accXml: xml('반주') });
      const rid = await A.db.scoreRuns.add({ createdAt: 2000, date: '2026-10-01', scoreId: sid, title: '자이츠', from: 1, to: 9, durationSec: 60, total: 10, ok: 9, wrong: 1, missed: 0, meanAbs: 5, inSession: false });
      await A.db.reviews.put({ id: `${sid}:3`, scoreId: sid, measure: 3, title: '자이츠', box: 1, due: '2026-10-02', added: '2026-10-01' });
      await A.db.kv.put({ key: 'drill-ladders', value: { [`${sid}:5`]: { bpm: 60 } } });
      await A.db.kv.put({ key: 'settings', value: { a4: 442, latencyMs: 120, minDb: -45 } });
      await A.db.pieces.put({ id: 'p1', book: 4, title: '자이츠', key: 'D', status: 'tempo' });
      await A.db.lessonNotes.add({ createdAt: 3000, date: '2026-10-01', scoreId: sid, text: '활 더 길게', done: false });
      return { sid, rid };
    });
    expect(a.sid).toBe(1);
    await on(A, () => A.eng.enableSync(URL_, KEY));
    expect(A.eng.getStatus().state).toBe('idle');
    const aScores = await on(A, () => A.db.scores.toArray());
    const gid = aScores[0].id!;
    expect(gid).toBeGreaterThan(1e12);
    // 가리키는 곳도 새 id
    expect((await on(A, () => A.db.scoreRuns.toArray()))[0].scoreId).toBe(gid);
    expect((await on(A, () => A.db.reviews.toArray()))[0]).toMatchObject({ id: `${gid}:3`, scoreId: gid });
    expect(Object.keys((await on(A, () => A.db.kv.get('drill-ladders')))!.value as object)).toEqual([`${gid}:5`]);
    expect((await on(A, () => A.db.lessonNotes.toArray()))[0].scoreId).toBe(gid);
    // 악보 XML 은 blob 으로 (기록에는 해시만)
    const recRow = await env.DB.prepare("SELECT v FROM rec WHERE t='scores'").first<{ v: string }>();
    expect(recRow!.v).not.toContain('<measure');
    expect(JSON.parse(recRow!.v).xmlH).toMatch(/^[0-9a-f]{64}$/);

    // ---- 기기 B (휴대폰): 기본 곡 목록 + 자기 연습 기록 + 자기 지연 보정 ----
    const B = await device();
    await on(B, async () => {
      await B.db.pieces.put({ id: 'p1', book: 4, title: '자이츠', key: 'D', status: 'learning' });
      await B.db.sessions.add({ date: '2026-10-03', startedAt: 5000, totalSec: 600, items: [] });
      await B.db.kv.put({ key: 'settings', value: { a4: 440, latencyMs: 40, minDb: -55 } });
    });
    expect(await on(B, () => B.db.scores.count())).toBe(0); // 정말 따로 된 기기
    await on(B, () => B.eng.enableSync(URL_, KEY));
    expect(B.eng.getStatus().error).toBeUndefined();
    const bs = await on(B, () => B.db.scores.toArray());
    expect(bs.map((s) => [s.id, s.title, s.xml, s.accXml])).toEqual([[gid, '자이츠', xml('자이츠'), xml('반주')]]);
    expect(bs[0].listKey).toEqual([1000, '자이츠', '', '', 0]);
    expect((await on(B, () => B.db.pieces.get('p1')))!.status).toBe('tempo'); // 먼저 켠 기기(A)가 이김
    const st = (await on(B, () => B.db.kv.get('settings')))!.value as Record<string, number>;
    expect(st).toMatchObject({ a4: 442, latencyMs: 40, minDb: -55 }); // 기기 값은 지킴
    expect(await on(B, () => B.db.scoreRuns.count())).toBe(1);
    expect(await on(B, () => B.db.reviews.count())).toBe(1);

    // A 가 받으면 B 의 연습 기록이 옴
    await on(A, () => A.eng.syncNow());
    const aSessions = await on(A, () => A.db.sessions.toArray());
    expect(aSessions.map((s) => s.totalSec)).toEqual([600]);
    expect(aSessions[0].id!).toBeGreaterThan(1e12);

    // ---- 고치기: A 에서 내 표시, B 에서 레슨 노트 지우기 ----
    await on(A, () => A.db.scores.update(gid, { marks: { '3:0': { bow: 'down' } } as never }));
    await on(A, () => A.eng.syncNow());
    const nid = (await on(B, () => B.db.lessonNotes.toArray()))[0].id!;
    await on(B, () => B.db.lessonNotes.delete(nid));
    await new Promise((r) => setTimeout(r, 5)); // 묘비는 트랜잭션이 끝난 뒤 저장
    await on(B, () => B.eng.syncNow());
    expect((await on(B, () => B.db.scores.get(gid)))!.marks).toEqual({ '3:0': { bow: 'down' } });
    await on(A, () => A.eng.syncNow());
    expect(await on(A, () => A.db.lessonNotes.count())).toBe(0);

    // ---- 메아리: 더 바뀐 것이 없으면 서버 순번이 그대로 ----
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    const s1 = await maxSeq(env);
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect(await maxSeq(env)).toBe(s1);
    expect(A.eng.getStatus().pushed).toBe(0);
    expect(B.eng.getStatus().pulled).toBe(0);

    // ---- 같은 줄을 두 기기에서: 나중에 바꾼 쪽이 이김 ----
    await on(A, () => A.db.pieces.update('p1', { status: 'done' }));
    await new Promise((r) => setTimeout(r, 3));
    await on(B, () => B.db.pieces.update('p1', { status: 'review' }));
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect((await on(A, () => A.db.pieces.get('p1')))!.status).toBe('review');
    expect((await on(B, () => B.db.pieces.get('p1')))!.status).toBe('review');

    // ---- 동기화 켠 뒤 새로 만든 줄도 큰 id ----
    const nsid = await on(B, () => B.db.scores.add({ title: '비발디', xml: xml('비발디'), createdAt: 9000 }));
    expect(nsid).toBeGreaterThan(1e12);
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect((await on(A, () => A.db.scores.get(nsid)))!.xml).toBe(xml('비발디'));
  });

  it('세브치크 팩: 한 기기에서 불러오면 다른 기기에도, 지우면 같이', async () => {
    await server();
    const pack = { kind: 'violin-sevcik-pack', version: 2, id: 'sev-t', title: '테스트 팩', order: 4, theme: xml('주제'), variants: [{ n: 1, label: '온활', k: 1, bpm: 80, xml: xml('v1') }, { n: 2, label: '온활', k: 1, xml: xml('v2') }] };
    const A = await device();
    await on(A, () => A.eng.enableSync(URL_, KEY));
    await on(A, () => A.sev.importPack(new Blob([JSON.stringify(pack)])));
    const vid = await on(A, () => A.sev.variantScore('sev-t', 2));
    await on(A, () => A.eng.syncNow());

    const B = await device();
    await on(B, () => B.eng.enableSync(URL_, KEY));
    expect(B.eng.getStatus().error).toBeUndefined();
    const p = await on(B, () => B.db.sevcikPacks.get('sev-t'));
    expect(p?.variants.map((v) => v.n)).toEqual([1, 2]);
    expect((await on(B, () => B.db.sevcikXml.get('sev-t:2')))?.xml).toBe(xml('v2'));
    // 변형 악보·연결도 같음
    expect(await on(B, () => B.sev.scoreMap('sev-t'))).toEqual({ 2: vid });
    expect((await on(B, () => B.db.scores.get(vid)))?.sevcik).toEqual({ pack: 'sev-t', n: 2 });
    // B 에서 다른 변형을 열면 두 기기 연결이 합쳐짐
    const vid1 = await on(B, () => B.sev.variantScore('sev-t', 1));
    await on(B, () => B.eng.syncNow());
    await on(A, () => A.eng.syncNow());
    expect(await on(A, () => A.sev.scoreMap('sev-t'))).toEqual({ 1: vid1, 2: vid });
    // 팩을 다시 받아 넣지 않음 (메아리 없음)
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    expect(B.eng.getStatus().pulled).toBe(0);
    // 지우기
    await on(A, () => A.sev.deletePack('sev-t'));
    await new Promise((r) => setTimeout(r, 5));
    await on(A, () => A.eng.syncNow());
    await on(B, () => B.eng.syncNow());
    expect(await on(B, () => B.db.sevcikPacks.count())).toBe(0);
    expect(await on(B, () => B.db.sevcikXml.count())).toBe(0);
  });

  it('열쇠가 틀리면 켜지지 않음', async () => {
    await server();
    const A = await device();
    await expect(on(A, () => A.eng.enableSync(URL_, 'wrong-key-1234567890'))).rejects.toThrow('열쇠');
    expect(A.ls.getItem('violin-sync')).toBeNull();
  });
});
