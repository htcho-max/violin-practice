// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { msUntilNextMidnight } from '../src/state/useToday';
import { dueAlert, transitions } from '../src/state/session';
import { db, scoreListKey, loadScoreList } from '../src/data/db';

describe('자정', () => {
  it('다음 자정까지 남은 시간', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 19, 23, 59, 0))).toBe(61_000);
    expect(msUntilNextMidnight(new Date(2026, 9, 19, 0, 0, 0))).toBe(24 * 3600_000 + 1000);
  });
});

describe('항목 시간 끝 알림', () => {
  const items = [{ key: 'a', label: '튜닝', minutes: 1 }, { key: 'b', label: '음계', minutes: 2 }];
  it('시간을 채우면 한 번만', () => {
    const s = transitions.start(items, 0);
    expect(dueAlert(s, 59_000)).toBe(null);
    expect(dueAlert(s, 60_000)).toBe(0);
    expect(dueAlert({ ...s, alerted: [0] }, 90_000)).toBe(null);
  });
  it('멈춘 동안에는 알리지 않음, 0분 항목은 없음', () => {
    const p = { ...transitions.pause(transitions.start(items, 0), 61_000) };
    expect(dueAlert({ ...p, runningSince: null }, 999_999)).toBe(null);
    const z = transitions.start([{ key: 'z', label: 'z', minutes: 0 }], 0);
    expect(dueAlert(z, 999_999)).toBe(null);
  });
});

describe('악보 목록 열쇠', () => {
  it('넣기·고치기·폴더 옮기기·지우기를 따라감', async () => {
    const id = await db.scores.add({ title: '가보트', xml: '<x/>', createdAt: 5, folder: 'suzuki-2' });
    let list = await loadScoreList();
    expect(list.find((s) => s.id === id)).toMatchObject({ title: '가보트', folder: 'suzuki-2', exercise: false, createdAt: 5 });
    await db.scores.update(id, { title: '가보트 2', folder: undefined, pieceId: 'p1' });
    list = await loadScoreList();
    expect(list.find((s) => s.id === id)).toMatchObject({ title: '가보트 2', folder: undefined, pieceId: 'p1' });
    await db.scores.filter((s) => s.id === id).modify((s) => { s.folder = 'f2'; });
    expect((await loadScoreList()).find((s) => s.id === id)?.folder).toBe('f2');
    await db.scores.bulkPut([{ id, title: '되돌림', xml: '<y/>', createdAt: 7 }]);
    expect((await loadScoreList()).find((s) => s.id === id)).toMatchObject({ title: '되돌림', createdAt: 7 });
    await db.scores.delete(id);
    expect((await loadScoreList()).find((s) => s.id === id)).toBeUndefined();
    expect(scoreListKey({ title: 't', createdAt: 1, exercise: {} as never })[4]).toBe(1);
  });
});
