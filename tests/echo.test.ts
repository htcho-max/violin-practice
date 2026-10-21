import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { ECHO_KEYS, ECHO_LEVELS, echoPool, makePhrase, rng, scoreEcho, nextLength, echoFingers, spell } from '../src/exercise/echo';
import { weeklyTrends, mondayOf, trendWord } from '../src/data/insights';
import type { EchoRun, ScoreRun } from '../src/data/db';

describe('따라 하기: 음 묶음', () => {
  it('조에 맞는 음과 철자', () => {
    expect(echoPool('G', 'three').map((n) => n.name)).toEqual(['G3', 'A3', 'B3']);
    expect(echoPool('D', 'five').map((n) => n.name)).toEqual(['D4', 'E4', 'F♯4', 'G4', 'A4']);
    expect(echoPool('Bb', 'three').map((n) => n.name)).toEqual(['B♭3', 'C4', 'D4']);
    // 단조는 화성단음계 (7음 올림)
    const am = echoPool('Am', 'oct').map((n) => n.name);
    expect(am).toEqual(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G♯4', 'A4']);
  });
  it('1포지션 전체는 G3~B5, 3포지션까지는 D6 까지, 모두 바이올린 음역', () => {
    for (const k of ECHO_KEYS) for (const l of ECHO_LEVELS) {
      const p = echoPool(k.id, l.id);
      expect(p.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...p.map((n) => n.midi))).toBeGreaterThanOrEqual(55);
      expect(Math.max(...p.map((n) => n.midi))).toBeLessThanOrEqual(l.id === 'third' ? 86 : 83);
      // 낮은 음부터, 같은 음 없음
      expect(p.map((n) => n.midi)).toEqual([...new Set(p.map((n) => n.midi))].sort((a, b) => a - b));
    }
    const g1 = echoPool('G', 'first').map((n) => n.midi);
    expect(g1[0]).toBe(55);
    expect(g1[g1.length - 1]).toBe(83); // B5
    expect(Math.max(...echoPool('D', 'third').map((n) => n.midi))).toBe(86); // D6
    expect(echoPool('Gm', 'first')[0].name).toBe('G3'); // F♯3 은 음역 밖
  });
  it('철자', () => {
    expect(spell({ d: 28, alter: 1 })).toBe('C♯4');
    expect(spell({ d: 34, alter: -1 })).toBe('B♭4');
  });
});

describe('따라 하기: 구절·채점', () => {
  it('같은 씨앗이면 같은 구절, 묶음 안의 음만, 같은 음 연달아 없음', () => {
    const pool = echoPool('A', 'first');
    const a = makePhrase(pool, 5, rng(7)), b = makePhrase(pool, 5, rng(7));
    expect(a).toEqual(b);
    for (let s = 1; s < 60; s++) {
      const p = makePhrase(pool, 6, rng(s));
      expect(p).toHaveLength(6);
      p.forEach((n, i) => { expect(pool).toContain(n); if (i) expect(n.midi).not.toBe(p[i - 1].midi); });
    }
  });
  it('채점: 맞음·틀림·빠짐, 같은 음이 이어 잡히면 하나로', () => {
    const r = scoreEcho([67, 69, 71], [67, 67, 69, 72]);
    expect(r.marks).toEqual(['ok', 'ok', 'wrong']);
    expect(r.correct).toBe(2);
    expect(r.perfect).toBe(false);
    expect(scoreEcho([67, 69, 71], [67]).marks).toEqual(['ok', 'missing', 'missing']);
    expect(scoreEcho([67, 69, 71], []).correct).toBe(0);
  });
  it('채점: 앞에 잡음이 있으면 가장 잘 맞는 자리로', () => {
    const r = scoreEcho([67, 69, 71], [60, 67, 69, 71]);
    expect(r.perfect).toBe(true);
    expect(r.played).toEqual([67, 69, 71]);
  });
  it('맞은 음의 평균 음정 오차 (센트)', () => {
    const r = scoreEcho([67, 69, 71], [60, 67, 67, 69, 70], [3, -10, 50, 6, 20]);
    expect(r.marks).toEqual(['ok', 'ok', 'wrong']);
    expect(r.meanAbs).toBeCloseTo(8); // 67(-10, 이어 잡힌 50 은 뺌), 69(6)
    expect(scoreEcho([67], [67]).meanAbs).toBeNull();
    expect(scoreEcho([67], [68], [5]).meanAbs).toBeNull();
  });
  it('길이: 3번 연속 다 맞으면 +1 (최대 6), 2번 연속 절반 못 맞히면 −1 (최소 3)', () => {
    expect(nextLength(3, [true, true, true], 0)).toBe(4);
    expect(nextLength(6, [true, true, true], 0)).toBe(6);
    expect(nextLength(4, [true, false, true], 0)).toBe(4);
    expect(nextLength(4, [false, false], 2)).toBe(3);
    expect(nextLength(3, [false, false], 2)).toBe(3);
  });
  it('운지: 1포지션 위주, 3포지션까지면 높은 음은 3포지션', () => {
    expect(echoFingers('G', 'three', [55, 57, 59])).toEqual(['G현 0', 'G현 1', 'G현 2']);
    expect(echoFingers('D', 'first', [69, 71, 73])).toEqual(['A현 0', 'A현 1', 'A현 2']);
    const hi = echoFingers('D', 'third', [83, 85, 86]);
    expect(hi[2]).toMatch(/E현 4 \(3포지션\)/);
  });
});

describe('주별 추이', () => {
  const today = '2026-10-21'; // 수요일
  it('월요일 시작', () => {
    expect(mondayOf(today)).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });
  it('주마다 연습 시간·날 수, 악보 맞은 음 %·센트·박자, 따라 하기', () => {
    const run = (date: string, ok: number, total: number, meanAbs: number | null, inSession = false, rhythmMs: number | null = null) =>
      ({ date, ok, total, meanAbs, durationSec: 120, inSession, rhythmMs } as Pick<ScoreRun, 'date' | 'ok' | 'total' | 'durationSec' | 'inSession' | 'meanAbs' | 'rhythmMs'>);
    const echo = (date: string, hits: number, expected: number) => ({ date, hits, expected } as Pick<EchoRun, 'date' | 'hits' | 'expected'>);
    const w = weeklyTrends(
      [{ date: '2026-10-20', totalSec: 1800 }, { date: '2026-10-13', totalSec: 600 }, { date: '2026-08-01', totalSec: 9999 }],
      [run('2026-10-20', 9, 10, 10, true, 40), run('2026-10-21', 7, 10, 20, false, 60), run('2026-10-21', 1, 2, 50), run('2026-10-14', 5, 10, null)],
      [echo('2026-10-21', 3, 3), echo('2026-10-21', 1, 4), echo('2026-10-12', 2, 4)],
      today,
    );
    expect(w).toHaveLength(8);
    expect(w[7].start).toBe('2026-10-19');
    expect(w[0].start).toBe('2026-08-31');
    // 이번 주: 세션 30분 + 세션 밖 채점 2분 2번 = 34분, 20·21일
    expect(w[7].minutes).toBe(34);
    expect(w[7].days).toBe(2);
    expect(w[7].runs).toBe(3);
    expect(w[7].scorePct).toBeCloseTo(80); // 4음 미만 채점은 뺌
    expect(w[7].scoreCents).toBeCloseTo(15);
    expect(w[7].rhythmMs).toBeCloseTo(50);
    expect(w[7].echoPct).toBeCloseTo((4 / 7) * 100);
    expect([w[7].echoPerfect, w[7].echoTries]).toEqual([1, 2]);
    // 지난주
    expect(w[6].minutes).toBe(12);
    expect(w[6].scorePct).toBeCloseTo(50);
    expect(w[6].scoreCents).toBeNull();
    expect(w[6].echoPct).toBeCloseTo(50);
    // 기록 없는 주
    expect(w[0]).toMatchObject({ minutes: 0, days: 0, scorePct: null, echoPct: null, runs: 0 });
  });
  it('좋아졌는지 (작을수록 좋은 지표도)', () => {
    expect(trendWord([50, null, 70], false, 2)).toBe('up');
    expect(trendWord([20, 12], true, 1)).toBe('up');
    expect(trendWord([12, 20], true, 1)).toBe('down');
    expect(trendWord([50, 51], false, 2)).toBe('same');
    expect(trendWord([null, 50], false, 2)).toBeNull();
  });
});

describe('따라 하기 DB (v9)', () => {
  it('v8 에서 v9 로: 기존 데이터 그대로, echoRuns 추가, 백업에 포함', async () => {
    const old = new Dexie('violin-practice');
    old.version(8).stores({
      sessions: '++id, date, startedAt', pieces: 'id, book, status', kv: 'key', ladders: '++id, date, pieceId', recordings: '++id, createdAt, pieceId',
      scores: '++id, createdAt, pieceId, exercise.stepId, listKey', scoreRuns: '++id, date, scoreId, createdAt', lessonNotes: '++id, date, scoreId, createdAt', reviews: 'id, due, scoreId',
    });
    await old.table('sessions').add({ date: '2026-10-20', startedAt: 1, totalSec: 60, items: [] });
    await old.table('reviews').put({ id: '1:2', scoreId: 1, measure: 2, title: 't', box: 0, due: '2026-10-20', added: '2026-10-19' });
    old.close();

    const { db } = await import('../src/data/db');
    await db.open();
    expect(db.verno).toBe(9);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.reviews.count()).toBe(1);
    await db.echoRuns.add({ createdAt: 1, date: '2026-10-21', key: 'G', level: 'three', notes: [55, 57, 59], hits: 3, expected: 3, meanAbs: 6 });

    const { makeBackup, restoreBackup } = await import('../src/data/backup');
    const text = await (await makeBackup(false)).text();
    expect(JSON.parse(text).tables.echoRuns).toHaveLength(1);
    await db.echoRuns.clear();
    const res = await restoreBackup(text);
    expect(res.counts.echoRuns).toBe(1);
    expect((await db.echoRuns.toArray())[0]).toMatchObject({ key: 'G', hits: 3 });
    // 따라 하기가 없던 예전 백업: 지금 기록은 그대로
    const legacy = JSON.parse(text);
    delete legacy.tables.echoRuns;
    await restoreBackup(JSON.stringify(legacy));
    expect(await db.echoRuns.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
  });
});
