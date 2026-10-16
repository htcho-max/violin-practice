import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Recording } from '../data/db';
import { recorder, trackStats } from '../audio/recorder';
import { CentsTrace } from '../components/CentsTrace';
import { usePieces } from '../state/usePieces';
import { useSettings } from '../state/settings';
import { useWakeLock } from '../state/wakeLock';
import { clock, localDate } from '../data/dates';
import { pitchTracker } from '../audio/pitchTracker';

function useRecordings(): Recording[] {
  const [rows, setRows] = useState<Recording[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.recordings.orderBy('createdAt').reverse().toArray()).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}

function Player({ rec }: { rec: Recording }) {
  const url = useMemo(() => URL.createObjectURL(rec.blob), [rec.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <audio controls src={url} preload="metadata" className="player" />;
}

function stat(rec: Recording) {
  const s = trackStats(rec.track);
  return s.meanAbs === null ? '음정 기록 없음' : `평균 ±${Math.round(s.meanAbs)}센트 · ±10센트 안 ${Math.round((s.within10 ?? 0) * 100)}%`;
}

function RecTrace({ rec, seconds }: { rec: Recording; seconds: number }) {
  const src = useMemo(() => ({ current: rec.track.map(([t, cents, midi]) => ({ t, cents, midi })) }), [rec]);
  return <CentsTrace source={src} seconds={seconds} fixed height={120} />;
}

export function Recordings() {
  const { settings } = useSettings();
  const recs = useRecordings();
  const pieces = usePieces();
  const [pieceId, setPieceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const live = useRef<{ t: number; cents: number | null; midi: number | null }[]>([]);
  useWakeLock(busy, settings.wakeLock);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      setElapsed(recorder.elapsed);
      live.current = recorder.track.slice(-200).map(([t, cents, midi]) => ({ t, cents, midi }));
    }, 200);
    return () => clearInterval(id);
  }, [busy]);
  // 화면을 떠나면 녹음 정리
  useEffect(() => () => { if (recorder.recording) recorder.stop(); }, []);

  const name = (id?: string) => pieces.find((p) => p.id === id)?.title;

  async function start() {
    setError(null);
    try { await recorder.start(settings.a4); setBusy(true); setElapsed(0); }
    catch { setError('녹음을 시작할 수 없어요. 마이크 권한을 확인해 주세요.'); if (!recorder.recording && pitchTracker.running) pitchTracker.stop(); }
  }
  async function stop() {
    const r = await recorder.stop();
    setBusy(false);
    if (r.durationSec < 1) return;
    const now = Date.now();
    await db.recordings.add({
      createdAt: now, date: localDate(), pieceId: pieceId || undefined,
      title: name(pieceId) ?? '녹음', durationSec: r.durationSec, mime: r.mime, blob: r.blob, track: r.track,
    });
    if (pieceId) await db.pieces.update(pieceId, { lastPracticed: localDate() });
  }

  const toggleCompare = (id: number) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));
  const pair = compare.map((id) => recs.find((r) => r.id === id)).filter(Boolean) as Recording[];
  const pairSec = Math.max(1, ...pair.map((r) => r.durationSec));

  return (
    <div className="page-sub">
      <div className="card">
        <b>새 녹음</b>
        <select value={pieceId} onChange={(e) => setPieceId(e.target.value)} disabled={busy} aria-label="녹음할 곡">
          <option value="">곡 선택 안 함</option>
          {pieces.filter((p) => p.status !== 'review' || p.book >= 4).map((p) => <option key={p.id} value={p.id}>{p.book}권 · {p.title}</option>)}
          {pieces.some((p) => p.status === 'review' && p.book < 4) && <optgroup label="복습 곡">
            {pieces.filter((p) => p.status === 'review' && p.book < 4).map((p) => <option key={p.id} value={p.id}>{p.book}권 · {p.title}</option>)}
          </optgroup>}
        </select>
        {busy && (
          <>
            <div className="rec-live"><span className="rec-dot" /> 녹음 중 {clock(elapsed)}</div>
            <CentsTrace source={live} seconds={10} height={120} />
          </>
        )}
        <button className={`primary wide big ${busy ? 'stop' : ''}`} onClick={busy ? stop : start} data-testid="rec-toggle">
          {busy ? '■ 녹음 끝내기' : '● 녹음 시작'}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="hint">녹음과 함께 음정 곡선이 저장돼요. 녹음 두 개를 고르면 나란히 비교할 수 있어요. 녹음은 이 기기에만 저장돼요.</p>
      </div>

      {pair.length === 2 && (
        <div className="card compare" data-testid="compare">
          <div className="card-head"><b>비교</b><button className="mini" onClick={() => setCompare([])}>닫기</button></div>
          {pair.map((r, i) => (
            <div key={r.id} className="compare-item">
              <div className="muted small">{i === 0 ? 'A' : 'B'} · {r.title} · {new Date(r.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} · {stat(r)}</div>
              <RecTrace rec={r} seconds={pairSec} />
              <Player rec={r} />
            </div>
          ))}
          {(() => {
            const [a, b] = pair.map((r) => trackStats(r.track));
            if (a.meanAbs === null || b.meanAbs === null) return null;
            const older = pair[0].createdAt < pair[1].createdAt ? 0 : 1;
            const [o, n] = older === 0 ? [a, b] : [b, a];
            const d = (n.meanAbs ?? 0) - (o.meanAbs ?? 0);
            return <p className="small">{Math.abs(d) < 1 ? '두 녹음의 평균 음정 오차가 비슷해요.' : d < 0 ? `최근 녹음이 평균 ${Math.abs(d).toFixed(1)}센트 더 정확해요.` : `최근 녹음이 평균 ${d.toFixed(1)}센트 더 벗어났어요.`}</p>;
          })()}
        </div>
      )}

      <div className="card">
        <b>녹음 {recs.length}개</b>
        {recs.length === 0 && <p className="muted small">아직 녹음이 없어요.</p>}
        <ul className="rec-list">
          {recs.map((r) => (
            <li key={r.id}>
              <div className="rec-head">
                <label className="rec-check"><input type="checkbox" checked={compare.includes(r.id!)} onChange={() => toggleCompare(r.id!)} aria-label="비교에 넣기" /></label>
                <button className="link rec-title" onClick={() => setOpen(open === r.id ? null : r.id!)}>
                  <b>{r.title}</b>
                  <span className="muted small">{new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {clock(r.durationSec)}</span>
                </button>
                <button className="mini danger" onClick={() => { if (confirm('이 녹음을 지울까요?')) db.recordings.delete(r.id!); }} aria-label="녹음 삭제">✕</button>
              </div>
              {open === r.id && (
                <div className="rec-body">
                  <div className="muted small">{stat(r)}</div>
                  <RecTrace rec={r} seconds={Math.max(1, r.durationSec)} />
                  <Player rec={r} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
