/** 테스트용: node:sqlite 위에 Cloudflare D1 비슷한 것 (prepare/bind/all/first/run/batch) */
import type { D1Like, D1Stmt } from '../../cloud/src/index';

interface SqlStmt { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): unknown }
interface SqlDb { prepare(sql: string): SqlStmt; exec(sql: string): void }

/** node:sqlite 가 있는지 (Node 22.13+) — 없으면 동기화 테스트는 건너뜀 */
export async function hasSqlite(): Promise<boolean> {
  try {
    const { createRequire } = (await import(/* @vite-ignore */ 'node:' + 'module')) as unknown as { createRequire: (u: string) => (id: string) => unknown };
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch { return false; }
}

export async function fakeD1(): Promise<D1Like & { raw: SqlDb }> {
  // vite 가 node:sqlite 를 모르므로 require 로
  const { createRequire } = (await import(/* @vite-ignore */ 'node:' + 'module')) as unknown as { createRequire: (u: string) => (id: string) => unknown };
  const mod = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string) => SqlDb };
  const raw = new mod.DatabaseSync(':memory:');
  const stmt = (sql: string, params: unknown[] = []): D1Stmt & { exec(): unknown } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...params) as T[], success: true }),
    first: async <T,>() => (raw.prepare(sql).get(...params) as T) ?? null,
    run: async () => raw.prepare(sql).run(...params),
    exec: () => raw.prepare(sql).run(...params),
  });
  return {
    raw,
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: D1Stmt[]) => {
      raw.exec('BEGIN');
      try { const out = stmts.map((s) => (s as D1Stmt & { exec(): unknown }).exec()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}
