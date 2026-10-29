/** 동기화 서버와 주고받기 + 큰 글자(악보 XML) 덩어리를 gzip+base64 로 */

export interface Remote { url: string; key: string }
export interface PullRow { s: number; t: string; k: string; u: number; d: number; v: Record<string, unknown> | null }
export interface Change { t: string; k: string; u: number; d?: number; v?: string | null }

export class SyncError extends Error {
  constructor(msg: string, public status = 0) { super(msg); }
}

const base = (r: Remote) => r.url.trim().replace(/\/+$/, '');

async function call(r: Remote, path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(base(r) + path, { ...init, signal: ac.signal, headers: { Authorization: `Bearer ${r.key.trim()}`, ...(init.headers ?? {}) } });
    if (!res.ok) {
      let msg = `서버 응답 ${res.status}`;
      try { const j = await res.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* 무시 */ }
      throw new SyncError(msg, res.status);
    }
    return res;
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError(ac.signal.aborted ? '서버가 응답하지 않아요 (시간 초과).' : '서버에 연결하지 못했어요. 인터넷 연결이나 서버 주소를 확인해 주세요.');
  } finally { clearTimeout(timer); }
}
const jsonBody = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });

export async function ping(r: Remote): Promise<{ seq: number }> {
  return (await call(r, '/ping', {}, 15000)).json();
}
export async function push(r: Remote, changes: Change[]): Promise<void> {
  await call(r, '/push', jsonBody({ changes }));
}
export async function pull(r: Remote, since: number, limit = 300): Promise<{ rows: PullRow[]; cursor: number; more: boolean }> {
  return (await call(r, `/pull?since=${since}&limit=${limit}`)).json();
}
export async function missingBlobs(r: Remote, hashes: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < hashes.length; i += 400) {
    const j = await (await call(r, '/blobs/missing', jsonBody({ hashes: hashes.slice(i, i + 400) }))).json() as { missing: string[] };
    out.push(...j.missing);
  }
  return out;
}
const PART = 1_500_000;
export async function putBlob(r: Remote, hash: string, text: string): Promise<void> {
  const enc = await packText(text);
  const n = Math.max(1, Math.ceil(enc.length / PART));
  for (let i = 0; i < n; i++) {
    await call(r, `/blob/${hash}?part=${i}&parts=${n}`, { method: 'PUT', body: enc.slice(i * PART, (i + 1) * PART), headers: { 'Content-Type': 'text/plain; charset=utf-8' } }, 60000);
  }
}
export async function getBlob(r: Remote, hash: string): Promise<string> {
  const enc = await (await call(r, `/blob/${hash}`, {}, 60000)).text();
  const text = await unpackText(enc);
  if ((await sha256(text)) !== hash) throw new SyncError('받은 악보 내용이 깨졌어요.');
  return text;
}

// ---- 해시 · 압축 ----
export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function streamBytes(input: Uint8Array, ts: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([input]).stream().pipeThrough(ts));
  return new Uint8Array(await out.arrayBuffer());
}
function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
/** 글자 → gzip → base64 (압축을 못 하는 브라우저면 "t:" + 글자 그대로) */
export async function packText(text: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') return 't:' + text;
  return 'z:' + toB64(await streamBytes(new TextEncoder().encode(text), new CompressionStream('gzip')));
}
export async function unpackText(enc: string): Promise<string> {
  if (enc.startsWith('t:')) return enc.slice(2);
  if (!enc.startsWith('z:')) throw new SyncError('알 수 없는 형식이에요.');
  if (typeof DecompressionStream === 'undefined') throw new SyncError('이 브라우저는 압축을 풀 수 없어요.');
  return new TextDecoder().decode(await streamBytes(fromB64(enc.slice(2)), new DecompressionStream('gzip')));
}

/** 새 동기화 열쇠 (32글자) */
export function newSyncKey(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return toB64(a).replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=+$/, '');
}
