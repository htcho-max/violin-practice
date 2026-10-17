import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { db, type ScoreFile } from '../data/db';
import { parseMusicXML, notesInRange, type ParsedScore } from '../score/parse';
import { alignNotes, summarizeScore, type Played, type Scored } from '../score/align';
import { createOSMD, colorNotes, noteElements, showParts } from '../score/osmd';
import { planPlayback, scorePlayer, slicePlan, instFor, type Voice, type AccPart } from '../score/player';
import { analyzeRhythm, rhythmTone } from '../score/rhythm';
import { NoteSegmenter, equalRef } from '../audio/segment';
import { pitchTracker } from '../audio/pitchTracker';
import { midiName } from '../audio/notes';
import { centsText } from '../components/CentsGauge';
import { NumField } from '../components/NumField';
import { usePieces } from '../state/usePieces';
import { usePitch } from '../state/usePitch';
import { useSettings } from '../state/settings';
import { useWakeLock } from '../state/wakeLock';
import { useSession } from '../state/session';
import { useBackLayer } from '../state/back';
import { recorder } from '../audio/recorder';
import { localDate, clock } from '../data/dates';
import { useScoreRuns, runText } from '../state/useScoreRuns';
import type { ScoreRun, Recording } from '../data/db';
import { Exercises, createExercise, createBow, loadOpts, recordProgress, takePending } from './Exercises';
import { BOW_VARIANTS } from '../exercise/bow';
import { STEPS } from '../exercise/curriculum';
import { useFolders, guessFolder, folderForBook, addFolder, renameFolder, deleteFolder, moveFolder, moveScore } from '../data/folders';

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
  const folders = useFolders();
  const [openId, setOpenId] = useState<number | null>(null);
  const [exView, setExView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieceForNew, setPieceForNew] = useState('');
  const [filter, setFilter] = useState<string>(() => { try { return localStorage.getItem('violin-score-folder') || 'all'; } catch { return 'all'; } });
  const [manage, setManage] = useState(false);
  useEffect(() => { try { localStorage.setItem('violin-score-folder', filter); } catch { /* 무시 */ } }, [filter]);
  const file = useRef<HTMLInputElement>(null);
  const open = scores.find((s) => s.id === openId) ?? null;
  // 오늘의 연습에서 연습곡을 바로 열기
  useEffect(() => { const p = takePending(); if (p) p().then((id) => { setExView(true); setOpenId(id); }).catch(() => {}); }, []);
  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name ?? '분류 안 됨';

  async function importFile(f: File) {
    setError(null);
    try {
      if (/\.mxl$/i.test(f.name)) throw new Error('압축된 .mxl 은 아직 못 읽어요. MuseScore 등에서 "MusicXML(.musicxml)"로 내보내 주세요.');
      const xml = await f.text();
      const parsed = parseMusicXML(xml);
      if (!parsed.notes.length) throw new Error('음표가 없는 악보예요.');
      const piece = pieces.find((p) => p.id === pieceForNew);
      // 폴더: 고른 폴더 > 연결한 곡의 권 > 제목으로 짐작
      const folder = filter !== 'all' && filter !== 'none' ? filter
        : piece ? await folderForBook(piece.book)
        : guessFolder(parsed.title, undefined, new Map([3, 2, 1].map((b) => [b, pieces.filter((p) => p.book === b).map((p) => p.title)])));
      if (folder.startsWith('suzuki-')) await folderForBook(Number(folder.split('-')[1]));
      const id = await db.scores.add({ title: parsed.title, xml, pieceId: pieceForNew || undefined, folder, createdAt: Date.now() });
      setOpenId(id);
    } catch (e) {
      setError((e as Error).message || '악보를 불러오지 못했어요.');
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  useBackLayer(!!open, () => { const o = open; setOpenId(null); setExView(!!o?.exercise); });
  useBackLayer(exView, () => setExView(false));
  if (open) return <ScoreView key={`${open.id}:${open.createdAt}`} score={open} onClose={() => { setOpenId(null); setExView(!!open.exercise); }} />;
  if (exView) return <Exercises onOpen={(id) => { setOpenId(id); }} onBack={() => setExView(false)} />;
  const mine = scores.filter((s) => !s.exercise);
  const known = new Set(folders.map((f) => f.id));
  const inFolder = (id: string | 'none') => mine.filter((s) => (id === 'none' ? !s.folder || !known.has(s.folder) : s.folder === id));
  const unsorted = inFolder('none');
  const groups: { id: string; name: string; list: ScoreFile[] }[] = filter === 'all'
    ? [...folders.map((f) => ({ id: f.id, name: f.name, list: inFolder(f.id) })).filter((g) => g.list.length > 0), ...(unsorted.length ? [{ id: 'none', name: '분류 안 됨', list: unsorted }] : [])]
    : [{ id: filter, name: filter === 'none' ? '분류 안 됨' : folderName(filter), list: inFolder(filter) }];
  const current = folders.find((f) => f.id === filter);

  async function newFolder() {
    const name = prompt('새 폴더 이름', '');
    if (name?.trim()) setFilter(await addFolder(name));
  }

  return (
    <section className="page score">
      <div className="card">
        <b>음계 · 포지션 · 에튀드</b>
        <p className="hint">1포지션 음계에서 3포지션, 포지션 이동, 에튀드, 세브치크식 활 연습까지 앱이 연습곡을 만들어 줘요.</p>
        <button className="primary wide" onClick={() => setExView(true)} data-testid="open-exercises">연습곡 만들기</button>
      </div>

      <div className="card">
        <div className="card-head">
          <b>내 악보 {mine.length}개</b>
          <button className="mini" onClick={() => setManage((m) => !m)} data-testid="folder-manage">{manage ? '완료' : '폴더 관리'}</button>
        </div>
        <div className="chips" data-testid="folder-chips">
          <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>전체 {mine.length}</button>
          {folders.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.name} {inFolder(f.id).length}</button>
          ))}
          {unsorted.length > 0 && <button className={`chip ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>분류 안 됨 {unsorted.length}</button>}
        </div>
        {manage && (
          <div className="folder-manage">
            <button className="secondary wide" onClick={newFolder} data-testid="folder-add">+ 새 폴더</button>
            {current ? (
              <div className="session-controls">
                <button onClick={async () => { const n = prompt('폴더 이름', current.name); if (n?.trim()) renameFolder(current.id, n); }}>이름 바꾸기</button>
                <button onClick={() => moveFolder(current.id, -1)} aria-label="앞으로">◀</button>
                <button onClick={() => moveFolder(current.id, 1)} aria-label="뒤로">▶</button>
                <button className="danger" onClick={() => { if (confirm(`"${current.name}" 폴더를 지울까요? 안의 악보는 지우지 않고 "분류 안 됨"으로 옮겨요.`)) { deleteFolder(current.id); setFilter('all'); } }}>폴더 지우기</button>
              </div>
            ) : <p className="hint">폴더를 하나 고르면 이름 바꾸기·순서·지우기를 할 수 있어요.</p>}
          </div>
        )}
        {filter === 'all' && mine.length === 0 && <p className="muted small">아직 없어요.</p>}
        {groups.map((g) => (
          <div key={g.id} className="folder-group" data-testid={`folder-${g.id}`}>
            {filter === 'all' && <div className="folder-title">{g.name} <span className="muted small">{g.list.length}</span></div>}
            {g.list.length === 0 && <p className="muted small">이 폴더에는 아직 악보가 없어요. 아래에서 불러오면 이 폴더에 들어가요.</p>}
            <ul className="rec-list">
              {g.list.map((s) => (
                <li key={s.id}>
                  <div className="rec-head">
                    <button className="link rec-title" onClick={() => setOpenId(s.id!)} data-testid="score-open">
                      <b>{s.title}</b>
                      <span className="muted small">{pieces.find((p) => p.id === s.pieceId)?.title ?? '곡 연결 없음'} · {new Date(s.createdAt).toLocaleDateString('ko-KR')}</span>
                    </button>
                    <select className="mini-select" value={s.folder && known.has(s.folder) ? s.folder : ''} onChange={(e) => moveScore(s.id!, e.target.value || undefined)} aria-label="폴더 옮기기" data-testid="score-folder">
                      <option value="">분류 안 됨</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button className="mini danger" onClick={() => { if (confirm('이 악보를 지울까요?')) db.scores.delete(s.id!); }} aria-label="악보 삭제">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="card">
        <b>악보 불러오기{filter !== 'all' && filter !== 'none' ? ` → ${folderName(filter)}` : ''}</b>
        <p className="hint">
          MusicXML 파일(.musicxml, .xml)을 고르세요. 악보는 <b>이 기기 안에만</b> 저장되고, 앱이나 GitHub에는 올라가지 않아요.
          (교재 악보는 저작권이 있어서 개인 연습용으로만 쓰세요.) 폴더를 골라 두면 그 폴더에 들어가고, 전체일 때는 연결한 곡의 권이나 제목으로 나눠 넣어요.
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
    </section>
  );
}

function ScoreView({ score, onClose }: { score: ScoreFile; onClose: () => void }) {
  const { settings } = useSettings();
  const pieces = usePieces();
  const piece = pieces.find((p) => p.id === score.pieceId);
  const myPart = score.part ?? 0;
  const parsed: ParsedScore = useMemo(() => parseMusicXML(score.xml, { part: myPart }), [score.xml, myPart]);
  const accParts: AccPart[] = useMemo(() => {
    const out: AccPart[] = [];
    parsed.parts.forEach((name, i) => { if (i !== myPart) { try { out.push({ score: parseMusicXML(score.xml, { part: i, allNotes: true }), inst: instFor(name) }); } catch { /* 무시 */ } } });
    if (score.accXml) {
      try {
        const head = parseMusicXML(score.accXml);
        head.parts.forEach((name, i) => out.push({ score: parseMusicXML(score.accXml!, { part: i, allNotes: true }), inst: instFor(name) }));
      } catch { /* 무시 */ }
    }
    return out;
  }, [score.xml, score.accXml, parsed, myPart]);
  const hasAcc = accParts.length > 0;
  const [accOn, setAccOn] = useState(true);
  const [mute, setMute] = useState(false);
  const [scoreWithAcc, setScoreWithAcc] = useState(false);
  const [view, setView] = useState<'pitch' | 'rhythm'>('pitch');
  const accFile = useRef<HTMLInputElement>(null);
  const [accError, setAccError] = useState<string | null>(null);
  async function attachAcc(f: File) {
    setAccError(null);
    try {
      const x = await f.text();
      const p = parseMusicXML(x, { allNotes: true });
      if (!p.notes.length) throw new Error('음표가 없는 악보예요.');
      await db.scores.update(score.id!, { accXml: x, accName: f.name.replace(/\.(musicxml|xml)$/i, '') });
    } catch (e) { setAccError((e as Error).message); } finally { if (accFile.current) accFile.current.value = ''; }
  }
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
  const [lenLock, setLenLock] = useState<number | null>(null);
  /** 일시정지한 음 번호 (null 이면 일시정지 아님) */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem('violin-score-focus') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('violin-score-focus', focus ? '1' : '0'); } catch { /* 무시 */ } }, [focus]);
  const [zoom, setZoom] = useState(() => { const d = typeof window !== 'undefined' && window.innerWidth >= 720 ? 1.3 : 1; try { return Number(localStorage.getItem('violin-score-zoom')) || d; } catch { return d; } });
  useEffect(() => { try { localStorage.setItem('violin-score-zoom', String(zoom)); } catch { /* 무시 */ } }, [zoom]);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useWakeLock(listening || playing, settings.wakeLock);
  const ex = score.exercise;
  const { session } = useSession();
  const runs = useScoreRuns(score.id);
  const runStart = useRef(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [recOn, setRecOn] = useState(() => { try { return localStorage.getItem('violin-score-rec') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('violin-score-rec', recOn ? '1' : '0'); } catch { /* 무시 */ } }, [recOn]);
  const step = ex ? STEPS.find((s) => s.id === ex.stepId) : undefined;
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  useEffect(() => { if (ex) setPlayBpm(ex.tempo); }, [ex?.stepId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (piece?.currentBpm) setPlayBpm(piece.currentBpm); else if (piece?.targetBpm) setPlayBpm(Math.round(piece.targetBpm * 0.7)); }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => scorePlayer.stop(), []);

  const expected = useMemo(() => notesInRange(parsed, from, to), [parsed, from, to]);

  const rhythm = useMemo(() => (result ? analyzeRhythm(parsed, result) : null), [result, parsed]);
  const noteColors = useMemo(() => {
    if (!result) return new Map<string, string>();
    if (view === 'rhythm' && rhythm) {
      const errs = new Map(rhythm.notes.map((n) => [n.key, n.err]));
      return new Map(result.map((r) => {
        const k = `${r.note.measure}:${r.note.index}`;
        const e = errs.get(k);
        return [k, e === undefined ? COLOR.missed : COLOR[rhythmTone(e)]];
      }));
    }
    return new Map(result.map((r) => [`${r.note.measure}:${r.note.index}`, colorFor(r)]));
  }, [result, view, rhythm]);

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
        osmd.current.zoom = zoom;
        if (parsed.parts.length > 1) showParts(osmd.current, myPart, !!score.showOthers);
        colorNotes(osmd.current, noteColors, myPart);
        osmd.current.render();
        els.current = noteElements(osmd.current, myPart);
        lit.current = [];
        setRenderError(null);
      } catch (e) {
        setRenderError('악보를 그리지 못했어요: ' + ((e as Error).message ?? ''));
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => { alive = false; };
  }, [score.xml, from, to, noteColors, myPart, score.showOthers, zoom, focus]); // eslint-disable-line react-hooks/exhaustive-deps

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
  async function playRange(resumeAt?: number, o: { keepListening?: boolean; muteMine?: boolean } = {}) {
    if (listening && !o.keepListening) stop();
    const full = planPlayback(parsed, { bpm: playBpm, from, to, countIn: o.keepListening ? true : resumeAt === undefined && countIn }, hasAcc && (accOn || o.keepListening) ? accParts : []);
    const plan = resumeAt === undefined ? full : slicePlan(full, resumeAt);
    const base = resumeAt ?? 0;
    setPausedAt(null);
    setPlaying(true);
    await scorePlayer.play(plan, {
      a4: settings.a4,
      click: withClick,
      voice,
      mute: o.muteMine ?? (hasAcc && mute),
      onNote: (e) => {
        if (e) curIdx.current = base + plan.events.indexOf(e);
        highlight(e ? `${e.note.measure}:${e.note.index}` : null);
        setNowMeasure(e ? e.note.measure : null);
      },
      onEnd: () => {
        if (o.keepListening) { highlight(null); setPlaying(false); setTimeout(() => stopRef.current(), 800); return; }
        if (loopRef.current) playRange(); else { highlight(null); setPlaying(false); }
      },
    });
    setVoiceNote(voice === 'sample' && !scorePlayer.usedSample ? '바이올린 소리를 불러오지 못해서 합성음으로 재생해요. (첫 재생은 인터넷 연결이 필요해요)' : '');
  }
  // 듣는 중에 템포를 바꾸면 지금 음부터 새 템포로 이어서
  const playingRef = useRef(false);
  playingRef.current = playing;
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  const firstBpm = useRef(true);
  useEffect(() => {
    if (firstBpm.current) { firstBpm.current = false; return; }
    if (!playingRef.current || listeningRef.current) return;
    const id = setTimeout(() => { if (playingRef.current) playRange(curIdx.current); }, 200);
    return () => clearTimeout(id);
  }, [playBpm]); // eslint-disable-line react-hooks/exhaustive-deps
  function stopPlay() { scorePlayer.stop(); highlight(null); setNowMeasure(null); setPlaying(false); setPausedAt(null); }
  function pausePlay() { scorePlayer.stop(); setPlaying(false); setPausedAt(curIdx.current); }
  function resumePlay() { const i = pausedAt ?? 0; setPausedAt(null); playRange(i); }
  function restartPlay() { setPausedAt(null); curIdx.current = 0; playRange(); }

  async function start() {
    if (playing) stopPlay();
    setResult(null);
    setSaved(null);
    played.current = [];
    if (!pitch.on) await pitch.start();
    runStart.current = Date.now();
    if (recOn) { try { await recorder.start(settings.a4); } catch { /* 녹음 못 해도 채점은 계속 */ } }
    setListening(true);
    if (hasAcc && scoreWithAcc) { curIdx.current = 0; playRange(undefined, { keepListening: true, muteMine: true }); }
  }
  function stop() {
    if (playingRef.current) stopPlay();
    setListening(false);
    // flush 는 effect 정리에서 → 다음 틱에 채점
    const recP = recorder.recording ? recorder.stop() : Promise.resolve(null);
    const durationSec = (Date.now() - runStart.current) / 1000;
    setTimeout(async () => {
      const r = alignNotes(expected, played.current);
      setResult(r);
      // 연습 기록 + 녹음 저장
      const rec = await recP;
      const sm = summarizeScore(r);
      const played_ = r.filter((x) => x.status !== 'missed').length;
      if (played_ >= 2 && durationSec >= 2) {
        const rh = analyzeRhythm(parsed, r);
        const weak = [...sm.byMeasure.entries()].filter(([, v]) => v !== null).sort((a, b) => b[1]! - a[1]!).slice(0, 3).map(([m]) => m);
        const run: ScoreRun = {
          createdAt: Date.now(), date: localDate(), scoreId: score.id!, title: score.title, pieceId: score.pieceId, exerciseId: ex?.stepId,
          from, to, durationSec, total: sm.total, ok: sm.ok, wrong: sm.wrong, missed: sm.missed, meanAbs: sm.meanAbs,
          rhythmMs: rh?.meanAbsMs ?? null, bpm: rh ? Math.round(rh.bpm) : null, inSession: !!session, weakMeasures: weak,
        };
        const runId = await db.scoreRuns.add(run);
        let recId: number | undefined;
        if (rec && rec.durationSec >= 1) {
          recId = await db.recordings.add({
            createdAt: run.createdAt, date: run.date, pieceId: score.pieceId, title: `${score.title} · ${from}~${to}마디`,
            durationSec: rec.durationSec, mime: rec.mime, blob: rec.blob, track: rec.track, scoreId: score.id!, runId,
          } as Recording);
          await db.scoreRuns.update(runId, { recordingId: recId });
        }
        if (score.pieceId) await db.pieces.update(score.pieceId, { lastPracticed: run.date });
        setSaved(recId ? '연습 기록과 녹음을 저장했어요.' : '연습 기록을 저장했어요.');
      }
      if (ex && from <= firstNoteMeasure && to >= last && r.length) {
        const sm = summarizeScore(r);
        const pct = Math.round((sm.ok / Math.max(1, sm.total)) * 100);
        recordProgress(ex.progressId ?? ex.stepId, pct, sm.meanAbs, playBpm).then((ok) => setPassMsg(ok ? '통과! 다음 단계로 가거나 템포를 올려 보세요.' : null));
      }
    }, 0);
  }
  // 화면을 떠날 때 녹음 정리
  useEffect(() => () => { if (recorder.recording) recorder.stop(); }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const setRange = (a: number, b: number) => {
    if (playingRef.current || pausedAt !== null) stopPlay();
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
    <section className={`page score score-view ${focus ? 'focus' : ''}`} data-testid="score-view">
      <div className="score-top">
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
        <div className="range-row">
          <span className="rg"><span className="range-label">시작</span>
          <NumField value={from} min={first} max={last} label="시작 마디" testId="from" width={52} onChange={(v) => setRange(v, lenLock ? v + lenLock - 1 : Math.max(v, to))} /></span>
          <span className="rg"><span className="range-label">끝</span>
          <NumField value={to} min={from} max={last} label="끝 마디" testId="to" width={52} onChange={(v) => { setLenLock(null); setRange(from, v); }} /></span>
          <span className="muted small">{span}마디 · {expected.length}음</span>
        </div>
        <div className="chips len-chips" data-testid="len-chips">
          {[1, 2, 4, 8, 16].map((n) => (
            <button key={n} className={`chip ${lenLock === n ? 'on' : ''}`} onClick={() => { setLenLock(n); setRange(from, from + n - 1); }}>{n}마디</button>
          ))}
        </div>
        <div className="session-controls">
          <button onClick={() => setRange(from - span, to - span)} disabled={from <= first}>◀ 앞 구간</button>
          <button onClick={() => { setLenLock(null); setRange(firstNoteMeasure, last); }}>전체</button>
          <button onClick={() => setRange(from + span, to + span)} disabled={to >= last}>다음 구간 ▶</button>
        </div>
      </div>

      <div className="card" data-testid="play-card">
        <div className="card-head"><b>악보 듣기</b>{playing && nowMeasure !== null && <span className="muted small">{nowMeasure}마디</span>}</div>
        <div className="row-setting">
          <span>♩ =</span>
          <NumField value={playBpm} min={30} max={200} step={5} label="재생 템포" testId="play-bpm" onChange={setPlayBpm} />
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
        {hasAcc && (
          <div className="row-setting">
            <label><input type="checkbox" checked={accOn} onChange={(e) => setAccOn(e.target.checked)} data-testid="acc-on" /> 반주 같이</label>
            <label><input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} data-testid="acc-mute" /> 내 파트 소리 끄기</label>
          </div>
        )}
        {voiceNote && <p className="hint">{voiceNote}</p>}
        <button className={`secondary wide ${playing ? 'on' : ''}`} onClick={playing || pausedAt !== null ? stopPlay : () => { curIdx.current = 0; playRange(); }} disabled={!expected.length} data-testid="play-toggle">
          {playing || pausedAt !== null ? '■ 듣기 멈추기' : `▶ ${from}~${to}마디 들어보기`}
        </button>
        <p className="hint">템포는 4분음표 기준이에요. 처음엔 느리게 들으며 음정과 리듬을 익히고, 반복을 켜 두고 같이 연주해 보세요.</p>
      </div>

      <div className="card">
        {!listening ? (
          <button className="primary wide big" onClick={start} disabled={!expected.length} data-testid="score-start">● 이 구간 연주하고 채점받기</button>
        ) : (
          <>
            <div className="rec-live"><span className="rec-dot" /> {recorder.recording ? '녹음 · ' : ''}듣는 중 · {liveDone}/{expected.length}음</div>
            <div className="progress"><div style={{ width: `${(liveDone / Math.max(1, expected.length)) * 100}%` }} /></div>
            <button className="primary wide big stop" onClick={stop} data-testid="score-stop">■ 끝내고 채점</button>
          </>
        )}
        {!listening && (
          <label className="small"><input type="checkbox" checked={recOn} onChange={(e) => setRecOn(e.target.checked)} data-testid="score-rec" /> 연주를 녹음해서 연습 기록 · 녹음에 함께 저장</label>
        )}
        {hasAcc && !listening && (
          <label className="small"><input type="checkbox" checked={scoreWithAcc} onChange={(e) => setScoreWithAcc(e.target.checked)} data-testid="score-with-acc" /> 반주를 틀고 같이 연주하며 채점 (이어폰을 쓰면 반주 소리가 섞이지 않아요)</label>
        )}
        {pitch.error && <p className="error">{pitch.error}</p>}
        <p className="hint">템포는 상관없어요. 악보 순서대로 연주하면 음을 맞춰 보고, 음표 색으로 보여줘요. 초록 ±10센트 안, 노랑 ±20, 빨강 그 이상, 보라 다른 음, 회색 놓친 음. 박자도 함께 봐요: 내 템포에 맞춰 각 음이 일찍·늦게 들어갔는지.</p>
      </div>

      </div>
      <div className="score-main">
      <div className="sheet-bar">
        <span className="muted small">{from}~{to}마디{nowMeasure !== null ? ` · 지금 ${nowMeasure}마디` : ''}</span>
        <span className="zoom">
          <button className={`mini ${focus ? 'on' : ''}`} onClick={() => setFocus(!focus)} data-testid="focus-toggle">{focus ? '메뉴 보기' : '악보만'}</button>
          <button className="mini" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} aria-label="악보 작게">가−</button>
          <button className="mini" onClick={() => setZoom(1)} aria-label="악보 기본 크기">{Math.round(zoom * 100)}%</button>
          <button className="mini" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} aria-label="악보 크게">가+</button>
        </span>
      </div>
      <div className="score-sheet">
        {rendering && <p className="muted small">악보를 그리는 중…</p>}
        {renderError && <p className="error">{renderError}</p>}
        <div ref={holder} data-testid="osmd" />
      </div>
      </div>

      <div className="score-bottom">
      {sum && (
        <div className="card" data-testid="score-result">
          <div className="stats">
            <div><b>{Math.round((sum.ok / Math.max(1, sum.total)) * 100)}%</b><span>맞은 음 {sum.ok}/{sum.total}</span></div>
            <div><b>{sum.meanAbs === null ? '—' : `±${Math.round(sum.meanAbs)}`}</b><span>평균 오차(센트)</span></div>
            <div><b>{sum.wrong + sum.missed}</b><span>다른 음·놓침</span></div>
          </div>
          {rhythm && (
            <div className="stats" data-testid="rhythm-stats">
              <div><b>♩≈{Math.round(rhythm.bpm)}</b><span>내 템포</span></div>
              <div><b className={rhythmTone(rhythm.meanAbs)}>±{Math.round(rhythm.meanAbsMs)}ms</b><span>박자 오차 (박의 {Math.round(rhythm.meanAbs * 100)}%)</span></div>
              <div><b>{rhythm.drift === null ? '—' : Math.abs(rhythm.drift) < 0.04 ? '고름' : rhythm.drift > 0 ? `${Math.round(rhythm.drift * 100)}% 빨라짐` : `${Math.round(-rhythm.drift * 100)}% 느려짐`}</b><span>뒤로 갈수록</span></div>
            </div>
          )}
          {rhythm && (
            <div className="segmented small">
              <button className={view === 'pitch' ? 'on' : ''} onClick={() => setView('pitch')} data-testid="view-pitch">음정으로 보기</button>
              <button className={view === 'rhythm' ? 'on' : ''} onClick={() => setView('rhythm')} data-testid="view-rhythm">박자로 보기</button>
            </div>
          )}
          {passMsg && <p className="good"><b>✓ {passMsg}</b></p>}
          {saved && <p className="small muted" data-testid="run-saved">✓ {saved}</p>}
          {shiftRes.length > 0 && (
            <p className="small" data-testid="shift-stats">
              포지션 이동 음 {shiftOk.length}/{shiftRes.length}개 맞음{shiftMean !== null && <> · 평균 <b className={tone(shiftMean)}>±{Math.round(shiftMean)}센트</b></>}
              {shiftMean !== null && shiftMean > 15 ? ' — 도착하는 손가락 음정을 드론과 함께 천천히 확인해 보세요.' : ''}
            </p>
          )}
          <b>마디별 {view === 'rhythm' && rhythm ? '박자 (ms)' : '음정 (센트)'}</b>
          <div className="chips">
            {view === 'rhythm' && rhythm ? [...rhythm.byMeasure.entries()].map(([m, v]) => (
              <button key={m} className={`chip measure-chip ${rhythmTone(v)}`} onClick={() => setRange(m, m)} title="이 마디만 다시">
                {m}<small>±{Math.round((v * 60000) / rhythm.bpm)}</small>
              </button>
            )) : [...sum.byMeasure.entries()].map(([m, v]) => (
              <button key={m} className={`chip measure-chip ${tone(v)}`} onClick={() => setRange(m, m)} title="이 마디만 다시">
                {m}<small>{v === null ? '—' : `±${Math.round(v)}`}</small>
              </button>
            ))}
          </div>
          {view === 'rhythm' && rhythm && (
            <>
              <b>박자가 가장 벗어난 음</b>
              <table className="tbl" data-testid="rhythm-worst">
                <thead><tr><th>마디</th><th>음</th><th>박자</th></tr></thead>
                <tbody>{[...rhythm.notes].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 6).map((n) => {
                  const r = result!.find((x) => `${x.note.measure}:${x.note.index}` === n.key);
                  const ms = Math.round((n.err * 60000) / rhythm.bpm);
                  return <tr key={n.key}><td>{n.measure}</td><td>{r ? midiName(r.note.midi) : ''}</td><td className={rhythmTone(n.err)}>{ms > 0 ? `${ms}ms 늦게` : `${-ms}ms 일찍`}</td></tr>;
                })}</tbody>
              </table>
              <p className="hint">템포가 조금씩 바뀌는 건 괜찮고, 주변 음들보다 혼자 당기거나 끄는 음을 찾아요. 초록 박의 6% 안, 노랑 12%, 빨강 그 이상.</p>
            </>
          )}
          {view === 'pitch' && worst.length > 0 && (
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

      <RunHistory runs={runs} onPick={(r) => setRange(r.from, r.to)} />
      <div className="card" data-testid="acc-card">
        <b>파트 · 반주</b>
        {parsed.parts.length > 1 && (
          <>
            <div className="row-setting">
              <span>내 파트</span>
              <select value={myPart} onChange={(e) => { db.scores.update(score.id!, { part: Number(e.target.value) }); setResult(null); }} aria-label="내 파트" data-testid="my-part">
                {parsed.parts.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </div>
            <label className="small"><input type="checkbox" checked={!!score.showOthers} onChange={(e) => db.scores.update(score.id!, { showOthers: e.target.checked })} /> 다른 파트도 악보에 보이기</label>
          </>
        )}
        {score.accXml ? (
          <div className="rec-head">
            <span className="small">반주: <b>{score.accName || '반주 악보'}</b></span>
            <button className="mini danger" onClick={() => db.scores.update(score.id!, { accXml: undefined, accName: undefined })} aria-label="반주 지우기">✕</button>
          </div>
        ) : (
          <button className="secondary wide" onClick={() => accFile.current?.click()} data-testid="acc-attach">반주 악보 붙이기 (MusicXML)</button>
        )}
        <input ref={accFile} type="file" accept=".musicxml,.xml" hidden onChange={(e) => e.target.files?.[0] && attachAcc(e.target.files[0])} data-testid="acc-file" />
        {accError && <p className="error">{accError}</p>}
        <p className="hint">{hasAcc ? `반주 ${accParts.length}파트 · 피아노 파트는 피아노 소리, 그 밖은 바이올린 소리로 들려줘요.` : '바흐 더블의 2바이올린 파트나 피아노 반주를 붙이면 같이 들으며 연습할 수 있어요. 마디 번호가 같은 악보여야 해요.'}</p>
      </div>

      </div>

      {(focus || playing || pausedAt !== null || listening) && (
        <div className="float-ctl" data-testid="float-ctl" role="toolbar" aria-label="재생 조작">
          {listening ? (
            <>
              <span className="float-info"><span className="rec-dot" /> {liveDone}/{expected.length}음</span>
              <button className="primary" onClick={stop} data-testid="float-stop-score">■ 끝내고 채점</button>
            </>
          ) : !playing && pausedAt === null ? (
            <>
              <button className="mini" onClick={() => setRange(from - span, to - span)} disabled={from <= first} aria-label="앞 구간">‹</button>
              <span className="float-info">{from}~{to}마디</span>
              <button className="mini" onClick={() => setRange(from + span, to + span)} disabled={to >= last} aria-label="다음 구간">›</button>
              <button className="primary" onClick={() => { curIdx.current = 0; playRange(); }} disabled={!expected.length} data-testid="float-play">▶ 듣기</button>
              <button onClick={start} disabled={!expected.length} data-testid="float-score">● 채점</button>
            </>
          ) : (
            <>
              <span className="float-info">{nowMeasure ?? from}마디 · ♩{playBpm}</span>
              <button className="mini" onClick={() => setPlayBpm((b) => Math.max(30, b - 5))} aria-label="느리게">−</button>
              <button className="mini" onClick={() => setPlayBpm((b) => Math.min(200, b + 5))} aria-label="빠르게">+</button>
              {playing
                ? <button className="primary" onClick={pausePlay} data-testid="float-pause">❚❚ 멈춤</button>
                : <button className="primary" onClick={resumePlay} data-testid="float-resume">▶ 이어서</button>}
              <button onClick={restartPlay} aria-label="처음부터" data-testid="float-restart">⏮</button>
              <button onClick={stopPlay} aria-label="정지" data-testid="float-stop">■</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}


function RecPlayer({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    db.recordings.get(id).then((r) => { if (r) { u = URL.createObjectURL(r.blob); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <audio controls src={url} preload="metadata" className="player" /> : <p className="muted small">녹음이 지워졌어요.</p>;
}

/** 이 악보의 연습 기록 (최근 순) */
function RunHistory({ runs, onPick }: { runs: ScoreRun[]; onPick: (r: ScoreRun) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (!runs.length) return null;
  const list = all ? runs : runs.slice(0, 5);
  return (
    <div className="card" data-testid="run-history">
      <div className="card-head"><b>이 악보 연습 기록 {runs.length}번</b></div>
      <ul className="rec-list">
        {list.map((r) => (
          <li key={r.id}>
            <div className="rec-head">
              <button className="link rec-title" onClick={() => setOpen(open === r.id ? null : r.id!)}>
                <b>{runText(r)}</b>
                <span className="muted small">{new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {clock(r.durationSec)}{r.bpm ? ` · ♩≈${r.bpm}` : ''}{r.recordingId ? ' · 녹음 있음' : ''}</span>
              </button>
              <button className="mini" onClick={() => onPick(r)} title="이 구간으로">구간</button>
              <button className="mini danger" onClick={() => { if (confirm('이 연습 기록을 지울까요? (녹음은 녹음 목록에 남아요)')) db.scoreRuns.delete(r.id!); }} aria-label="기록 삭제">✕</button>
            </div>
            {open === r.id && (
              <div className="rec-body">
                {r.weakMeasures?.length ? <p className="small">가장 벗어난 마디: {r.weakMeasures.join(', ')}</p> : null}
                {r.recordingId ? <RecPlayer id={r.recordingId} /> : <p className="muted small">녹음 없이 채점만 했어요.</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {runs.length > 5 && <button className="link small" onClick={() => setAll(!all)}>{all ? '접기' : `전체 ${runs.length}개 보기`}</button>}
    </div>
  );
}
