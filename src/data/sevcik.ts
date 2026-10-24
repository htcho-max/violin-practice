/**
 * 세브치크 (원형 악보 + 변형). 책 내용은 저장소에 넣지 않고, 사용자가 PC 에서 만든 팩 파일
 * (gzip 또는 그냥 JSON: { kind: 'violin-sevcik-pack', id, title, theme, variants: [{ n, label, k, bpm, xml }] })
 * 을 한 번 불러오면 기기(IndexedDB)에만 저장한다.
 * 변형을 열면 그 변형 악보를 보통 악보(ScoreFile, sevcik 표시)로 만들어 두고 다시 씀 → 채점·기록·내 표시가 그대로.
 */
import { db, type ScoreFile, type SevcikPack } from './db';

export const PACK_KIND = 'violin-sevcik-pack';
export interface PackFile {
  kind: string; version?: number; id: string; title: string; subtitle?: string; note?: string;
  theme: string;
  variants: { n: number; label?: string; k?: number; bpm?: number | null; xml: string }[];
}

/** 파일 → 글자 (gzip 이면 풀어서) */
export async function readPackText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
    if (!DS) throw new Error('이 브라우저에서는 압축 파일을 풀 수 없어요.');
    return await new Response(file.stream().pipeThrough(new DS('gzip'))).text();
  }
  return await file.text();
}

export function parsePack(text: string): PackFile {
  let p: PackFile;
  try { p = JSON.parse(text); } catch { throw new Error('세브치크 파일이 아니에요.'); }
  if (!p || p.kind !== PACK_KIND || !p.id || !p.theme || !Array.isArray(p.variants)) throw new Error('세브치크 파일이 아니에요.');
  for (const v of p.variants) if (!Number.isInteger(v.n) || v.n < 1 || typeof v.xml !== 'string') throw new Error('세브치크 파일의 변형이 잘못됐어요.');
  return p;
}

/** 팩 넣기 (같은 id 면 바꿈 — 이미 만든 변형 악보도 새 악보로) */
export async function importPack(file: Blob): Promise<SevcikPack> {
  const p = parsePack(await readPackText(file));
  const meta: SevcikPack = {
    id: p.id, title: p.title, subtitle: p.subtitle, note: p.note, createdAt: Date.now(),
    variants: p.variants.map((v) => ({ n: v.n, label: v.label ?? '', k: v.k ?? 1, bpm: v.bpm ?? null })).sort((a, b) => a.n - b.n),
  };
  const map = await scoreMap(p.id);
  await db.transaction('rw', db.sevcikPacks, db.sevcikXml, db.scores, async () => {
    await db.sevcikXml.where('id').startsWith(`${p.id}:`).delete();
    await db.sevcikXml.bulkPut([{ id: `${p.id}:0`, xml: p.theme }, ...p.variants.map((v) => ({ id: `${p.id}:${v.n}`, xml: v.xml }))]);
    await db.sevcikPacks.put(meta);
    // 이미 만들어 둔 변형 악보는 새 내용으로 (기록·내 표시는 그대로)
    for (const [n, id] of Object.entries(map)) {
      const x = n === '0' ? p.theme : p.variants.find((v) => v.n === Number(n))?.xml;
      if (x) await db.scores.update(id, { xml: x, origXml: undefined });
    }
  });
  return meta;
}

export const listPacks = () => db.sevcikPacks.toArray();
export async function deletePack(id: string) {
  await db.transaction('rw', db.sevcikPacks, db.sevcikXml, async () => {
    await db.sevcikPacks.delete(id);
    await db.sevcikXml.where('id').startsWith(`${id}:`).delete();
  });
}

/** 변형 무리 (책 왼쪽 이름이 같은 이어진 변형들) */
export function groupsOf(p: SevcikPack): { label: string; from: number; to: number }[] {
  const out: { label: string; from: number; to: number }[] = [];
  for (const v of p.variants) {
    const g = out[out.length - 1];
    if (g && g.label === v.label && v.n === g.to + 1) g.to = v.n;
    else out.push({ label: v.label, from: v.n, to: v.n });
  }
  return out;
}

const MAP_KEY = (pack: string) => `sevcik-scores:${pack}`;
/** 팩의 변형 번호 → 만들어 둔 악보 id */
export async function scoreMap(pack: string): Promise<Record<string, number>> {
  return ((await db.kv.get(MAP_KEY(pack)))?.value as Record<string, number> | undefined) ?? {};
}

export const variantTitle = (p: Pick<SevcikPack, 'title' | 'variants'>, n: number) => {
  if (n === 0) return `${p.title} · 주제`;
  const v = p.variants.find((x) => x.n === n);
  return `${p.title} · 변형 ${n}${v?.label ? ` (${v.label})` : ''}`;
};

/** 변형(0 = 주제) 악보 id — 없으면 만들어 둠 */
export async function variantScore(packId: string, n: number): Promise<number> {
  const p = await db.sevcikPacks.get(packId);
  if (!p) throw new Error('세브치크 파일을 먼저 불러와 주세요.');
  const map = await scoreMap(packId);
  const have = map[String(n)];
  if (have !== undefined && (await db.scores.get(have))) return have;
  const row = await db.sevcikXml.get(`${packId}:${n}`);
  if (!row) throw new Error(`변형 ${n}번이 없어요.`);
  const s: ScoreFile = { title: variantTitle(p, n), xml: row.xml, createdAt: Date.now(), sevcik: { pack: packId, n } };
  const id = await db.scores.add(s);
  await db.kv.put({ key: MAP_KEY(packId), value: { ...map, [String(n)]: id } });
  return id;
}

export interface VariantProgress { best: number; tries: number; last: number }
/** 변형마다 연습 기록 (맞은 음 % 최고, 횟수, 마지막 날) */
export async function packProgress(packId: string): Promise<Record<number, VariantProgress>> {
  const map = await scoreMap(packId);
  const byScore = new Map(Object.entries(map).map(([n, id]) => [id, Number(n)]));
  if (!byScore.size) return {};
  const runs = await db.scoreRuns.where('scoreId').anyOf([...byScore.keys()]).toArray();
  const out: Record<number, VariantProgress> = {};
  for (const r of runs) {
    const n = byScore.get(r.scoreId);
    if (n === undefined || !r.total) continue;
    const pct = Math.round((r.ok / r.total) * 100);
    const o = out[n] ?? { best: 0, tries: 0, last: 0 };
    out[n] = { best: Math.max(o.best, pct), tries: o.tries + 1, last: Math.max(o.last, r.createdAt) };
  }
  return out;
}

/** 6포지션으로: 첫 음에 "여기부터 6포지션" 표시를 넣거나 뺌 (포지션 추천이 따름) */
export async function setSixth(scoreId: number, on: boolean, firstKey: string) {
  const s = await db.scores.get(scoreId);
  if (!s) return;
  const marks = { ...(s.marks ?? {}) };
  const m = { ...(marks[firstKey] ?? {}) };
  if (on) m.pos = 6; else if (m.pos === 6) delete m.pos;
  if (Object.keys(m).length) marks[firstKey] = m; else delete marks[firstKey];
  await db.scores.update(scoreId, { marks });
}

const LAST = (pack: string) => `violin-sevcik-last:${pack}`;
export function lastVariant(pack: string): number | null {
  try { const v = Number(localStorage.getItem(LAST(pack))); return Number.isFinite(v) && localStorage.getItem(LAST(pack)) !== null ? v : null; } catch { return null; }
}
export function rememberVariant(pack: string, n: number) { try { localStorage.setItem(LAST(pack), String(n)); } catch { /* 무시 */ } }
export const SIXTH_KEY = 'violin-sevcik-6th';
