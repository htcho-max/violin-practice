import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { db, type ScoreFile } from '../data/db';
import { parseMusicXML, notesInRange, type ParsedScore } from '../score/parse';
import { alignNotes, summarizeScore, type Played, type Scored } from '../score/align';
import { createOSMD, colorNotes, noteElements } from '../score/osmd';
import { planPlayback, scorePlayer, slicePlan, type Voice } from '../score/player';
import { NoteSegmenter, equalRef } from '../audio/segment';
import { pitchTracker } from '../audio/pitchTracker';
import { midiName } from '../audio/notes';
import { centsText } from '../components/CentsGauge';
import { usePieces } from '../state/usePieces';
import { usePitch } from '../state/usePitch';
import { useSettings } from '../state/settings';
import { useWakeLock } from '../state/wakeLock';
import { Exercises, createExercise, createBow, loadOpts, recordProgress } from './Exercises';
import { BOW_VARIANTS } from '../exercise/bow';
import { STEPS } from '../exercise/curriculum';

function useScores(): ScoreFile[] {
  const [rows, setRows] = useState<ScoreFile[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.scores.orderBy('createdAt').reverse().toArray()).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}

const COLOR = { good: '#15803d', warn: '#ca8a04', bad: '#dc2626', wrong: '#7c3aed', missed: '#9ca3af' };
const colorFor = (r: Scored) => r.status === 'missed' ? COLOR.missed : r.status === 'wrong' ? COLOR.wrong
  : Math.abs(r.cents!) <= 10 ? COLOR.good : Math.abs(r.cents!) <= 20 ? COLOR.warn : COLOR.bad;
const tone = (c: number | null) => (c === null ? '' : c <= 10 ? 'good' : c <= 20 ? 'warn' : 'bad');

export function Score() {
  const scores = useScores();
  const pieces = usePieces();
  const [openId, setOpenId] = useState<number | null>(null);
  const [exView, setExView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieceForNew, setPieceForNew] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const open = scores.find((s) => s.id === openId) ?? null;

  async function importFile(f: File) {
    setError(null);
    try {
      if (/\.mxl$/i.test(f.name)) throw new Error('압축된 .mxl 은 아직 못 읽어요. MuseScore 등에서 "MusicXML(.musicxml)"로 내보내 주세요.');
      const xml = await f.text();
      const parsed = parseMusicXML(xml);
      if (!parsed.notes.length) throw new Error('음표가 없는 악보예요.');
      const id = await db.scores.add({ title: parsed.title, xml, pieceId: pieceForNew || undefined, createdAt: Date.now() });
      setOpenId(id);
    } catch (e) {
      setError((e as Error).message || '악보를 불러오지 못했어요.');
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  if (open) return <ScoreView key={`${open.id}:${open.createdAt}`} score={open} onClose={() => { setOpenId(null); setExView(!!open.exercise); }} />;
  if (exView) return <Exercises onOpen={(id) => { setOpenId(id); }} onBack={() => setExView(false)} />;
  const mine = scores.filter((s) => !s.exercise);

  return (
    <section className="page score">
      <div className="card">
        <b>음계 · 포지션 · 에튀드</b>
        <p className="hint">1포지션 음계에서 3포지션, 포지션 이동, 에튀드까지 단계별 연습곡을 앱이 만들어 줘요.</p>
        <button className="primary wide" onClick={() => setExView(true)} data-testid="open-exercises">연습곡 만들기</button>
      </div>
      <div className="card">
        <b>악보 불러오기</b>
        <p className="hint">
          MusicXML 파일(.musicxml, .xml)을 고르세요. 악보는 <b>이 기기 안에만</b> 저장되고, 앱이나 GitHub에는 올라가지 않아요.
          (교재 악보는 저작권이 있어서 개인 연습용으로만 쓰세요.)
        </p>
        <select value={pieceForNew} onChange={(e) => setPieceForNew(e.target.value)} aria-label="연결할 곡">
          <option value="">곡 연결 안 함</option>
          {pieces.map((p) => <option key={p.id} value={p.id}>{p.book}권 · {p.title}</option>)}
        </select>
        <input ref={file} type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,text/xml" hidden
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} data-testid="score-file" />
        <button className="primary wide" onClick={() => file.current?.click()}>파일에서 악보 불러오기</button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <b>내 악보 {mine.length}개</b>
        {mine.length === 0 && <p className="muted small">아직 없어요.</p>}
        <ul className="rec-list">
          {mine.map((s) => (
            <li key={s.id}>
              <div className="rec-head">
                <button className="link rec-title" onClick={() => setOpenId(s.id!)} data-testid="score-open">
                  <b>{s.title}</b>
                  <span className="muted small">{pieces.find((p) => p.id === s.pieceId)?.title ?? '곡 연결 없음'} · {new Date(s.createdAt).toLocaleDateString('ko-KR')}</span>
                </button>
                <button className="mini danger" onClick={() => { if (confirm('이 악보를 지울까요?')) db.scores.delete(s.id!); }} aria-label="악보 삭제">✕</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ScoreView({ score, onClose }: { score: ScoreFile; onClose: () => void }) {
  const { settings } = useSettings();
  const pieces = usePieces();
  const piece = pieces.find((p) => p.id === score.pieceId);
  const parsed: ParsedScore = useMemo(() => parseMusicXML(score.xml), [score.xml]);
  const first = parsed.measures[0] ?? 1, last = parsed.measures[parsed.measures.length - 1] ?? 1;
  const firstNoteMeasure = parsed.notes[0]?.measure ?? first;
  const [from, setFrom] = useState(score.lastFrom ?? firstNoteMeasure);
  const [to, setTo] = useState(score.lastTo ?? (score.exercise ? last : Math.min(last, (score.lastFrom ?? firstNoteMeasure) + 3)));
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const osmd = useRef<OpenSheetMusicDisplay | null>(null);
  const pitch = usePitch(settings.minDb);
  const [listening, setListening] = useState(false);
  const played = useRef<Played[]>([]);
  const [, tick] = useState(0);
  const [result, setResult] = useState<Scored[] | null>(null);
  const els = useRef<Map<string, string[]>>(new Map());
  const lit = useRef<SVGGElement[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playBpm, setPlayBpm] = useState(72);
  const [withClick, setWithClick] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [loop, setLoop] = useState(false);
  const [voice, setVoice] = useState<Voice>('sample');
  const [voiceNote, setVoiceNote] = useState('');
  const [nowMeasure, setNowMeasure] = useState<number | null>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useWakeLock(listening || playing, settings.wakeLock);
  const ex = score.exercise;
  const step = ex ? STEPS.find((s) => s.id === ex.stepId) : undefined;
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  useEffect(() => { if (ex) setPlayBpm(ex.tempo); }, [ex?.stepId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (piece?.currentBpm) setPlayBpm(piece.currentBpm); else if (piece?.targetBpm) setPlayBpm(Math.round(piece.targetBpm * 0.7)); }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => scorePlayer.stop(), []);

  const expected = useMemo(() => notesInRange(parsed, from, to), [parsed, from, to]);

  // 악보 그리기
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!osmd.current && holder.current) {
          osmd.current = await createOSMD(holder.current);
          await osmd.current.load(score.xml);
        }
        if (!alive || !osmd.current) return;
        setRendering(true);
        osmd.current.setOptions({ drawFromMeasureNumber: from, drawUpToMeasureNumber: to });
        colorNotes(osmd.current, new Map(result ? result.map((r) => [`${r.note.measure}:${r.note.index}`, colorFor(r)]) : []));
        osmd.current.render();
        els.current = noteElements(osmd.current);
        lit.current = [];
        setRenderError(null);
      } catch (e) {
        setRenderError('악보를 그리지 못했어요: ' + ((e as Error).message ?? ''));
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => { alive = false; };
  }, [score.xml, from, to, result]);

  useEffect(() => { db.scores.update(score.id!, { lastFrom: from, lastTo: to }); }, [score.id, from, to]);

  // 연주 듣기: 음 단위로 모으기
  useEffect(() => {
    if (!listening) return;
    const seg = new NoteSegmenter(equalRef(settings.a4));
    const unsub = pitchTracker.subscribe((r) => {
      const n = seg.push(r.time, r.freq);
      if (n) { played.current.push({ midi: n.midi, cents: n.settledCents ?? n.meanCents, start: n.start }); tick((x) => x + 1); }
    });
    return () => {
      unsub();
      const n = seg.flush();
      if (n) played.current.push({ midi: n.midi, cents: n.settledCents ?? n.meanCents, start: n.start });
    };
  }, [listening, settings.a4]);

  const live = useMemo(() => (listening ? alignNotes(expected, played.current) : null), [listening, expected, played.current.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveDone = live ? live.filter((r) => r.status !== 'missed').length : 0;

  function highlight(key: string | null) {
    lit.current.forEach((g) => g.classList.remove('now-note'));
    const ids = key ? els.current.get(key) ?? [] : [];
    lit.current = ids.map((id) => document.getElementById(id) ?? document.getElementById(`vf-${id}`)).filter((x): x is HTMLElement & SVGGElement => !!x) as unknown as SVGGElement[];
    lit.current.forEach((g) => g.classList.add('now-note'));
    lit.current[0]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  const curIdx = useRef(0);
  async function playRange(resumeAt?: number) {
    if (listening) stop();
    const full = planPlayback(parsed, { bpm: playBpm, from, to, countIn: resumeAt === undefined && countIn });
    const plan = resumeAt === undefined ? full : slicePlan(full, resumeAt);
    const base = resumeAt ?? 0;
    setPlaying(true);
    await scorePlayer.play(plan, {
      a4: settings.a4,
      click: withClick,
      voice,
      onNote: (e) => {
        if (e) curIdx.current = base + plan.events.indexOf(e);
        highlight(e ? `${e.note.measure}:${e.note.index}` : null);
        setNowMeasure(e ? e.note.measure : null);
      },
      onEnd: () => { if (loopRef.current) playRange(); else { highlight(null); setPlaying(false); } },
    });
    setVoiceNote(voice === 'sample' && !scorePlayer.usedSample ? '바이올린 소리를 불러오지 못해서 합성음으로 재생해요. (첫 재생은 인터넷 연결이 필요해요)' : '');
  }
  // 듣는 중에 템포를 바꾸면 지금 음부터 새 템포로 이어서
  const playingRef = useRef(false);
  playingRef.current = playing;
  const firstBpm = useRef(true);
  useEffect(() => {
    if (firstBpm.current) { firstBpm.current = false; return; }
    if (!playingRef.current) return;
    const id = setTimeout(() => { if (playingRef.current) playRange(curIdx.current); }, 200);
    return () => clearTimeout(id);
  }, [playBpm]); // eslint-disable-line react-hooks/exhaustive-deps
  function stopPlay() { scorePlayer.stop(); highlight(null); setNowMeasure(null); setPlaying(false); }

  async function start() {
    if (playing) stopPlay();
    setResult(null);
    played.current = [];
    if (!pitch.on) await pitch.start();
    setListening(true);
  }
  function stop() {
    setListening(false);
    // flush 는 effect 정리에서 → 다음 틱에 채점
    setTimeout(() => {
      const r = alignNotes(expected, played.current);
      setResult(r);
      if (ex && from <= firstNoteMeasure && to >= last && r.length) {
        const sm = summarizeScore(r);
        const pct = Math.round((sm.ok / Math.max(1, sm.total)) * 100);
        recordProgress(ex.progressId ?? ex.stepId, pct, sm.meanAbs, playBpm).then((ok) => setPassMsg(ok ? '통과! 다음 단계로 가거나 템포를 올려 보세요.' : null));
      }
    }, 0);
  }
  const setRange = (a: number, b: number) => {
    const A = Math.max(first, Math.min(last, a)), B = Math.max(A, Math.min(last, b));
    setFrom(A); setTo(B); setResult(null);
  };
  const span = to - from + 1;
  const shiftSet = useMemo(() => new Set(ex?.shiftKeys ?? []), [ex]);
  const shiftRes = result && ex ? result.filter((r) => shiftSet.has(`${r.note.measure}:${r.note.index}`)) : [];
  const shiftOk = shiftRes.filter((r) => r.status === 'ok');
  const shiftMean = shiftOk.length ? shiftOk.reduce((a, r) => a + Math.abs(r.cents!), 0) / shiftOk.length : null;
  async function regenerate() {
    if (!ex) return;
    setRegenBusy(true);
    try { await createExercise(ex.stepId, ex.spec, loadOpts(), ex.seed + 1, ex.tempo, ex.tip); }
    finally { setRegenBusy(false); }
  }
  const bowIdx = ex?.spec.pattern === 'bow' ? BOW_VARIANTS.findIndex((v) => v.id === ex.spec.variant) : -1;
  async function goVariant(step: number) {
    if (!ex || bowIdx < 0) return;
    const v = BOW_VARIANTS[(bowIdx + step + BOW_VARIANTS.length) % BOW_VARIANTS.length];
    setRegenBusy(true);
    try { await createBow(ex.spec.base ?? 'open', ex.spec.key, v.id, loadOpts(), playBpm); } finally { setRegenBusy(false); }
  }
  async function rebuild() {
    if (!ex) return;
    if (bowIdx >= 0) return goVariant(0);
    setRegenBusy(true);
    try { await createExercise(ex.stepId, ex.spec, loadOpts(), ex.seed, ex.tempo, ex.tip); } finally { setRegenBusy(false); }
  }
  const sum = result ? summarizeScore(result) : null;
  const worst = result ? result.filter((r) => r.status === 'ok').sort((a, b) => Math.abs(b.cents!) - Math.abs(a.cents!)).slice(0, 6) : [];

  return (
    <section className="page score">
      <div className="card-head">
        <button className="mini" onClick={() => { if (listening) stop(); pitch.stop(); onClose(); }}>◀ 목록</button>
        <b className="score-title">{score.title}</b>
      </div>

      {ex && (
        <div className="card" data-testid="exercise-card">
          {bowIdx >= 0 && (
            <div className="session-controls">
              <button onClick={() => goVariant(-1)} disabled={regenBusy || playing || listening}>◀ 이전 변형</button>
              <span className="muted small">{bowIdx + 1} / {BOW_VARIANTS.length}</span>
              <button onClick={() => goVariant(1)} disabled={regenBusy || playing || listening} data-testid="bow-next">다음 변형 ▶</button>
            </div>
          )}
          {(step?.tip ?? ex.tip) && <p className="hint"><b>팁</b> {step?.tip ?? ex.tip}</p>}
          {ex.shiftKeys.length > 0 && <p className="hint">포지션을 옮기는 음 {ex.shiftKeys.length}개는 채점 뒤에 따로 보여줘요.</p>}
          <div className="session-controls">
            <button onClick={rebuild} disabled={regenBusy || playing || listening} title="연습곡 화면에서 바꾼 리듬·활·운지 설정으로 다시 만들기">설정 다시 적용</button>
            {ex.spec.pattern === 'etude' && <button onClick={regenerate} disabled={regenBusy || playing || listening} data-testid="ex-regen">다른 곡 만들기</button>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row-setting">
          <span>마디</span>
          <input className="num" type="number" value={from} min={first} max={last} onChange={(e) => setRange(Number(e.target.value), Math.max(Number(e.target.value), to))} aria-label="시작 마디" data-testid="from" />
          <span>~</span>
          <input className="num" type="number" value={to} min={first} max={last} onChange={(e) => setRange(from, Number(e.target.value))} aria-label="끝 마디" data-testid="to" />
          <span className="muted small">{expected.length}음</span>
        </div>
        <div className="session-controls">
          <button onClick={() => setRange(from - span, to - span)} disabled={from <= first}>◀ 앞 구간</button>
          <button onClick={() => setRange(firstNoteMeasure, last)}>전체</button>
          <button onClick={() => setRange(from + span, to + span)} disabled={to >= last}>다음 구간 ▶</button>
        </div>
      </div>

      <div className="card" data-testid="play-card">
        <div className="card-head"><b>악보 듣기</b>{playing && nowMeasure !== null && <span className="muted small">{nowMeasure}마디</span>}</div>
        <div className="row-setting">
          <span>♩ =</span>
          <button className="mini" onClick={() => setPlayBpm((b) => Math.max(30, b - 5))}>−5</button>
          <input className="num" type="number" min={30} max={200} value={playBpm} onChange={(e) => setPlayBpm(Math.max(30, Math.min(200, Number(e.target.value) || 30)))} aria-label="재생 템포" data-testid="play-bpm" />
          <button className="mini" onClick={() => setPlayBpm((b) => Math.min(200, b + 5))}>+5</button>
        </div>
        <div className="row-setting">
          <label><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /> 시작 전 한 마디 세기</label>
          <label><input type="checkbox" checked={withClick} onChange={(e) => setWithClick(e.target.checked)} /> 메트로놈</label>
          <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> 반복</label>
        </div>
        <div className="segmented small">
          <button className={voice === 'sample' ? 'on' : ''} onClick={() => setVoice('sample')} disabled={playing}>바이올린 녹음</button>
          <button className={voice === 'synth' ? 'on' : ''} onClick={() => setVoice('synth')} disabled={playing}>합성음</button>
        </div>
        {voiceNote && <p className="hint">{voiceNote}</p>}
        <button className={`secondary wide ${playing ? 'on' : ''}`} onClick={playing ? stopPlay : () => { curIdx.current = 0; playRange(); }} disabled={!expected.length} data-testid="play-toggle">
          {playing ? '■ 듣기 멈추기' : `▶ ${from}~${to}마디 들어보기`}
        </button>
        <p className="hint">템포는 4분음표 기준이에요. 처음엔 느리게 들으며 음정과 리듬을 익히고, 반복을 켜 두고 같이 연주해 보세요.</p>
      </div>

      <div className="card">
        {!listening ? (
          <button className="primary wide big" onClick={start} disabled={!expected.length} data-testid="score-start">● 이 구간 연주하고 채점받기</button>
        ) : (
          <>
            <div className="rec-live"><span className="rec-dot" /> 듣는 중 · {liveDone}/{expected.length}음</div>
            <div className="progress"><div style={{ width: `${(liveDone / Math.max(1, expected.length)) * 100}%` }} /></div>
            <button className="primary wide big stop" onClick={stop} data-testid="score-stop">■ 끝내고 채점</button>
          </>
        )}
        {pitch.error && <p className="error">{pitch.error}</p>}
        <p className="hint">템포는 상관없어요. 악보 순서대로 연주하면 음을 맞춰 보고, 음표 색으로 보여줘요. 초록 ±10센트 안, 노랑 ±20, 빨강 그 이상, 보라 다른 음, 회색 놓친 음.</p>
      </div>

      <div className="score-sheet">
        {rendering && <p className="muted small">악보를 그리는 중…</p>}
        {renderError && <p className="error">{renderError}</p>}
        <div ref={holder} data-testid="osmd" />
      </div>

      {sum && (
        <div className="card" data-testid="score-result">
          <div className="stats">
            <div><b>{Math.round((sum.ok / Math.max(1, sum.total)) * 100)}%</b><span>맞은 음 {sum.ok}/{sum.total}</span></div>
            <div><b>{sum.meanAbs === null ? '—' : `±${Math.round(sum.meanAbs)}`}</b><span>평균 오차(센트)</span></div>
            <div><b>{sum.wrong + sum.missed}</b><span>다른 음·놓침</span></div>
          </div>
          {passMsg && <p className="good"><b>✓ {passMsg}</b></p>}
          {shiftRes.length > 0 && (
            <p className="small" data-testid="shift-stats">
              포지션 이동 음 {shiftOk.length}/{shiftRes.length}개 맞음{shiftMean !== null && <> · 평균 <b className={tone(shiftMean)}>±{Math.round(shiftMean)}센트</b></>}
              {shiftMean !== null && shiftMean > 15 ? ' — 도착하는 손가락 음정을 드론과 함께 천천히 확인해 보세요.' : ''}
            </p>
          )}
          <b>마디별</b>
          <div className="chips">
            {[...sum.byMeasure.entries()].map(([m, v]) => (
              <button key={m} className={`chip measure-chip ${tone(v)}`} onClick={() => setRange(m, m)} title="이 마디만 다시">
                {m}<small>{v === null ? '—' : `±${Math.round(v)}`}</small>
              </button>
            ))}
          </div>
          {worst.length > 0 && (
            <>
              <b>가장 벗어난 음</b>
              <table className="tbl">
                <thead><tr><th>마디</th><th>음</th><th>오차</th></tr></thead>
                <tbody>{worst.map((r) => (
                  <tr key={`${r.note.measure}:${r.note.index}`}><td>{r.note.measure}</td><td>{midiName(r.note.midi)}</td><td className={tone(Math.abs(r.cents!))}>{centsText(r.cents)}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
          <button className="secondary wide" onClick={start}>같은 구간 다시</button>
          <p className="hint">마디 번호를 누르면 그 마디만 골라서 반복할 수 있어요.</p>
        </div>
      )}

    </section>
  );
}
