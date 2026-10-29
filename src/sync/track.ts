/**
 * 동기화용 변경 추적 (Dexie 훅). db.ts 에서 설치.
 * - 동기화하는 표의 줄마다 `_u` (바꾼 시각 ms) 를 붙임 → 보낼 때 `_u > 지난번` 만 골라 보냄
 * - 동기화가 켜져 있으면: 숫자 id 를 기기끼리 겹치지 않는 큰 수로 만들고(gid), 지운 줄은 묘비(tomb)로 남김
 * - 서버에서 받아 넣는 트랜잭션(tx.__remote)에서는 아무것도 하지 않음
 */
import type Dexie from 'dexie';
import type { Table, Transaction } from 'dexie';

/** 동기화하는 표 (녹음·세브치크 XML 은 빼고) */
export const SYNC_TABLES = ['sessions', 'pieces', 'kv', 'ladders', 'scores', 'scoreRuns', 'lessonNotes', 'reviews', 'echoRuns', 'sevcikPacks'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
/** 자동 증가 숫자 id 를 쓰는 표 (녹음 포함 — 다른 표가 녹음 id 를 가리킴) */
export const NUMERIC_TABLES = ['sessions', 'ladders', 'scores', 'scoreRuns', 'lessonNotes', 'echoRuns', 'recordings'] as const;
/** 이보다 작은 숫자 id 는 기기 안에서만 쓰던 옛 id */
export const GID_MIN = 1e12;

export interface Tomb { k: string; t: string; key: string | number; u: number }

export const SYNC_FLAG = 'violin-sync';
/** 이 기기에서 동기화를 한 번이라도 켰음 (끈 동안 지운 것도 묘비로 남겨 두었다가 다시 켜면 알림) */
export const SYNC_EVER = 'violin-sync-ever';
export function syncOn(): boolean {
  try { return !!localStorage.getItem(SYNC_FLAG); } catch { return false; }
}
export function syncEver(): boolean {
  try { return !!localStorage.getItem(SYNC_EVER); } catch { return false; }
}

let lastGid = 0;
/** 기기끼리 겹치지 않는 id: 밀리초 × 1000 + 임의 수 (같은 기기 안에서는 늘 커짐) */
export function newGid(): number {
  const g = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  lastGid = Math.max(lastGid + 1, g);
  return lastGid;
}

type Listener = () => void;
const listeners = new Set<Listener>();
/** 이 기기에서 바뀐 것이 생기면 알림 (동기화 예약용) */
export function onLocalChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
function notify(tx: Transaction) {
  const t = tx as Transaction & { __notified?: boolean };
  if (t.__notified) return;
  t.__notified = true;
  tx.on('complete', () => { for (const f of listeners) try { f(); } catch { /* 무시 */ } });
}

const isRemote = (tx: Transaction) => !!(tx as Transaction & { __remote?: boolean }).__remote;
export function markRemote(tx: Transaction) { (tx as Transaction & { __remote?: boolean }).__remote = true; }

export function installTracking(db: Dexie & { tomb: Table<Tomb, string> }) {
  for (const name of SYNC_TABLES) {
    const table = db.table(name);
    const numeric = (NUMERIC_TABLES as readonly string[]).includes(name);
    table.hook('creating', function (pk, obj, tx) {
      if (isRemote(tx)) return undefined;
      (obj as { _u?: number })._u = Date.now();
      notify(tx);
      if (numeric && pk === undefined && syncOn()) return newGid();
      return undefined;
    });
    table.hook('updating', function (_mods, _pk, obj, tx) {
      if (isRemote(tx)) return undefined;
      notify(tx);
      // 다른 기기 시계가 빨라서 받은 _u 가 미래여도 이 수정이 이기게
      return { _u: Math.max(Date.now(), (((obj as { _u?: number })._u) ?? 0) + 1) };
    });
    table.hook('deleting', function (pk, obj, tx) {
      if (isRemote(tx) || !(syncOn() || syncEver())) return;
      const key = pk as string | number;
      const t: Tomb = { k: `${name}\u0001${key}`, t: name, key, u: Math.max(Date.now(), (((obj as { _u?: number } | undefined)?._u) ?? 0) + 1) };
      tx.on('complete', () => { db.tomb.put(t).catch(() => {}); for (const f of listeners) try { f(); } catch { /* 무시 */ } });
    });
  }
  // 녹음은 동기화하지 않지만 id 는 겹치지 않게
  db.table('recordings').hook('creating', function (pk, _obj, tx) {
    if (isRemote(tx)) return undefined;
    if (pk === undefined && syncOn()) return newGid();
    return undefined;
  });
}
