import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type SevcikPack } from '../data/db';
import { importPack, deletePack, groupsOf, variantScore, packProgress, setStartPos, lastVariant, rememberVariant, sortPacks, packLabel, SIXTH_KEY, type VariantProgress } from '../data/sevcik';
import { createOSMD, setDrawRange, showParts } from '../score/osmd';
import { parseMusicXML } from '../score/parse';

/** 세브치크: 원형(팩) 고르기 → 변형 번호 고르기 → 본보기 미리 보기 → 악보 화면으로 */
export default function Sevcik({ onOpen, onBack }: { onOpen: (scoreId: number) => void; onBack: () => void }) {
  const [packs, setPacks] = useState<SevcikPack[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.sevcikPacks.toArray()).subscribe({ next: (ps) => setPacks(sortPacks(ps)), error: () => setPacks([]) });
    return () => sub.unsubscribe();
  }, []);
  const [packId, setPackId] = useState<string | null>(() => { try { return localStorage.getItem('violin-sevcik-pack'); } catch { return null; } });
  const pack = packs?.find((p) => p.id === packId) ?? packs?.[0] ?? null;
  useEffect(() => { if (pack) try { localStorage.setItem('violin-sevcik-pack', pack.id); } catch { /* 무시 */ } }, [pack]);
  const [n, setN] = useState<number>(0);
  useEffect(() => { if (pack) setN(lastVariant(pack.id) ?? 1); }, [pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [progress, setProgress] = useState<Record<number, VariantProgress>>({});
  useEffect(() => { if (pack) packProgress(pack.id).then(setProgress).catch(() => {}); }, [pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sixth, setSixthS] = useState(() => { try { return localStorage.getItem(SIXTH_KEY) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => (pack ? groupsOf(pack) : []), [pack]);
  const nums = useMemo(() => pack?.variants.map((v) => v.n) ?? [], [pack]);
  const cur = pack?.variants.find((v) => v.n === n);
  const maxN = nums.length ? nums[nums.length - 1] : 0;

  async function load(fs: File[]) {
    setError(null); setMsg(null); setBusy(true);
    const okList: { title: string; count: number }[] = [], bad: string[] = [];
    let lastId: string | null = null;
    for (const f of fs) {
      try { const p = await importPack(f); okList.push({ title: p.title, count: p.variants.length }); lastId = p.id; } catch { bad.push(f.name); }
    }
    if (lastId) setPackId(lastId);
    if (okList.length) setMsg(okList.length === 1 ? `"${okList[0].title}" 변형 ${okList[0].count}개를 불러왔어요.` : `원형 ${okList.length}개를 불러왔어요: ${okList.map((o) => `${o.title} (변형 ${o.count}개)`).join(', ')}`);
    if (bad.length) setError(`세브치크 파일이 아니에요: ${bad.join(', ')}`);
    setBusy(false); if (file.current) file.current.value = '';
  }
  const pos = pack ? (pack.fixedPos ?? (sixth && pack.altPos ? pack.altPos : null)) : null;
  async function open(num: number) {
    if (!pack) return;
    setError(null); setBusy(true);
    try {
      const id = await variantScore(pack.id, num);
      // 높은 포지션: 첫 음에 "여기부터 N포지션" + 포지션 추천 켜기
      const s = await db.scores.get(id);
      const first = s ? parseMusicXML(s.xml).notes[0] : undefined;
      const managed = [pack.fixedPos, pack.altPos].filter((x): x is number => !!x);
      if (first && managed.length) await setStartPos(id, pos, `${first.measure}:${first.index}`, managed);
      if (pos && pos > 1) try { localStorage.setItem('violin-pos-on', '1'); if (Number(localStorage.getItem('violin-pos-max') || 3) < 7) localStorage.setItem('violin-pos-max', '7'); } catch { /* 무시 */ }
      rememberVariant(pack.id, num);
      onOpen(id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const go = (d: number) => { const i = nums.indexOf(n); const j = Math.max(0, Math.min(nums.length - 1, i + d)); if (nums[j] !== undefined) setN(nums[j]); };

  return (
    <section className="page score sevcik">
      <div className="card-head">
        <button className="mini" onClick={onBack}>◀ 목록</button>
        <b className="score-title">세브치크</b>
      </div>

      {packs && packs.length === 0 && (
        <div className="card">
          <p className="hint">세브치크 교재는 저작권 때문에 앱에 들어 있지 않아요. PC 악보 폴더의 세브치크 파일(<b>.sevcik.gz</b>)을 한 번 불러오면 이 기기에만 저장돼요.</p>
        </div>
      )}
      {packs && packs.length > 1 && (
        <div className="chips">
          {packs.map((p) => <button key={p.id} className={`chip ${pack?.id === p.id ? 'on' : ''}`} onClick={() => setPackId(p.id)} title={p.subtitle} data-testid="sev-pack">{packLabel(p)}</button>)}
        </div>
      )}

      {pack && (
        <>
          <div className="card">
            <b>{pack.title}</b>
            {pack.subtitle && <p className="small">{pack.subtitle}</p>}
            {pack.note && <p className="hint small">{pack.note}</p>}
            <div className="session-controls">
              <button className="secondary" onClick={() => open(0)} disabled={busy} data-testid="sev-theme">원형(주제) 악보</button>
              <span className="muted small">연습한 변형 {Object.keys(progress).length}/{pack.variants.length}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <b>변형</b>
              <div className="sev-pick">
                <button className="mini" onClick={() => go(-1)} disabled={nums.indexOf(n) <= 0} aria-label="이전 변형">◀</button>
                <input type="number" inputMode="numeric" min={1} max={maxN} value={n || ''} onChange={(e) => setN(Number(e.target.value))} aria-label="변형 번호" data-testid="sev-num" />
                <button className="mini" onClick={() => go(1)} disabled={nums.indexOf(n) >= nums.length - 1} aria-label="다음 변형">▶</button>
              </div>
            </div>
            {cur ? (
              <>
                <p className="small"><b>{cur.n}번</b>{cur.label ? ` · ${cur.label}` : ''}{cur.bpm ? ` · ♩=${cur.bpm}` : ''}{progress[cur.n] ? ` · 최고 ${progress[cur.n].best}% (${progress[cur.n].tries}번)` : ''}</p>
                <Preview packId={pack.id} n={cur.n} k={cur.k} />
                {pack.fixedPos ? <p className="hint small">제{pack.fixedPos}포지션 연습이에요. 열면 포지션 추천이 {pack.fixedPos}포지션 운지를 보여 줘요.</p>
                  : pack.altPos ? <label className="small"><input type="checkbox" checked={sixth} onChange={(e) => { setSixthS(e.target.checked); try { localStorage.setItem(SIXTH_KEY, e.target.checked ? '1' : '0'); } catch { /* 무시 */ } }} data-testid="sev-sixth" /> {pack.altPos}포지션으로 (포지션 추천이 {pack.altPos}포지션 운지를 보여 줘요)</label> : null}
                <button className="primary wide" onClick={() => open(cur.n)} disabled={busy} data-testid="sev-open">이 변형으로 연습 (주제 전체에 적용)</button>
              </>
            ) : <p className="muted small">{n ? `${n}번 변형이 없어요.` : '번호를 고르세요.'}</p>}
          </div>

          <div className="card">
            {groups.map((g) => (
              <div key={`${g.from}`} className="sev-group">
                <div className="folder-title">{g.label || '변형'} <span className="muted small">{g.from}~{g.to}</span></div>
                <div className="sev-grid">
                  {nums.filter((x) => x >= g.from && x <= g.to).map((x) => {
                    const pr = progress[x];
                    return (
                      <button key={x} className={`sev-cell ${x === n ? 'on' : ''} ${pr ? (pr.best >= 90 ? 'good' : 'tried') : ''}`} onClick={() => setN(x)} title={pr ? `최고 ${pr.best}%` : undefined} data-testid="sev-cell">{x}</button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="hint small">초록 = 맞은 음 90% 넘게 친 변형, 노랑 = 연습한 변형</p>
          </div>
        </>
      )}

      <div className="card">
        <input ref={file} type="file" accept=".gz,.json,.sevcik,application/gzip,application/json" multiple onChange={(e) => e.target.files?.length && load(Array.from(e.target.files))} data-testid="sev-file" hidden />
        <button className="secondary wide" onClick={() => file.current?.click()} disabled={busy}>{pack ? '세브치크 파일 다시/더 불러오기' : '세브치크 파일 불러오기'}</button>
        <p className="hint small">여러 파일(No.4~12)을 한꺼번에 골라도 돼요.</p>
        {msg && <p className="ok-text small" data-testid="sev-msg">{msg}</p>}
        {error && <p className="error">{error}</p>}
        {pack && <button className="mini danger" onClick={() => { if (confirm(`"${pack.title}" 파일을 이 기기에서 지울까요? 이미 연습한 변형 악보와 기록은 남아요.`)) void deletePack(pack.id); }}>이 원형 지우기</button>}
      </div>
    </section>
  );
}

/** 변형 본보기 (첫 k 마디, 내 파트만) */
function Preview({ packId, n, k }: { packId: string; n: number; k: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const row = await db.sevcikXml.get(`${packId}:${n}`);
        if (!row || !holder.current || !alive) return;
        holder.current.innerHTML = '';
        const o = await createOSMD(holder.current);
        await o.load(row.xml);
        if (!alive) return;
        setDrawRange(o, 1, Math.max(1, Math.min(4, k)));
        o.zoom = 0.8;
        showParts(o, 0, false);
        o.render();
        setErr(false);
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [packId, n, k]);
  return <div className="sev-preview" data-testid="sev-preview">{err ? <p className="muted small">미리 보기를 그리지 못했어요.</p> : null}<div ref={holder} /></div>;
}
