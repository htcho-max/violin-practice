import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type ScoreFile } from './db';

/** 내 악보 폴더 (kv 'score-folders' 에 순서대로 저장) */
export interface Folder { id: string; name: string }
const KEY = 'score-folders';
export const DEFAULT_FOLDERS: Folder[] = [
  { id: 'suzuki-4', name: '스즈키 4권' },
  { id: 'suzuki-3', name: '스즈키 3권' },
  { id: 'other', name: '기타 곡' },
];
const BOOK4_WORDS = ['자이츠', 'seitz', '비발디', 'vivaldi', '두 대의', 'double', '뵘', 'bohm', 'böhm'];

/** 연결된 곡의 권수, 없으면 제목으로 짐작 */
export function guessFolder(title: string, book?: number, titlesByBook?: Map<number, string[]>): string {
  if (book) return `suzuki-${book}`;
  const t = title.toLowerCase();
  if (BOOK4_WORDS.some((w) => t.includes(w))) return 'suzuki-4';
  if (titlesByBook) for (const [b, ts] of titlesByBook) if (ts.some((x) => x.length > 3 && t.includes(x.toLowerCase()))) return `suzuki-${b}`;
  return 'other';
}

async function read(): Promise<Folder[] | null> {
  const r = await db.kv.get(KEY);
  return (r?.value as Folder[] | undefined) ?? null;
}
async function write(fs: Folder[]) { await db.kv.put({ key: KEY, value: fs }); }

let ensured: Promise<void> | null = null;
/** 처음 한 번: 기본 폴더를 만들고, 이미 있던 악보를 나눠 넣음 */
export function ensureFolders(): Promise<void> {
  if (!ensured) {
    ensured = db.transaction('rw', db.kv, db.scores, db.pieces, async () => {
      if (await read()) return;
      const folders = [...DEFAULT_FOLDERS];
      const pieces = await db.pieces.toArray();
      const byId = new Map(pieces.map((p) => [p.id, p]));
      const titles = new Map<number, string[]>();
      pieces.forEach((p) => titles.set(p.book, [...(titles.get(p.book) ?? []), p.title]));
      const scores = await db.scores.toArray();
      for (const s of scores) {
        if (s.exercise || s.folder) continue;
        const f = guessFolder(s.title, s.pieceId ? byId.get(s.pieceId)?.book : undefined, titles);
        if (!folders.some((x) => x.id === f)) folders.push({ id: f, name: `스즈키 ${f.split('-')[1]}권` });
        await db.scores.update(s.id!, { folder: f });
      }
      await write(folders);
    }).catch(() => {});
  }
  return ensured;
}

export function useFolders(): Folder[] {
  const [fs, setFs] = useState<Folder[]>([]);
  useEffect(() => {
    ensureFolders();
    const sub = liveQuery(() => db.kv.get(KEY)).subscribe({ next: (r) => setFs((r?.value as Folder[]) ?? []), error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return fs;
}

/** 권수 폴더가 없으면 만들어서 id 를 돌려줌 */
export async function folderForBook(book: number): Promise<string> {
  const id = `suzuki-${book}`;
  const fs = (await read()) ?? [...DEFAULT_FOLDERS];
  if (!fs.some((f) => f.id === id)) await write([...fs, { id, name: `스즈키 ${book}권` }]);
  return id;
}
export async function addFolder(name: string): Promise<string> {
  const fs = (await read()) ?? [...DEFAULT_FOLDERS];
  const id = `f-${Date.now().toString(36)}`;
  await write([...fs, { id, name: name.trim() }]);
  return id;
}
export async function renameFolder(id: string, name: string) {
  const fs = (await read()) ?? [];
  await write(fs.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)));
}
/** 폴더를 지우면 안의 악보는 "분류 안 됨"으로 */
export async function deleteFolder(id: string) {
  await db.transaction('rw', db.kv, db.scores, async () => {
    const fs = (await read()) ?? [];
    await write(fs.filter((f) => f.id !== id));
    await db.scores.filter((s) => s.folder === id).modify((s: ScoreFile) => { delete s.folder; });
  });
}
export async function moveFolder(id: string, dir: -1 | 1) {
  const fs = (await read()) ?? [];
  const i = fs.findIndex((f) => f.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= fs.length) return;
  [fs[i], fs[j]] = [fs[j], fs[i]];
  await write(fs);
}
export const moveScore = (scoreId: number, folder: string | undefined) => db.scores.update(scoreId, { folder });
