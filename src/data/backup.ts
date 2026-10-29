import { db } from './db';
import { markRemote, syncOn, SYNC_TABLES } from '../sync/track';
import { afterRestore, globalizeIds } from '../sync/engine';

/** 백업 파일 형식 (버전 2: 모든 표) */
export interface Backup {
  app: 'violin-practice';
  version: 2;
  exportedAt: string;
  withRecordings: boolean;
  tables: Record<string, unknown[]>;
}
const TABLES = ['sessions', 'pieces', 'kv', 'ladders', 'scores', 'scoreRuns', 'lessonNotes', 'reviews', 'echoRuns', 'recordings'] as const;

function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
}
async function dataURLToBlob(u: string): Promise<Blob> {
  const [head, body] = u.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function makeBackup(withRecordings: boolean): Promise<Blob> {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    if (t === 'recordings') {
      const rows = await db.recordings.toArray();
      tables.recordings = withRecordings
        ? await Promise.all(rows.map(async (r) => ({ ...r, blob: await blobToDataURL(r.blob) })))
        : [];
      continue;
    }
    tables[t] = await (db as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[t].toArray();
  }
  const data: Backup = { app: 'violin-practice', version: 2, exportedAt: new Date().toISOString(), withRecordings, tables };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** 백업 파일 내려받기 (가능하면 공유 시트로) */
export async function saveBackup(withRecordings: boolean) {
  const blob = await makeBackup(withRecordings);
  const name = `violin-practice-${new Date().toISOString().slice(0, 10)}${withRecordings ? '-녹음포함' : ''}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [file], title: '바이올린 연습 백업' }); return; } catch { /* 취소하면 내려받기로 */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 백업에서 되돌리기: 지금 기록을 모두 지우고 백업 내용으로 바꿈. 녹음이 없는 백업이면 지금 녹음은 남김 */
export async function restoreBackup(text: string): Promise<{ counts: Record<string, number> }> {
  const data = JSON.parse(text) as Partial<Backup> & { sessions?: unknown[]; settings?: unknown };
  // 예전 형식 (설정 + 세션만)
  if (!data.tables && Array.isArray(data.sessions)) {
    data.tables = { sessions: data.sessions, kv: data.settings ? [{ key: 'settings', value: data.settings }] : [] };
    data.withRecordings = false;
  }
  if (!data.tables) throw new Error('바이올린 연습 도우미 백업 파일이 아니에요.');
  const t = data.tables;
  const counts: Record<string, number> = {};
  const recs = data.withRecordings && Array.isArray(t.recordings)
    ? await Promise.all((t.recordings as { blob: string }[]).map(async (r) => ({ ...r, blob: await dataURLToBlob(r.blob) })))
    : null;
  const syncing = syncOn();
  const now = Date.now();
  await db.transaction('rw', [db.sessions, db.pieces, db.kv, db.ladders, db.scores, db.scoreRuns, db.lessonNotes, db.reviews, db.echoRuns, db.recordings], async (tx) => {
    // 동기화 중이면: 지운 것을 다른 기기에 알리지 않고(묘비 없음), 되돌린 줄은 지금 시각으로 → 서버로 보내짐
    if (syncing) markRemote(tx);
    for (const name of TABLES) {
      // 복습함이 없던 예전 백업: 악보를 되돌리면 복습함은 비움 (없는 악보의 마디가 남지 않게)
      const rows = name === 'recordings' ? recs : name === 'reviews' && !t.reviews && t.scores ? [] : (t[name] as unknown[] | undefined);
      if (!rows) continue;
      const table = (db as unknown as Record<string, { clear: () => Promise<void>; bulkPut: (r: unknown[]) => Promise<unknown> }>)[name];
      await table.clear();
      const put = syncing && (SYNC_TABLES as readonly string[]).includes(name) ? rows.map((r) => ({ ...(r as object), _u: now })) : rows;
      if (put.length) await table.bulkPut(put);
      counts[name] = rows.length;
    }
  });
  // 동기화 중이면: 옛 백업의 작은 id 를 다른 기기와 겹치지 않게 (되돌린 기록은 다음 동기화에서 서버로)
  if (syncing) { await globalizeIds(); afterRestore(); }
  return { counts };
}

/** 브라우저가 저장 공간을 비울 때 지우지 않도록 요청 */
export async function requestPersist(): Promise<boolean | null> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return null;
    if (await s.persisted()) return true;
    return await s.persist();
  } catch { return null; }
}
export async function storageInfo(): Promise<{ usedMB: number; persisted: boolean | null } | null> {
  try {
    const s = navigator.storage;
    if (!s?.estimate) return null;
    const e = await s.estimate();
    return { usedMB: (e.usage ?? 0) / 1024 / 1024, persisted: s.persisted ? await s.persisted() : null };
  } catch { return null; }
}
