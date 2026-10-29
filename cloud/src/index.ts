/**
 * 바이올린 연습 도우미 — 기기 간 동기화 서버 (Cloudflare Worker + D1)
 *
 * 저장하는 것: 앱 기록 한 줄씩(rec) + 큰 글자 덩어리(악보 XML 등, blob — 내용 해시로 찾음, gzip+base64)
 * 인증: Authorization: Bearer <동기화 열쇠>  (wrangler secret put SYNC_KEY)
 *
 * API
 *  GET  /ping                     → { ok, seq }
 *  POST /push   { changes: [{ t, k, u, d, v }] }   t 표 이름, k 열쇠, u 바꾼 시각(ms), d 지움(1), v 내용(JSON 글자)
 *               → { ok, applied }   (같은 열쇠는 u 가 더 새롭거나, 같은 u 인데 내용이 다를 때만 바꿈 — 메아리는 무시, 같은 u 면 지움이 살아 있는 것을 이기지 못함)
 *  GET  /pull?since=N&limit=M     → { rows: [{ s, t, k, u, d, v }], cursor, more }   (v 는 JSON 값 그대로)
 *  POST /blobs/missing { hashes } → { missing: [...] }
 *  PUT  /blob/<hash>  (본문: gzip+base64 글자, 2MB 넘으면 ?part=i&parts=n 로 나눠서)
 *  GET  /blob/<hash>              → 본문 (나눴으면 이어 붙여서)
 */

// ---- 최소 타입 (workers-types 없이) ----
export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean }
export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Like { prepare(sql: string): D1Stmt; batch(stmts: D1Stmt[]): Promise<unknown[]>; exec?(sql: string): Promise<unknown> }
export interface Env { DB: D1Like; SYNC_KEY: string; ALLOWED_ORIGINS?: string }

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rec (t TEXT NOT NULL, k TEXT NOT NULL, s INTEGER NOT NULL, u INTEGER NOT NULL, d INTEGER NOT NULL DEFAULT 0, v TEXT, PRIMARY KEY (t, k))`,
  `CREATE INDEX IF NOT EXISTS rec_s ON rec (s)`,
  `CREATE TABLE IF NOT EXISTS blob (h TEXT NOT NULL, i INTEGER NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (h, i))`,
];

const MAX_PUSH = 200; // 한 번에 받는 기록 수
const PAGE_BYTES = 500_000; // 한 번에 내려보내는 대략 크기 (무료 플랜 CPU 시간 안에)
const MAX_PART = 1_900_000; // D1 한 칸 최대 (2MB) 아래로

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://htcho-max.github.io').split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

let schemaReady = false;
async function ensureSchema(env: Env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}
/** 테스트용: 스키마 다시 확인하게 */
export function resetSchemaFlag() { schemaReady = false; }

interface Change { t: string; k: string; u: number; d?: number; v?: string | null }
const TBL = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;
const HASH = /^[0-9a-f]{64}$/;

export async function handle(req: Request, env: Env): Promise<Response> {
  const h = cors(req, env);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (!env.SYNC_KEY || env.SYNC_KEY.length < 16) return json({ error: '서버에 동기화 열쇠(SYNC_KEY)가 없어요.' }, 500);
  const auth = req.headers.get('Authorization') ?? '';
  if (!same(auth, `Bearer ${env.SYNC_KEY}`)) return json({ error: '동기화 열쇠가 맞지 않아요.' }, 401);
  await ensureSchema(env);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (path === '/ping' && req.method === 'GET') {
      const r = await env.DB.prepare('SELECT COALESCE(MAX(s), 0) AS s FROM rec').first<{ s: number }>();
      return json({ ok: true, seq: r?.s ?? 0 });
    }
    if (path === '/push' && req.method === 'POST') {
      const body = (await req.json()) as { changes?: Change[] };
      const ch = body.changes ?? [];
      if (!Array.isArray(ch) || ch.length > MAX_PUSH) return json({ error: `한 번에 ${MAX_PUSH}개까지예요.` }, 400);
      for (const c of ch) {
        if (!c || typeof c.t !== 'string' || !TBL.test(c.t) || typeof c.k !== 'string' || c.k.length > 300 || !Number.isFinite(c.u)) return json({ error: '잘못된 기록' }, 400);
        if (!c.d && typeof c.v !== 'string') return json({ error: '내용 없는 기록' }, 400);
        if (!c.d) { try { JSON.parse(c.v!); } catch { return json({ error: '내용이 JSON 이 아니에요' }, 400); } }
      }
      if (ch.length) {
        const sql = `INSERT INTO rec (t, k, s, u, d, v) VALUES (?1, ?2, (SELECT COALESCE(MAX(s), 0) + 1 FROM rec), ?3, ?4, ?5)
          ON CONFLICT (t, k) DO UPDATE SET s = excluded.s, u = excluded.u, d = excluded.d, v = excluded.v
          WHERE excluded.u > rec.u OR (excluded.u = rec.u AND excluded.d <= rec.d AND (excluded.d != rec.d OR excluded.v IS NOT rec.v))`;
        await env.DB.batch(ch.map((c) => env.DB.prepare(sql).bind(c.t, c.k, Math.round(c.u), c.d ? 1 : 0, c.d ? null : c.v)));
      }
      return json({ ok: true, applied: ch.length });
    }
    if (path === '/pull' && req.method === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 300));
      const r = await env.DB.prepare('SELECT s, t, k, u, d, v FROM rec WHERE s > ?1 ORDER BY s LIMIT ?2').bind(since, limit + 1).all<{ s: number; t: string; k: string; u: number; d: number; v: string | null }>();
      const rows: typeof r.results = [];
      let bytes = 0;
      for (const row of r.results.slice(0, limit)) {
        const len = (row.v?.length ?? 0) + 80;
        if (rows.length && bytes + len > PAGE_BYTES) break;
        rows.push(row); bytes += len;
      }
      const more = rows.length < r.results.length;
      // v 는 이미 JSON 글자 → 다시 감싸지 않고 그대로 이어 붙임 (CPU 절약)
      const body = `{"rows":[${rows.map((x) => `{"s":${x.s},"t":${JSON.stringify(x.t)},"k":${JSON.stringify(x.k)},"u":${x.u},"d":${x.d},"v":${x.v ?? 'null'}}`).join(',')}],"cursor":${rows.length ? rows[rows.length - 1].s : since},"more":${more}}`;
      return new Response(body, { headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (path === '/blobs/missing' && req.method === 'POST') {
      const body = (await req.json()) as { hashes?: string[] };
      const hs = [...new Set((body.hashes ?? []).filter((x) => HASH.test(x)))].slice(0, 500);
      const have = new Set<string>();
      for (let i = 0; i < hs.length; i += 90) {
        const part = hs.slice(i, i + 90);
        const r = await env.DB.prepare(`SELECT h, n, COUNT(*) AS c FROM blob WHERE h IN (${part.map((_, j) => `?${j + 1}`).join(',')}) GROUP BY h`).bind(...part).all<{ h: string; n: number; c: number }>();
        for (const x of r.results) if (x.c === x.n) have.add(x.h);
      }
      return json({ missing: hs.filter((x) => !have.has(x)) });
    }
    const m = /^\/blob\/([0-9a-f]{64})$/.exec(path);
    if (m && req.method === 'PUT') {
      const i = Number(url.searchParams.get('part') ?? 0), n = Number(url.searchParams.get('parts') ?? 1);
      if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 50 || i < 0 || i >= n) return json({ error: '잘못된 조각' }, 400);
      const data = await req.text();
      if (!data || data.length > MAX_PART) return json({ error: '조각이 너무 커요.' }, 413);
      // 예전에 다른 조각 수로 올리다 만 것은 지움
      await env.DB.batch([
        env.DB.prepare('DELETE FROM blob WHERE h = ?1 AND n != ?2').bind(m[1], n),
        env.DB.prepare('INSERT OR REPLACE INTO blob (h, i, n, data) VALUES (?1, ?2, ?3, ?4)').bind(m[1], i, n, data),
      ]);
      return json({ ok: true });
    }
    if (m && req.method === 'GET') {
      const r = await env.DB.prepare('SELECT i, n, data FROM blob WHERE h = ?1 ORDER BY i').bind(m[1]).all<{ i: number; n: number; data: string }>();
      if (!r.results.length || r.results.length !== r.results[0].n) return json({ error: '없어요' }, 404);
      return new Response(r.results.map((x) => x.data).join(''), { headers: { ...h, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
    return json({ error: '없는 주소' }, 404);
  } catch (e) {
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
}

export default { fetch: handle };
