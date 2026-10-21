import { useEffect, useRef, useState } from 'react';
import { pitchTracker } from '../audio/pitchTracker';
import { NoteSegmenter, equalRef } from '../audio/segment';
import { midiName } from '../audio/notes';
import { planPlayback, scorePlayer } from '../score/player';
import type { ParsedScore, ScoreNote } from '../score/parse';
import { ECHO_KEYS, ECHO_LEVELS, ECHO_MAX, ECHO_MIN, echoFingers, echoPool, makePhrase, nextLength, rng, scoreEcho, type EchoNote, type EchoResult } from '../exercise/echo';
import { useSettings } from '../state/settings';
import type { usePitch } from '../state/usePitch';
import { useEchoRuns } from '../state/useEchoRuns';
import { useToday } from '../state/useToday';
import { db } from '../data/db';
import { localDate } from '../data/dates';

const BPM = 72;
const PREF_KEY = 'violin-echo';
type Phase = 'idle' | 'play' | 'listen' | 'done';
interface Prefs { key: string; level: string }
function loadPrefs(): Prefs {
  const d = { key: 'G', level: 'three' };
  try { const p = { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; return ECHO_KEYS.some((k) => k.id === p.key) && ECHO_LEVELS.some((l) => l.id === p.level) ? p : d; } catch { return d; }
}

/** 구절을 악보처럼 만들어서 바이올린 소리로 재생 (4분음표) */
function phraseScore(notes: number[]): ParsedScore {
  const ns: ScoreNote[] = notes.map((midi, i) => ({ measure: 1, index: i, midi, beat: i, dur: 1 }));
  return { title: '', measures: [1], notes: ns, measureLen: new Map([[1, notes.length]]), time: [notes.length, 4], parts: [''], dyn: [], measureStart: new Map([[1, 0]]), bars: [] };
}

/** 음정 탭 → 따라 하기: 앱이 들려준 짧은 구절을 바이올린으로 따라 켜고 음 높이·순서 채점 */
export function EchoTrainer({ pitch, beforePlay }: { pitch: ReturnType<typeof usePitch>; beforePlay?: () => void }) {
  const { settings } = useSettings();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 무시 */ } }, [prefs]);
  const pool = echoPool(prefs.key, prefs.level);
  const [len, setLen] = useState(ECHO_MIN);
  const [showNames, setShowNames] = useState(false);
  const [phrase, setPhrase] = useState<EchoNote[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState<number[]>([]);
  const [res, setRes] = useState<EchoResult | null>(null);
  const [tally, setTally] = useState({ right: 0, tries: 0 });
  const [voiceNote, setVoiceNote] = useState('');
  const hist = useRef<boolean[]>([]);
  const halfFails = useRef(0);
  const seed = useRef(Date.now() % 100000);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<(() => void) | null>(null);
  const runs = useEchoRuns();
  const today = useToday();
  const todayRuns = runs.filter((r) => r.date === today);
  useEffect(() => () => { scorePlayer.stop(); if (timer.current) clearTimeout(timer.current); }, []);

  async function play(p: EchoNote[]) {
    setPhase('play'); setHeard([]); setRes(null);
    beforePlay?.();
    if (!pitch.on) await pitch.start(); // 마이크 권한은 먼저 (듣는 동안 묻지 않게)
    const plan = planPlayback(phraseScore(p.map((n) => n.midi)), { bpm: BPM, from: 1, to: 1, countIn: false });
    await scorePlayer.play(plan, {
      a4: settings.a4, click: false, voice: 'sample',
      // 앱 소리의 끝자락을 듣지 않게 잠깐 쉬고 듣기
      onEnd: () => { timer.current = setTimeout(() => setPhase('listen'), 350); },
    });
    setVoiceNote(scorePlayer.usedSample ? '' : '바이올린 소리를 불러오지 못해서 합성음으로 들려줘요. (첫 재생은 인터넷 연결이 필요해요)');
  }
  function newPhrase() {
    seed.current += 1;
    const p = makePhrase(pool, len, rng(seed.current));
    setPhrase(p);
    void play(p);
  }

  // 듣기: 음 단위로 모아서, 소리가 0.9초 끊기면 끝
  useEffect(() => {
    if (phase !== 'listen' || !phrase) return;
    const seg = new NoteSegmenter(equalRef(settings.a4));
    const got: number[] = [], cents: number[] = [];
    let t0: number | null = null, last: number | null = null;
    let ended = false;
    const end = () => {
      if (ended) return; ended = true;
      const f = seg.flush(); if (f) { got.push(f.midi); cents.push(f.meanCents); }
      endRef.current = null;
      finish(got, cents);
    };
    endRef.current = end;
    const unsub = pitchTracker.subscribe((r) => {
      if (t0 === null) t0 = r.time;
      if (r.freq !== null) last = r.time;
      const n = seg.push(r.time, r.freq);
      if (n) { got.push(n.midi); cents.push(n.meanCents); setHeard([...got]); }
      if (last !== null && r.freq === null && r.time - last > 0.9) end();
      else if (last === null && r.time - t0 > 8) end();
      else if (got.length >= phrase.length + 3) end();
    });
    return () => { unsub(); endRef.current = null; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(got: number[], cents: number[]) {
    if (!phrase) return;
    const target = phrase.map((n) => n.midi);
    const r = scoreEcho(target, got, cents);
    setRes(r); setHeard(got); setPhase('done');
    setTally((t) => ({ right: t.right + (r.perfect ? 1 : 0), tries: t.tries + 1 }));
    hist.current.push(r.perfect);
    halfFails.current = r.correct < phrase.length / 2 ? halfFails.current + 1 : 0;
    const nl = nextLength(len, hist.current, halfFails.current);
    if (nl !== len) { setLen(nl); hist.current = []; halfFails.current = 0; }
    if (got.length) void db.echoRuns.add({ createdAt: Date.now(), date: localDate(), key: prefs.key, level: prefs.level, notes: target, hits: r.correct, expected: target.length, meanAbs: r.meanAbs });
  }
  /** 다 켰다고 누르면 지금까지 들은 것으로 */
  const stopListen = () => endRef.current?.();
  const busy = phase === 'play' || phase === 'listen';
  const choose = (p: Partial<Prefs>) => { setPrefs({ ...prefs, ...p }); setPhrase(null); setRes(null); setPhase('idle'); };
  /** 들은 음 이름: 조의 음이면 조 철자로 */
  const nameOf = (m: number) => pool.find((n) => n.midi === m)?.name ?? midiName(m);
  const fingers = res && phrase ? echoFingers(prefs.key, prefs.level, phrase.map((n) => n.midi)) : [];
  const level = ECHO_LEVELS.find((l) => l.id === prefs.level)!;

  return (
    <>
      <div className="card" data-testid="echo-card">
        <b>듣고 따라 하기</b>
        <div className="row-setting">
          <span>조</span>
          <select value={prefs.key} onChange={(e) => choose({ key: e.target.value })} disabled={busy} aria-label="따라 하기 조" data-testid="echo-key">
            {ECHO_KEYS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
        <div className="chips">
          {ECHO_LEVELS.map((l) => <button key={l.id} className={`chip ${l.id === prefs.level ? 'on' : ''}`} disabled={busy} onClick={() => choose({ level: l.id })} data-testid={`echo-level-${l.id}`}>{l.label}</button>)}
        </div>
        <p className="muted small">{level.desc} · {pool.map((n) => n.name).join(' ')}</p>
        <div className="row-setting">
          <span>음 개수</span>
          <button className="mini" disabled={busy || len <= ECHO_MIN} onClick={() => { setLen(len - 1); hist.current = []; }} aria-label="음 줄이기">−</button>
          <b data-testid="echo-len">{len}</b>
          <button className="mini" disabled={busy || len >= ECHO_MAX} onClick={() => { setLen(len + 1); hist.current = []; }} aria-label="음 늘리기">+</button>
          <label><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 음 이름 먼저 보기</label>
        </div>
        <p className="hint">앱이 짧은 구절을 들려주면 똑같이 켜요. 음 높이와 순서를 채점해요. 3번 연속 다 맞히면 한 음 늘고, 두 번 연속 절반도 못 맞히면 한 음 줄어요. 처음엔 "세 음"처럼 좁게 시작하세요. 드론은 문제를 들려줄 때 꺼져요.</p>
      </div>

      <div className="card echo-live" data-testid="echo-live">
        {phrase && (showNames || phase === 'done') ? (
          <div className="echo-heard">{phrase.map((n, i) => <span key={i} className="chip">{n.name}</span>)}</div>
        ) : (
          <div className="echo-dots">{Array.from({ length: phrase?.length ?? len }, (_, i) => <span key={i} className={`dot ${i < heard.length ? 'past' : ''}`} />)}</div>
        )}
        <div className="echo-phase" data-testid="echo-phase">{phase === 'play' ? '잘 들어 보세요…' : phase === 'listen' ? '지금 따라 켜요!' : phase === 'done' ? (res?.perfect ? '정답!' : `${res?.correct}/${phrase?.length} 맞음`) : ' '}</div>
        {phase === 'listen' && <div className="echo-heard">{heard.map((m, i) => <span key={i} className="chip">{nameOf(m)}</span>)}</div>}
        {res && phrase && (
          <div className="tbl-wrap">
            <table className="tbl echo-table" data-testid="echo-result">
              <tbody>
                <tr><th>정답</th>{phrase.map((n, i) => <td key={i} className={res.marks[i] === 'ok' ? 'good' : 'bad'}>{n.name}</td>)}</tr>
                <tr><th>내 소리</th>{phrase.map((_, i) => <td key={i} className="muted">{res.played[i] !== undefined ? nameOf(res.played[i]) : '—'}</td>)}</tr>
                {fingers.some(Boolean) && <tr><th>운지</th>{fingers.map((f, i) => <td key={i} className="muted small">{f || '—'}</td>)}</tr>}
              </tbody>
            </table>
          </div>
        )}
        {res && res.meanAbs !== null && <div className="muted small" data-testid="echo-cents">맞힌 음 음정 평균 ±{Math.round(res.meanAbs)}센트</div>}
        {phase === 'listen' ? (
          <button className="primary wide big stop" onClick={stopListen} data-testid="echo-stop">■ 다 켰어요</button>
        ) : (
          <div className="session-controls">
            <button className="primary" onClick={newPhrase} disabled={busy || pool.length < 2} data-testid="echo-new">▶ {phrase ? '다음 문제' : '문제 듣기'}</button>
            <button onClick={() => phrase && play(phrase)} disabled={busy || !phrase} data-testid="echo-again">↻ 다시 듣기</button>
          </div>
        )}
        {voiceNote && <p className="hint">{voiceNote}</p>}
        {pitch.error && <p className="error">{pitch.error}</p>}
        <div className="muted small">이번에 {tally.right}/{tally.tries} 정답 · 오늘 {todayRuns.filter((r) => r.hits === r.expected).length}/{todayRuns.length}</div>
      </div>
    </>
  );
}
