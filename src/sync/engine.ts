/**
 * 기기 간 동기화 (Cloudflare Worker + D1). 서버 설명: cloud/src/index.ts
 *
 * - 표의 줄마다 `_u`(바꾼 시각). 같은 줄이 두 기기에서 바뀌면 나중에 바꾼 쪽이 이김.
 * - 한 번 동기화 = 받기(pull: 서버 순번 since 다음부터) → 보내기(push: _u > 지난 보낸 시각 + 묘비).
 * - 악보 XML 은 내용 해시로 따로(blob) 올리고 기록에는 해시만.
 * - 세브치크 팩은 팩 파일 글자 전체를 blob 으로, 받는 기기에서 importPack.
 * - 처음 켤 때: 옛 숫자 id 를 겹치지 않는 큰 id 로 바꾸고(globalize), 모든 줄의 _u 를 1 로 → 서버에 이미 있는 것이 이김.
 */
import type { Table } from 'dexie';
import { db, scoreListKey, type ScoreFile, type SevcikPack } from '../data/db';
import { deletePack, importPack, packTextFromDb } from '../data/sevcik';
import { GID_MIN, NUMERIC_TABLES, SYNC_EVER, SYNC_FLAG, SYNC_TABLES, markRemote, newGid, syncEver, type SyncTable, type Tomb } from './track';
import { getBlob, missingBlobs, ping, pull, push, putBlob, sha256, SyncError, type Change, type PullRow, type Remote } from './net';

export interface SyncConfig extends Remote {
  /** 보낸 시각: _u 가 이보다 큰 줄만 보냄 */
  pushAt: number;
  /** 받은 서버 순번 */
  pullSeq: number;
  /** 처음 동기화 중 (같은 시각이면 서버 쪽이 이김) */
  initial: boolean;
}
export interface SyncStatus { state: 'off' | 'idle' | 'syncing' | 'error'; lastOk?: number; error?: string; pulled?: number; pushed?: number }

/** 기기마다 다른 설정 (동기화해도 이 기기 값을 지킴) */
const DEVICE_SETTINGS = ['latencyMs', 'minDb'] as const;
const STATUS_KEY = 'violin-sync-status';
export const SYNC_APPLIED_EVENT = 'violin-sync-applied';

export function loadConfig(): SyncConfig | null {
  try { const s = localStorage.getItem(SYNC_FLAG); return s ? JSON.parse(s) as SyncConfig : null; } catch { return null; }
}
function saveConfig(c: SyncConfig | null) {
  try { if (c) localStorage.setItem(SYNC_FLAG, JSON.stringify(c)); else localStorage.removeItem(SYNC_FLAG); } catch { /* 무시 */ }
}

// ---- 상태 알림 ----
type StatusFn = (s: SyncStatus) => void;
const statusFns = new Set<StatusFn>();
let status: SyncStatus = (() => {
  try { const s = localStorage.getItem(STATUS_KEY); if (s) return { ...JSON.parse(s), state: loadConfig() ? 'idle' : 'off' } as SyncStatus; } catch { /* 무시 */ }
  return { state: 'off' };
})();
export function getStatus(): SyncStatus { return status; }
export function onStatus(fn: StatusFn): () => void { statusFns.add(fn); return () => statusFns.delete(fn); }
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  try { localStorage.setItem(STATUS_KEY, JSON.stringify({ lastOk: status.lastOk, error: status.error, pulled: status.pulled, pushed: status.pushed })); } catch { /* 무시 */ }
  for (const f of statusFns) try { f(status); } catch { /* 무시 */ }
}

const tableOf = (t: string) => db.table(t) as Table<Record<string, unknown>, string | number>;
const isNumeric = (t: string) => (NUMERIC_TABLES as readonly string[]).includes(t);
const keyOf = (t: string, k: string): string | number => (isNumeric(t) ? Number(k) : k);
/** 맨 위 열쇠 순서를 정렬한 JSON (같은 내용이면 같은 글자) */
function canon(o: Record<string, unknown>): string {
  const s: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) s[k] = o[k];
  return JSON.stringify(s);
}

// ---- 처음 켤 때: 옛 id 바꾸기 + _u 를 1 로 ----
/** 숫자 id 가 GID_MIN 보다 작은 줄을 새 id 로 옮기고, 가리키는 곳도 모두 고침 */
const IDMAP_KEY = 'violin-sync-idmap';
/** 이 기기에서 옛 id → 새 id 로 바꾼 기록 (옛 백업을 되돌려도 같은 새 id 로 → 서버에 겹쳐 생기지 않게) */
function loadIdMaps(): Record<string, Map<number, number>> {
  const out: Record<string, Map<number, number>> = {};
  let raw: Record<string, Record<string, number>> = {};
  try { raw = JSON.parse(localStorage.getItem(IDMAP_KEY) || '{}'); } catch { /* 무시 */ }
  for (const t of NUMERIC_TABLES) out[t] = new Map(Object.entries(raw[t] ?? {}).map(([a, b]) => [Number(a), b]));
  return out;
}
function saveIdMaps(maps: Record<string, Map<number, number>>) {
  const raw: Record<string, Record<string, number>> = {};
  for (const [t, m] of Object.entries(maps)) raw[t] = Object.fromEntries(m);
  try { localStorage.setItem(IDMAP_KEY, JSON.stringify(raw)); } catch { /* 무시 */ }
}

export async function globalizeIds(): Promise<number> {
  const tables = [...new Set([...NUMERIC_TABLES, 'reviews', 'kv'])].map((t) => db.table(t));
  let moved = 0;
  const maps = loadIdMaps();
  await db.transaction('rw', tables, async (tx) => {
    markRemote(tx);
    const here: Record<string, Map<number, number>> = {};
    for (const t of NUMERIC_TABLES) {
      const keys = (await db.table(t).toCollection().primaryKeys()) as number[];
      const m = new Map<number, number>();
      for (const k of keys) if (typeof k === 'number' && k < GID_MIN) {
        if (!maps[t].has(k)) maps[t].set(k, newGid());
        m.set(k, maps[t].get(k)!);
      }
      here[t] = m;
      moved += m.size;
    }
    if (!moved) return;
    const S = maps.scores, R = maps.scoreRuns, REC = maps.recordings;
    const fix = (m: Map<number, number>, v: unknown) => (typeof v === 'number' && m.has(v) ? m.get(v)! : v);
    for (const t of NUMERIC_TABLES) {
      const tb = db.table(t);
      const rows = await tb.toArray() as Record<string, unknown>[];
      const changed: Record<string, unknown>[] = [];
      const oldKeys: number[] = [];
      for (const r of rows) {
        const id = r.id as number;
        const nid = here[t].get(id);
        const nr = { ...r };
        if (nid !== undefined) { nr.id = nid; oldKeys.push(id); }
        if (t === 'scoreRuns') { nr.scoreId = fix(S, r.scoreId); nr.recordingId = fix(REC, r.recordingId); }
        if (t === 'recordings') { nr.scoreId = fix(S, r.scoreId); nr.runId = fix(R, r.runId); }
        if (t === 'lessonNotes') nr.scoreId = fix(S, r.scoreId);
        if (nid !== undefined || canon(nr) !== canon(r)) changed.push(nr);
        // 이 기기에 없는 녹음을 가리키면 떼어 냄 (옛 백업)
        if (t === 'scoreRuns' && typeof nr.recordingId === 'number' && nr.recordingId < GID_MIN) delete nr.recordingId;
      }
      if (oldKeys.length) await tb.bulkDelete(oldKeys);
      if (changed.length) await tb.bulkPut(changed);
    }
    // 복습함: id 가 "악보id:마디"
    const revs = await db.reviews.toArray();
    const fixedRevs = revs.filter((r) => S.has(r.scoreId)).map((r) => ({ ...r, scoreId: S.get(r.scoreId)!, id: `${S.get(r.scoreId)}:${r.measure}` }));
    if (fixedRevs.length) {
      await db.reviews.bulkDelete(revs.filter((r) => S.has(r.scoreId)).map((r) => r.id));
      await db.reviews.bulkPut(fixedRevs);
    }
    // kv: 마디 템포 사다리("악보id:마디"), 세브치크 변형 → 악보 id
    const dl = await db.kv.get('drill-ladders');
    if (dl?.value && typeof dl.value === 'object') {
      const nv: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(dl.value as Record<string, unknown>)) {
        const [a, ...rest] = k.split(':');
        const nid = S.get(Number(a));
        nv[nid !== undefined ? [String(nid), ...rest].join(':') : k] = v;
      }
      await db.kv.put({ ...dl, value: nv });
    }
    for (const row of await db.kv.where('key').startsWith('sevcik-scores:').toArray()) {
      const nv: Record<string, number> = {};
      for (const [n, id] of Object.entries(row.value as Record<string, number>)) nv[n] = S.get(id) ?? id;
      await db.kv.put({ ...row, value: nv });
    }
  });
  if (moved) saveIdMaps(maps);
  return moved;
}

/** 모든 동기화 줄의 _u 를 1 로 (처음 동기화에서 서버 쪽이 이기게) + 묘비 비우기 */
async function stampAll(u = 1) {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.tomb], async (tx) => {
    markRemote(tx);
    for (const t of SYNC_TABLES) await db.table(t).toCollection().modify((r: Record<string, unknown>) => { r._u = u; });
    await db.tomb.clear();
  });
}

// ---- 줄 ↔ 서버 기록 ----
type Row = Record<string, unknown>;
const BLOB_FIELDS: [string, string][] = [['xml', 'xmlH'], ['origXml', 'origH'], ['accXml', 'accH']];

/** 보낼 내용 만들기. blobs 에 올릴 큰 글자를 모음 */
async function toRemote(t: SyncTable, row: Row, blobs: Map<string, string>): Promise<string | null> {
  const v: Row = { ...row };
  delete v._u;
  if (t === 'scores') {
    delete v.listKey;
    for (const [f, hf] of BLOB_FIELDS) {
      const text = v[f];
      delete v[f];
      if (typeof text === 'string') { const h = await sha256(text); blobs.set(h, text); v[hf] = h; }
    }
  }
  if (t === 'sevcikPacks') {
    const text = await packTextFromDb(String(row.id));
    if (!text) return null;
    const h = await sha256(text);
    blobs.set(h, text);
    v.packH = h;
  }
  return canon(v);
}

interface Prepared { row: PullRow; v: Row | null; skip?: boolean; packText?: string }

/** 받은 기록을 넣기 전에: 넣을지 정하고, 필요한 악보 글자를 내려받음 (트랜잭션 밖에서) */
/** 이 기기에서 그 줄을 (서버 것보다 나중에) 지웠는지 — 묘비가 있으면 다시 살리지 않음 */
async function deletedHereAfter(row: PullRow): Promise<boolean> {
  const t = await db.tomb.get(`${row.t}\u0001${keyOf(row.t, row.k)}`);
  return !!t && t.u >= row.u;
}
/** 받은 내용이 이 기기 줄과 같은지 (같은 시각일 때만 비교 — 드묾) */
const PUSHED_KEY = 'violin-sync-pushed';
/** 지난번에 보낸 줄 (t|k → u): 다음 받기에서 내 것이 되돌아오면 비교 없이 건너뜀 */
let pushedCache: Record<string, number> | null = null;
function pushed(): Record<string, number> {
  if (!pushedCache) { try { pushedCache = JSON.parse(localStorage.getItem(PUSHED_KEY) || '{}'); } catch { pushedCache = {}; } }
  return pushedCache!;
}
function savePushed(m: Record<string, number>) {
  pushedCache = m;
  try { localStorage.setItem(PUSHED_KEY, JSON.stringify(m)); } catch { /* 무시 */ }
}

async function sameAsLocal(row: PullRow, local: Row): Promise<boolean> {
  if (row.d) return false;
  if (pushed()[`${row.t}|${row.k}`] === row.u) return true;
  const mine = await toRemote(row.t as SyncTable, local, new Map());
  return mine !== null && mine === canon((row.v ?? {}) as Row);
}

async function prepare(r: Remote, rows: PullRow[]): Promise<Prepared[]> {
  const out: Prepared[] = [];
  for (const row of rows) {
    if (!(SYNC_TABLES as readonly string[]).includes(row.t)) continue;
    const local = await tableOf(row.t).get(keyOf(row.t, row.k));
    const lu = (local?._u as number | undefined) ?? 0;
    // 같은 시각이면 서버 것(서버가 받아들인 쪽)을 따름 — 내용이 같으면(내가 보낸 것) 건너뜀
    const wins = !local ? !(await deletedHereAfter(row)) : row.u > lu || (row.u === lu && !(await sameAsLocal(row, local)));
    if (!wins) { out.push({ row, v: null, skip: true }); continue; }
    if (row.d) { out.push({ row, v: null }); continue; }
    const v = { ...(row.v ?? {}) } as Row;
    try {
      if (row.t === 'scores') {
        for (const [f, hf] of BLOB_FIELDS) {
          const h = v[hf] as string | undefined;
          delete v[hf];
          if (!h) continue;
          const mine = local?.[f];
          v[f] = typeof mine === 'string' && (await sha256(mine)) === h ? mine : await getBlob(r, h);
        }
      }
      if (row.t === 'sevcikPacks') {
        const h = v.packH as string;
        const localH = local ? ((local.packH as string | undefined) ?? (await packTextFromDb(row.k).then((x) => (x ? sha256(x) : null)))) : null;
        if (h && localH !== h) { out.push({ row, v, packText: await getBlob(r, h) }); continue; }
      }
    } catch (e) {
      // 악보 글자를 못 받으면 이 줄만 건너뜀 (나머지는 계속) — 그 줄이 다시 바뀌면 다시 받음
      if (!(e instanceof SyncError) || e.status === 401) throw e;
      blobFailures++;
      out.push({ row, v: null, skip: true });
      continue;
    }
    out.push({ row, v });
  }
  return out;
}

/** 이번 동기화에서 서버에서 받아 넣은 줄 (다시 보내지 않게) */
let appliedNow = new Set<string>();
let blobFailures = 0;

/** 한 줄(kv)에 여러 항목을 담는 것들: 두 기기 것을 항목별로 합침. extra = 이 기기에만 있던 것이 들어감(다시 보내야 함) */
type Conflict = [number, number];
function mergeKv(key: string, local: unknown, remote: unknown, conflicts: Conflict[]): { value: unknown; extra: boolean } {
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (key === 'drill-ladders' || key === 'exercise-progress') {
    if (!isObj(local) || !isObj(remote)) return { value: remote, extra: false };
    const out: Record<string, unknown> = { ...remote };
    let extra = false;
    const at = (x: unknown) => (isObj(x) && typeof x.at === 'number' ? x.at : 0);
    for (const [k, lv] of Object.entries(local)) {
      if (!(k in remote) || at(lv) > at(remote[k])) { out[k] = lv; extra = true; }
    }
    return { value: out, extra };
  }
  if (key.startsWith('sevcik-scores:')) {
    if (!isObj(local) || !isObj(remote)) return { value: remote, extra: false };
    const out: Record<string, unknown> = { ...remote };
    let extra = false;
    for (const [n, lid] of Object.entries(local)) {
      if (!(n in remote)) { out[n] = lid; extra = true; }
      else if (remote[n] !== lid && typeof lid === 'number' && typeof remote[n] === 'number') conflicts.push([lid, remote[n] as number]);
    }
    return { value: out, extra };
  }
  if (key === 'score-folders') {
    if (!Array.isArray(local) || !Array.isArray(remote)) return { value: remote, extra: false };
    const ids = new Set(remote.map((f: { id?: string }) => f?.id));
    const add = local.filter((f: { id?: string }) => !ids.has(f?.id));
    return { value: [...remote, ...add], extra: add.length > 0 };
  }
  return { value: remote, extra: false };
}

/** 같은 세브치크 변형을 두 기기에서 따로 만들었을 때: 진 쪽 악보(from)의 기록·복습·내 표시를 이긴 쪽(to)으로 옮기고 지움 */
async function moveScoreHistory(from: number, to: number) {
  if (from === to) return;
  await db.transaction('rw', db.scores, db.scoreRuns, db.reviews, async () => {
    const [a, b] = await Promise.all([db.scores.get(from), db.scores.get(to)]);
    if (!a || !b) return;
    await db.scoreRuns.where('scoreId').equals(from).modify({ scoreId: to });
    for (const r of await db.reviews.where('scoreId').equals(from).toArray()) {
      await db.reviews.delete(r.id);
      const id = `${to}:${r.measure}`;
      if (!(await db.reviews.get(id))) await db.reviews.put({ ...r, id, scoreId: to });
    }
    if (a.marks && Object.keys(a.marks).length) await db.scores.update(to, { marks: { ...a.marks, ...(b.marks ?? {}) } });
    await db.scores.delete(from);
  });
}

async function apply(items: Prepared[]): Promise<number> {
  let n = 0;
  let settingsChanged = false;
  const conflicts: Conflict[] = [];
  // 팩은 importPack 이 자기 트랜잭션으로
  for (const it of items) {
    if (it.skip || it.row.t !== 'sevcikPacks') continue;
    if (it.row.d) { await deletePack(it.row.k, { remote: true }); n++; continue; }
    if (it.packText) await importPack(new Blob([it.packText]), { remote: true, packH: it.v!.packH as string, u: it.row.u });
    else await db.transaction('rw', db.sevcikPacks, async (tx) => { markRemote(tx); await db.sevcikPacks.put({ ...(it.v as unknown as SevcikPack), _u: it.row.u } as SevcikPack); });
    appliedNow.add(`${it.row.t}|${it.row.k}|${it.row.u}`);
    n++;
  }
  const rest = items.filter((it) => !it.skip && it.row.t !== 'sevcikPacks');
  if (!rest.length) return n;
  await db.transaction('rw', SYNC_TABLES.filter((t) => t !== 'sevcikPacks').map((t) => db.table(t)), async (tx) => {
    markRemote(tx);
    for (const { row, v } of rest) {
      const tb = tableOf(row.t);
      const key = keyOf(row.t, row.k);
      // 넣는 사이에 이 기기에서 더 새로 바뀌었으면 건드리지 않음
      const local = await tb.get(key);
      if (local && ((local._u as number) ?? 0) > row.u) continue;
      if (row.d) { if (local) { await tb.delete(key); n++; } continue; }
      const obj: Row = { ...v!, _u: row.u };
      if (row.t === 'scores') obj.listKey = scoreListKey(obj as unknown as ScoreFile);
      if (row.t === 'kv' && row.k === 'settings' && local && obj.value && typeof obj.value === 'object') {
        const lv = local.value as Record<string, unknown>;
        const rv = { ...(obj.value as Record<string, unknown>) };
        for (const f of DEVICE_SETTINGS) if (lv && f in lv) rv[f] = lv[f];
        obj.value = rv;
        settingsChanged = true;
      }
      if (row.t === 'kv' && local) {
        // 여러 항목을 한 줄에 담는 것: 항목별로 합침 (이 기기에만 있던 것이 있으면 다시 보냄)
        const m = mergeKv(row.k, local.value, obj.value, conflicts);
        obj.value = m.value;
        if (m.extra) obj._u = Math.max(Date.now(), row.u + 1);
      }
      await tb.put(obj);
      if (obj._u === row.u) appliedNow.add(`${row.t}|${row.k}|${row.u}`);
      n++;
    }
  });
  for (const [from, to] of conflicts) await moveScoreHistory(from, to);
  if (settingsChanged && typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_APPLIED_EVENT));
  return n;
}

async function pullAll(cfg: SyncConfig): Promise<number> {
  let n = 0;
  let limit = 300;
  for (let guard = 0; guard < 10000; guard++) {
    let page;
    try { page = await pull(cfg, cfg.pullSeq, limit); } catch (e) {
      // 서버가 버거워하면(5xx) 조금씩
      if (e instanceof SyncError && e.status >= 500 && limit > 3) { limit = Math.max(3, Math.floor(limit / 10)); continue; }
      throw e;
    }
    if (page.rows.length) n += await apply(await prepare(cfg, page.rows));
    cfg.pullSeq = page.cursor;
    saveConfig(cfg);
    if (!page.more) break;
  }
  savePushed({});
  return n;
}

const MAX_BATCH = 150, MAX_BYTES = 400_000;
async function pushAll(cfg: SyncConfig): Promise<number> {
  const startedAt = Date.now() - 1;
  const changes: Change[] = [];
  const blobs = new Map<string, string>();
  for (const t of SYNC_TABLES) {
    const rows = await tableOf(t).where('_u').above(cfg.pushAt).toArray();
    for (const row of rows) {
      const k = String(t === 'kv' ? row.key : row.id);
      const u = row._u as number;
      if (appliedNow.has(`${t}|${k}|${u}`)) continue;
      const v = await toRemote(t, row, blobs);
      if (v !== null) changes.push({ t, k, u, v });
    }
  }
  const tombs: Tomb[] = await db.tomb.toArray();
  for (const tb of tombs) {
    // 지운 뒤 같은 열쇠로 다시 만들었으면(백업 되돌리기 등) 묘비는 보내지 않음
    if (await tableOf(tb.t).get(tb.key)) continue;
    changes.push({ t: tb.t, k: String(tb.key), u: tb.u, d: 1 });
  }
  // 큰 글자 먼저 (기록이 가리키는 악보가 서버에 있게)
  if (blobs.size) {
    const miss = await missingBlobs(cfg, [...blobs.keys()]);
    for (const h of miss) await putBlob(cfg, h, blobs.get(h)!);
  }
  let batch: Change[] = [], bytes = 0;
  const send = async (cs: Change[]): Promise<void> => {
    try { await push(cfg, cs); } catch (e) {
      // 서버가 버거워하면(5xx) 반씩 나눠서
      if (e instanceof SyncError && e.status >= 500 && cs.length > 1) { const h = Math.ceil(cs.length / 2); await send(cs.slice(0, h)); await send(cs.slice(h)); return; }
      throw e;
    }
  };
  const flush = async () => { if (batch.length) await send(batch); batch = []; bytes = 0; };
  for (const c of changes) {
    const len = (c.v?.length ?? 0) + 100;
    if (batch.length >= MAX_BATCH || (batch.length && bytes + len > MAX_BYTES)) await flush();
    batch.push(c); bytes += len;
  }
  await flush();
  if (changes.length) {
    const m = { ...pushed() };
    for (const c of changes) if (!c.d) m[`${c.t}|${c.k}`] = c.u;
    savePushed(m);
  }
  if (tombs.length) await db.transaction('rw', db.tomb, async () => {
    for (const tb of tombs) { const cur = await db.tomb.get(tb.k); if (cur && cur.u === tb.u) await db.tomb.delete(tb.k); }
  });
  cfg.pushAt = startedAt;
  saveConfig(cfg);
  return changes.length;
}

let running: Promise<void> | null = null;
let again = false;
/** 한 번 동기화 (이미 하는 중이면 끝난 뒤 한 번 더) */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        const cfg = loadConfig();
        if (!cfg) { setStatus({ state: 'off' }); return; }
        setStatus({ state: 'syncing' });
        appliedNow = new Set();
        blobFailures = 0;
        try {
          const pulled = await pullAll(cfg);
          const pushed = await pushAll(cfg);
          if (cfg.initial) { cfg.initial = false; saveConfig(cfg); }
          setStatus({ state: 'idle', lastOk: Date.now(), error: blobFailures ? `악보 ${blobFailures}개를 받지 못했어요 (그 악보가 다시 바뀌면 다시 받아요).` : undefined, pulled, pushed });
        } catch (e) {
          setStatus({ state: 'error', error: e instanceof SyncError ? e.message : `동기화 오류: ${(e as Error).message}` });
          return;
        }
      } while (again);
    } finally { running = null; }
  })();
  return running;
}

/** 동기화 켜기: 서버 확인 → 이 기기 id 정리·_u 초기화 → 처음 동기화 */
export async function enableSync(url: string, key: string): Promise<void> {
  const r: Remote = { url: url.trim(), key: key.trim() };
  if (!/^https?:\/\//.test(r.url)) throw new SyncError('서버 주소는 https:// 로 시작해야 해요.');
  if (r.key.length < 16) throw new SyncError('동기화 열쇠가 너무 짧아요 (16글자 이상).');
  await ping(r);
  await globalizeIds();
  // 처음 켜는 기기만: 모든 줄을 _u=1 로 → 서버에 이미 있는 것이 이김.
  // 껐다 다시 켜는 기기는 그대로 (끈 동안 고친 것이 지지 않게) — 다 보내고 다 받아서 시각으로 비교
  const first = !syncEver();
  if (first) await stampAll(1);
  saveConfig({ ...r, pushAt: 0, pullSeq: 0, initial: first });
  try { localStorage.setItem(SYNC_EVER, '1'); } catch { /* 무시 */ }
  await syncNow();
}

/** 끄기: 이 기기 기록은 그대로 두고 서버와 연결만 끊음 (끈 동안 지운 것은 묘비로 남겨 다시 켤 때 알림) */
export function disableSync() {
  saveConfig(null);
  setStatus({ state: 'off', error: undefined });
}

/** 백업에서 되돌린 뒤(동기화 중): 서버 것을 처음부터 다시 받아 합침 (되돌린 줄은 지금 시각이라 이김) */
export function afterRestore() {
  const c = loadConfig();
  if (c) { c.pullSeq = 0; saveConfig(c); }
}
