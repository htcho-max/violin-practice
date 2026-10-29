import { describe, expect, it, beforeEach } from 'vitest';
import { handle, resetSchemaFlag, type Env } from '../cloud/src/index';
import { fakeD1, hasSqlite } from './helpers/fakeD1';

const KEY = 'test-key-1234567890abcdef';
let env: Env;
const req = (path: string, init: RequestInit = {}, key = KEY) => handle(new Request('https://s.example' + path, { ...init, headers: { Authorization: `Bearer ${key}`, Origin: 'https://htcho-max.github.io', ...(init.headers ?? {}) } }), env);
const post = (path: string, body: unknown) => req(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => { resetSchemaFlag(); env = { DB: await fakeD1(), SYNC_KEY: KEY }; });

const sqliteOk = await hasSqlite();

describe.skipIf(!sqliteOk)('동기화 서버', () => {
  it('열쇠가 틀리면 401, OPTIONS 는 CORS', async () => {
    expect((await req('/ping', {}, 'wrong-key-1234567890')).status).toBe(401);
    const o = await handle(new Request('https://s.example/push', { method: 'OPTIONS', headers: { Origin: 'https://htcho-max.github.io' } }), env);
    expect(o.status).toBe(204);
    expect(o.headers.get('Access-Control-Allow-Origin')).toBe('https://htcho-max.github.io');
    expect(o.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    const r = await req('/ping');
    expect(await r.json()).toEqual({ ok: true, seq: 0 });
  });

  it('push → pull, 나중 것이 이김, 같은 내용은 순번을 올리지 않음', async () => {
    await post('/push', { changes: [{ t: 'scores', k: '1', u: 10, v: '{"a":1}' }, { t: 'kv', k: 'settings', u: 5, v: '{"x":1}' }] });
    let p = await (await req('/pull?since=0')).json();
    expect(p.rows.map((r: { k: string }) => r.k)).toEqual(['1', 'settings']);
    expect(p.cursor).toBe(2);
    // 옛 것은 무시
    await post('/push', { changes: [{ t: 'scores', k: '1', u: 9, v: '{"a":0}' }] });
    // 같은 시각·같은 내용(메아리)은 그대로
    await post('/push', { changes: [{ t: 'kv', k: 'settings', u: 5, v: '{"x":1}' }] });
    p = await (await req('/pull?since=2')).json();
    expect(p.rows).toEqual([]);
    // 새 것은 바꾸고 순번이 올라감
    await post('/push', { changes: [{ t: 'scores', k: '1', u: 11, v: '{"a":2}' }, { t: 'scores', k: '2', u: 3, d: 1 }] });
    p = await (await req('/pull?since=2')).json();
    expect(p.rows.map((r: { k: string; v: unknown; d: number }) => [r.k, r.v, r.d])).toEqual([['1', { a: 2 }, 0], ['2', null, 1]]);
  });

  it('같은 시각이면 지움이 살아 있는 줄을 이기지 못함', async () => {
    await post('/push', { changes: [{ t: 'pieces', k: 'p1', u: 50, v: '{"s":1}' }] });
    await post('/push', { changes: [{ t: 'pieces', k: 'p1', u: 50, d: 1 }] });
    let p = await (await req('/pull?since=0')).json();
    expect(p.rows[0]).toMatchObject({ k: 'p1', d: 0, v: { s: 1 } });
    await post('/push', { changes: [{ t: 'pieces', k: 'p1', u: 51, d: 1 }] });
    p = await (await req('/pull?since=0')).json();
    expect(p.rows[0]).toMatchObject({ k: 'p1', d: 1, v: null });
  });

  it('pull 은 나눠서 (more)', async () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({ t: 'scoreRuns', k: String(i), u: 1, v: JSON.stringify({ i }) }));
    await post('/push', { changes });
    const a = await (await req('/pull?since=0&limit=20')).json();
    expect(a.rows.length).toBe(20); expect(a.more).toBe(true);
    const b = await (await req(`/pull?since=${a.cursor}&limit=20`)).json();
    expect(b.rows.length).toBe(10); expect(b.more).toBe(false);
  });

  it('잘못된 기록은 400', async () => {
    expect((await post('/push', { changes: [{ t: 'bad table', k: '1', u: 1, v: '{}' }] })).status).toBe(400);
    expect((await post('/push', { changes: [{ t: 'kv', k: '1', u: 1 }] })).status).toBe(400);
    expect((await post('/push', { changes: [{ t: 'kv', k: '1', u: 1, v: '{broken' }] })).status).toBe(400);
  });

  it('blob: 조각으로 올리고 이어 받기, 없는 것 찾기', async () => {
    const h = 'a'.repeat(64), h2 = 'b'.repeat(64);
    expect((await (await post('/blobs/missing', { hashes: [h, h2] })).json()).missing).toEqual([h, h2]);
    await req(`/blob/${h}?part=0&parts=2`, { method: 'PUT', body: 'z:AAA' });
    expect((await (await post('/blobs/missing', { hashes: [h] })).json()).missing).toEqual([h]); // 반만 올림
    expect((await req(`/blob/${h}`)).status).toBe(404);
    await req(`/blob/${h}?part=1&parts=2`, { method: 'PUT', body: 'BBB' });
    expect((await (await post('/blobs/missing', { hashes: [h, h2] })).json()).missing).toEqual([h2]);
    expect(await (await req(`/blob/${h}`)).text()).toBe('z:AAABBB');
    // 조각 수를 바꿔 다시 올리다 말면: 없는 것으로 (옛 조각과 섞이지 않음)
    await req(`/blob/${h}?part=0&parts=3`, { method: 'PUT', body: 'z:X' });
    expect((await (await post('/blobs/missing', { hashes: [h] })).json()).missing).toEqual([h]);
    await req(`/blob/${h}?part=1&parts=3`, { method: 'PUT', body: 'Y' });
    await req(`/blob/${h}?part=2&parts=3`, { method: 'PUT', body: 'Z' });
    expect(await (await req(`/blob/${h}`)).text()).toBe('z:XYZ');
  });
});
