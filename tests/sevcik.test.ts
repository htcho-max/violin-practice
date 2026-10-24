import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import XML from '../scripts/test-score.musicxml?raw';
import { db } from '../src/data/db';
import { importPack, parsePack, readPackText, groupsOf, variantScore, scoreMap, packProgress, setSixth, setStartPos, sortPacks, packLabel, PACK_KIND } from '../src/data/sevcik';

// 책 내용이 아닌 시험용 팩 (시험 악보로)
const pack = {
  kind: PACK_KIND, version: 1, id: 'test-pack', title: '시험 원형', theme: XML,
  variants: [
    { n: 1, label: '온활', k: 1, bpm: 88, xml: XML.replace('</score-partwise>', '<!-- v1 --></score-partwise>') },
    { n: 2, label: '온활', k: 2, bpm: 60, xml: XML },
    { n: 3, label: '반활', k: 1, xml: XML },
  ],
};
async function gz(text: string): Promise<Blob> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(s).blob();
}

describe('세브치크 팩', () => {
  it('JSON 과 gzip 모두 읽음, 아닌 파일은 거절', async () => {
    const t = JSON.stringify(pack);
    expect(await readPackText(new Blob([t]))).toBe(t);
    expect(await readPackText(await gz(t))).toBe(t);
    expect(() => parsePack('{"a":1}')).toThrow();
    expect(() => parsePack('not json')).toThrow();
  });
  it('불러오기 → 무리 → 변형 악보는 한 번만 만들고 목록에서 숨김', async () => {
    const meta = await importPack(await gz(JSON.stringify(pack)));
    expect(meta.variants.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(groupsOf(meta)).toEqual([{ label: '온활', from: 1, to: 2 }, { label: '반활', from: 3, to: 3 }]);
    const id = await variantScore('test-pack', 1);
    expect(await variantScore('test-pack', 1)).toBe(id);
    const s = await db.scores.get(id);
    expect(s?.sevcik).toEqual({ pack: 'test-pack', n: 1 });
    expect(s?.title).toBe('시험 원형 · 변형 1 (온활)');
    expect(s?.listKey?.[4]).toBe(2);
    expect(s?.xml).toContain('v1');
    const theme = await variantScore('test-pack', 0);
    expect((await db.scores.get(theme))?.title).toBe('시험 원형 · 주제');
    expect(await scoreMap('test-pack')).toEqual({ 1: id, 0: theme });
    await expect(variantScore('test-pack', 9)).rejects.toThrow();
  });
  it('연습 기록 → 변형별 최고 %, 6포지션 표시 넣고 빼기', async () => {
    const id = await variantScore('test-pack', 2);
    await db.scoreRuns.bulkAdd([
      { createdAt: 1, date: '2026-10-24', scoreId: id, title: 't', from: 1, to: 1, durationSec: 5, total: 10, ok: 7, wrong: 2, missed: 1, meanAbs: 8, inSession: false },
      { createdAt: 2, date: '2026-10-24', scoreId: id, title: 't', from: 1, to: 1, durationSec: 5, total: 10, ok: 9, wrong: 1, missed: 0, meanAbs: 8, inSession: false },
    ] as never);
    const pr = await packProgress('test-pack');
    expect(pr[2]).toMatchObject({ best: 90, tries: 2 });
    await setSixth(id, true, '1:0');
    expect((await db.scores.get(id))?.marks?.['1:0']?.pos).toBe(6);
    await setSixth(id, false, '1:0');
    expect((await db.scores.get(id))?.marks?.['1:0']).toBeUndefined();
  });
  it('다시 불러오면 만든 변형 악보도 새 내용으로', async () => {
    const id = await variantScore('test-pack', 1);
    await importPack(new Blob([JSON.stringify({ ...pack, variants: [{ ...pack.variants[0], xml: XML.replace('</score-partwise>', '<!-- v1b --></score-partwise>') }] })]));
    expect((await db.scores.get(id))?.xml).toContain('v1b');
  });
  it('포지션 표시: 앱이 넣은 값만 바꾸고, 원형은 번호 차례', async () => {
    const id = await variantScore('test-pack', 1);
    await setStartPos(id, 7, '1:0', [6, 7]);
    expect((await db.scores.get(id))?.marks?.['1:0']?.pos).toBe(7);
    await setStartPos(id, null, '1:0', [6, 7]);
    expect((await db.scores.get(id))?.marks?.['1:0']).toBeUndefined();
    await db.scores.update(id, { marks: { '1:0': { pos: 3 } } });
    await setStartPos(id, null, '1:0', [6, 7]);
    expect((await db.scores.get(id))?.marks?.['1:0']?.pos).toBe(3); // 내가 넣은 3포지션은 그대로
    const ps = sortPacks([{ id: 'b', title: 'B', order: 10, createdAt: 0, variants: [] }, { id: 'a', title: 'A', order: 4, createdAt: 0, variants: [] }]);
    expect(ps.map((p) => p.id)).toEqual(['a', 'b']);
    expect(packLabel(ps[0])).toBe('No.4');
    const m = await importPack(new Blob([JSON.stringify({ ...pack, id: 'p8', order: 8, fixedPos: 6 })]));
    expect(m).toMatchObject({ order: 8, fixedPos: 6, altPos: null });
  });
});
