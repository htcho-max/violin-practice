import { useEffect, useRef, useState } from 'react';
import { TempoLadder, type LadderMode } from '../audio/ladder';
import { metronome } from '../audio/metronome';
import { clampBpm } from '../audio/schedule';
import { db } from '../data/db';
import { localDate } from '../data/dates';
import { currentPieces } from '../data/pieces';
import { usePieces } from '../state/usePieces';
import { setAudioStatus } from '../state/audioStatus';

interface Props { bpm: number; setBpm: (b: number) => void; running: boolean }

export function TempoTrainer({ bpm, setBpm, running }: Props) {
  const pieces = usePieces();
  const [pieceId, setPieceId] = useState('');
  const [start, setStart] = useState(bpm);
  const [target, setTarget] = useState(clampBpm(bpm + 20));
  const [step, setStep] = useState(4);
  const [mode, setMode] = useState<LadderMode>('success');
  const [bars, setBars] = useState(4);
  const [succ, setSucc] = useState(3);
  const ladder = useRef<TempoLadder | null>(null);
  const [, force] = useState(0);
  const [message, setMessage] = useState('');
  const startedAt = useRef(0);
  const firstBar = useRef(true);
  const L = ladder.current;
  const touched = useRef({ start: false, target: false });

  // 직접 고치기 전까지는 지금 메트로놈 템포를 따라감
  useEffect(() => {
    if (ladder.current || pieceId) return;
    if (!touched.current.start) setStart(bpm);
    if (!touched.current.target) setTarget(clampBpm(bpm + 20));
  }, [bpm, pieceId]);

  // 곡을 고르면 그 곡의 현재/목표 템포로
  useEffect(() => {
    const p = pieces.find((x) => x.id === pieceId);
    if (!p) return;
    if (p.currentBpm) setStart(p.currentBpm);
    if (p.targetBpm) setTarget(p.targetBpm);
  }, [pieceId, pieces]);

  // 마디 모드: 첫 박마다 1마디
  useEffect(() => metronome.onTick((t) => {
    const l = ladder.current;
    if (!l || t.sub !== 0 || t.beat !== 0) return;
    if (firstBar.current) { firstBar.current = false; return; }
    const nb = l.onBar(Date.now());
    if (nb) { setBpm(nb); if (l.done) finish('목표 템포에 도달했어요!'); }
    force((n) => n + 1);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 메트로놈을 직접 멈추면 트레이너도 끝
  useEffect(() => { if (!running && ladder.current) finish('멈췄어요.'); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function begin() {
    ladder.current = new TempoLadder({ startBpm: start, targetBpm: target, step, mode, bars, successes: succ }, Date.now());
    startedAt.current = Date.now();
    firstBar.current = true;
    setMessage('');
    setBpm(start);
    metronome.setBpm(start);
    if (!metronome.running) { await metronome.start(); setAudioStatus({ metronome: true }); }
    force((n) => n + 1);
  }

  async function finish(msg: string) {
    const l = ladder.current;
    if (!l) return;
    ladder.current = null;
    setMessage(`${msg} 최고 ♩${l.bpm} (${l.cfg.startBpm}에서 시작)`);
    await db.ladders.add({ date: localDate(), startedAt: startedAt.current, pieceId: pieceId || undefined, startBpm: l.cfg.startBpm, targetBpm: l.cfg.targetBpm, reachedBpm: l.bpm, steps: l.steps });
    if (pieceId) {
      const p = await db.pieces.get(pieceId);
      if (p) await db.pieces.update(pieceId, { currentBpm: Math.max(p.currentBpm ?? 0, l.bpm), targetBpm: p.targetBpm ?? l.cfg.targetBpm, lastPracticed: localDate() });
    }
    force((n) => n + 1);
  }

  function ok() {
    const l = ladder.current; if (!l) return;
    const nb = l.success(Date.now());
    if (nb) { setBpm(nb); if (l.done) finish('목표 템포에 도달했어요!'); }
    force((n) => n + 1);
  }
  function miss() { ladder.current?.fail(); force((n) => n + 1); }

  const num = (v: number, set: (n: number) => void, label: string, min = 1, max = 250) => (
    <label className="num-field"><span>{label}</span>
      <input className="num" type="number" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} disabled={!!L} />
    </label>
  );
  const choices = currentPieces(pieces);

  return (
    <details className="card trainer" open={!!L}>
      <summary className="card-summary"><b>템포 트레이너</b> <span className="muted">{L ? `진행 중 ♩${L.bpm}` : '느리게 시작해 조금씩 올리기'}</span></summary>
      <select value={pieceId} onChange={(e) => setPieceId(e.target.value)} disabled={!!L} aria-label="곡">
        <option value="">곡 선택 안 함</option>
        {choices.map((p) => <option key={p.id} value={p.id}>{p.title}{p.currentBpm ? ` (♩${p.currentBpm})` : ''}</option>)}
      </select>
      <div className="num-row">
        {num(start, (n) => { touched.current.start = true; setStart(clampBpm(n)); }, '시작 ♩', 30)}
        {num(target, (n) => { touched.current.target = true; setTarget(clampBpm(n)); }, '목표 ♩', 30)}
        {num(step, (n) => setStep(Math.max(1, Math.min(20, n))), '올림')}
      </div>
      <div className="segmented small">
        <button className={mode === 'success' ? 'on' : ''} onClick={() => setMode('success')} disabled={!!L}>성공 횟수마다</button>
        <button className={mode === 'bars' ? 'on' : ''} onClick={() => setMode('bars')} disabled={!!L}>마디마다 자동</button>
      </div>
      <div className="num-row">
        {mode === 'success' ? num(succ, (n) => setSucc(Math.max(1, Math.min(10, n))), '연속 성공') : num(bars, (n) => setBars(Math.max(1, Math.min(32, n))), '마디 수')}
      </div>

      {L ? (
        <div className="trainer-live">
          <div className="progress"><div style={{ width: `${L.progress * 100}%` }} /></div>
          <div className="muted small" data-testid="ladder-status">
            ♩{L.bpm} → {L.cfg.targetBpm} · {L.cfg.mode === 'success' ? `성공 ${L.successCount}/${L.cfg.successes}` : `${L.barCount}/${L.cfg.bars}마디`}
          </div>
          {L.cfg.mode === 'success' && (
            <div className="session-controls">
              <button className="danger" onClick={miss}>✗ 다시</button>
              <button className="primary" onClick={ok} data-testid="ladder-ok">✓ 깨끗하게 성공</button>
            </div>
          )}
          <button className="secondary wide" onClick={() => finish('트레이너를 끝냈어요.')}>트레이너 끝내기</button>
        </div>
      ) : (
        <button className="primary wide" onClick={begin} data-testid="ladder-start">템포 트레이너 시작</button>
      )}
      {message && <p className="small" data-testid="ladder-message">{message}</p>}
      <p className="hint">성공 모드: 구간을 깨끗하게 치면 ✓, 틀리면 ✗(횟수 초기화). 곡을 고르면 도달한 템포가 곡의 현재 템포로 저장돼요.</p>
    </details>
  );
}
