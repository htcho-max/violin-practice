/** 동기화 테스트: 따로 된 "기기"(IndexedDB·localStorage·모듈) + 가짜 서버(진짜 Worker 코드 + sqlite) */
import { vi } from 'vitest';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { handle, resetSchemaFlag, type Env } from '../../cloud/src/index';
import { fakeD1 } from './fakeD1';

export class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const g = globalThis as unknown as { localStorage: MemStorage; fetch: typeof fetch };

export type Dev = Awaited<ReturnType<typeof device>>;
export async function device() {
  const ls = new MemStorage();
  g.localStorage = ls;
  (Dexie.dependencies as { indexedDB: unknown; IDBKeyRange: unknown }).indexedDB = new IDBFactory();
  (Dexie.dependencies as { indexedDB: unknown; IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;
  vi.resetModules();
  const dbm = await import('../../src/data/db');
  const eng = await import('../../src/sync/engine');
  const sev = await import('../../src/data/sevcik');
  const bk = await import('../../src/data/backup');
  await dbm.db.open();
  return { ls, db: dbm.db, eng, sev, bk };
}
/** 이 기기로 바꿔서 하기 */
export async function on<T>(d: Dev, fn: () => Promise<T>): Promise<T> { g.localStorage = d.ls; return fn(); }

export const URL_ = 'https://sync.example';
export const KEY = 'test-key-1234567890abcdef';
export async function server(): Promise<Env> {
  resetSchemaFlag();
  const env: Env = { DB: await fakeD1(), SYNC_KEY: KEY };
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(String(input), init), env)) as typeof fetch;
  return env;
}
export const maxSeq = async (env: Env) => (await env.DB.prepare('SELECT COALESCE(MAX(s),0) AS s FROM rec').first<{ s: number }>())!.s;
export const xml = (t: string) => `<?xml version="1.0"?><score-partwise><work><work-title>${t}</work-title></work>${'<measure/>'.repeat(200)}</score-partwise>`;

