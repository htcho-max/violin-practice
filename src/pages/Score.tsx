import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { db, loadScoreList, type ScoreFile, type ScoreMeta } from '../data/db';
import { parseMusicXML, notesInRange, applyUserMarks, type ParsedScore } from '../score/parse';
import { markEmpty, type UserMark, type UserMarks } from '../score/dynamics';
import { DraftInput } from '../components/DraftInput';
import { editNote, revertMeasure, shiftMarksAfterRest, type EditOp, type NoteType } from '../score/edit';
import { alignNotes, summarizeScore, type Played, type Scored } from '../score/align';
import { createOSMD, colorNotes, noteElements, showParts, paintNotes } from '../score/osmd';
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
import { toRunNotes, weakSpots, ladderKey, ladderBpm, ladderStep, newLadder, LADDER_PCTS, meanDb, type DrillLadder } from '../score/practice';
import { useDrills, saveDrill } from '../state/useDrills';
import { takeScoreRequest, type ScoreOpenRequest } from '../state/openRequest';
import { LessonNotesCard, LessonChecklist, useLessonNotes } from '../components/LessonNotes';
import { ScoreProgress } from '../components/ScoreProgress';
import { DynChart } from '../components/DynChart';
import { useFolders, guessFolder, folderForBook, addFolder, renameFolder, deleteFolder, moveFolder, moveScore } from '../data/folders';

function useScores(): ScoreMeta[] {
  const [rows, setRows] = useState<ScoreMeta[]>([]);
  useEffect(() => {
    const sub = liveQuery(loadScoreList).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}
/** 연 악보 하나만 통째로 (XML 포함) */
function useScoreFile(id: number | null): ScoreFile | null | undefined {
  const [row, setRow] = useState<ScoreFile | null | undefined>(id === null ? null : undefined);
  useEffect(() => {
    if (id === null) { setRow(null); return; }
    setRow(undefined);
    const sub = liveQuery(() => db.scores.get(id)).subscribe({ next: (r) => setRow(r ?? null), error: () => setRow(null) });
    return () => sub.unsubscribe();
  }, [id]);
  return row;
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
  const openFile = useScoreFile(openId);
  const open = openFile ?? null;
  // 오늘의 연습에서 연습곡을 바로 열기
  useEffect(() => { const p = takePending(); if (p) p().then((id) => { setExView(true); setOpenId(id); }).catch(() => {}); }, []);
  // 오늘 화면에서 약한 마디 집중 연습으로 바로 열기
  const [openReq, setOpenReq] = useState<ScoreOpenRequest | null>(null);
  useEffect(() => { const r = takeScoreRequest(); if (r) { setOpenReq(r); setOpenId(r.scoreId); } }, []);
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

  // 연습곡 화면 층이 먼저 (악보가 그 위에)
  useBackLayer(exView, () => setExView(false));
  useBackLayer(!!open, () => { const o = open; setOpenId(null); setExView(!!o?.exercise); });
  if (openId !== null && openFile === undefined) return <section className="page score"><p className="muted">악보를 여는 중…</p></section>;
  if (open) return <ScoreView key={`${open.id}:${open.createdAt}`} score={open} initial={openReq && openReq.scoreId === open.id ? openReq : undefined} onClose={() => { setOpenId(null); setOpenReq(null); setExView(!!open.exercise); }} />;
  if (exView) return <Exercises onOpen={(id) => { setOpenId(id); }} onBack={() => setExView(false)} />;
  const mine = scores.filter((s) => !s.exercise);
  const known = new Set(folders.map((f) => f.id));
  const inFolder = (id: string | 'none') => mine.filter((s) => (id === 'none' ? !s.folder || !known.has(s.folder) : s.folder === id));
  const unsorted = inFolder('none');
  const groups: { id: string; name: string; list: ScoreMeta[] }[] = filter === 'all'
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

function ScoreView({ score, onClose, initial }: { score: ScoreFile; onClose: () => void; initial?: ScoreOpenRequest }) {
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
  /** 재생용: 내가 붙인 표시(활·셈여림)를 합친 악보 */
  const playParsed = useMemo(() => applyUserMarks(parsed, score.marks), [parsed, score.marks]);
  const [accOn, setAccOn] = useState(true);
  const [mute, setMute] = useState(false);
  const [scoreWithAcc, setScoreWithAcc] = useState(false);
  const [view, setView] = useState<'pitch' | 'rhythm' | 'dyn'>('pitch');
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
  const pitch = usePitch(settings.minDb, { reading: false });
  const [listening, setListening] = useState(false);
  const played = useRef<Played[]>([]);
  const [, tick] = useState(0);
  const [result, setResult] = useState<Scored[] | null>(null);
  const els = useRef<Map<string, string[]>>(new Map());
  const lit = useRef<SVGGElement[]>([]);
  const litKey = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playBpm, setPlayBpm] = useState(72);
  const [withClick, setWithClick] = useState(false);
  /** 채점할 때 박자: 끔 / 깜빡임만 / 소리 */
  const [scoreMetro, setScoreMetroS] = useState<'off' | 'visual' | 'sound'>(() => { try { const v = localStorage.getItem('score-metro'); return v === 'visual' || v === 'sound' ? v : 'off'; } catch { return 'off'; } });
  const setScoreMetro = (v: 'off' | 'visual' | 'sound') => { setScoreMetroS(v); try { localStorage.setItem('score-metro', v); } catch { /* 무시 */ } };
  const beatDot = useRef<HTMLSpanElement | null>(null);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBeat = (_k: number, accent: boolean) => {
    const el = beatDot.current; if (!el) return;
    el.classList.remove('on', 'accent'); void el.offsetWidth; el.classList.add('on'); if (accent) el.classList.add('accent');
    if (beatTimer.current) clearTimeout(beatTimer.current);
    beatTimer.current = setTimeout(() => el.classList.remove('on', 'accent'), 140);
  };
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
  // 약한 마디 · 템포 사다리
  const ladders = useDrills();
  const laddersRef = useRef(ladders);
  laddersRef.current = ladders;
  const [drill, setDrill] = useState<{ measure: number; from: number; to: number } | null>(null);
  const drillRef = useRef(drill);
  drillRef.current = drill;
  const [drillMsg, setDrillMsg] = useState<string | null>(null);
  const weak = useMemo(() => {
    const since: Record<number, number> = {};
    for (const [k, l] of Object.entries(ladders)) { const [sid, m] = k.split(':').map(Number); if (sid === score.id && l.done) since[m] = l.at; }
    return weakSpots(runs, { sinceByMeasure: since });
  }, [runs, ladders, score.id]);
  const lessonNotes = useLessonNotes(score.id);
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

  // 확대·크기 변화는 잠깐 모았다가 한 번만 다시 그리기
  const [zoomView, setZoomView] = useState(zoom);
  useEffect(() => { const id = setTimeout(() => setZoomView(zoom), 250); return () => clearTimeout(id); }, [zoom]);
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    const el = holder.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth, id: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 8) return; // 주소창이 나타났다 사라지는 정도는 무시
      w = el.clientWidth;
      if (id) clearTimeout(id);
      id = setTimeout(() => setSizeTick((x) => x + 1), 300);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (id) clearTimeout(id); };
  }, []);
  const osmdInit = useRef<Promise<void> | null>(null);
  // 내 표시: 편집 모드, 고르는 음, 그려진 자리
  const [renderTick, setRenderTick] = useState(0);
  /** 악보 누르기 도구: 없음(누른 음부터 듣기·채점) / 내 표시 / 음 고치기 */
  const [tool, setTool] = useState<'none' | 'mark' | 'edit'>('none');
  const markMode = tool === 'mark';
  const [markKey, setMarkKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editMsg, setEditMsg] = useState('');
  const [hereKey, setHereKey] = useState<string | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ m: number; act: 'play' | 'score' } | null>(null);
  const sheetWrap = useRef<HTMLDivElement>(null);
  const [markPos, setMarkPos] = useState<{ key: string; x: number; top: number; bottom: number; m: UserMark }[]>([]);
  const marks: UserMarks = score.marks ?? {};
  /** 음표 자리: 머리(가로 위치·누르기)와 기둥까지 포함한 위·아래 */
  const noteRect = (key: string): { left: number; right: number; top: number; bottom: number; outTop: number; outBottom: number } | null => {
    const ids = els.current.get(key) ?? [];
    for (const id of ids) { // 붙임줄 뒤 음은 빼고 첫 음만
      const el = document.getElementById(id) ?? document.getElementById(`vf-${id}`);
      if (!el) continue;
      const g = el.getBoundingClientRect();
      const heads = Array.from(el.querySelectorAll('.vf-notehead')).map((h) => h.getBoundingClientRect()).filter((r) => r.width || r.height);
      const r = heads.length ? { left: Math.min(...heads.map((h) => h.left)), right: Math.max(...heads.map((h) => h.right)), top: Math.min(...heads.map((h) => h.top)), bottom: Math.max(...heads.map((h) => h.bottom)) } : g;
      if (!(g.width || g.height)) continue;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, outTop: Math.min(g.top, r.top), outBottom: Math.max(g.bottom, r.bottom) };
    }
    return null;
  };
  useEffect(() => {
    const wrap = sheetWrap.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const out: typeof markPos = [];
    for (const [key, m] of Object.entries(marks)) {
      if (markEmpty(m)) continue;
      const r = noteRect(key);
      if (!r) continue;
      out.push({ key, x: (r.left + r.right) / 2 - base.left, top: r.outTop - base.top, bottom: r.outBottom - base.top, m });
    }
    setMarkPos(out);
  }, [renderTick, score.marks]); // eslint-disable-line react-hooks/exhaustive-deps
  // 레슨 노트가 붙은 마디: 첫 음 왼쪽 위에 📝
  const [lessonPos, setLessonPos] = useState<{ m: number; x: number; top: number; n: number }[]>([]);
  useEffect(() => {
    const wrap = sheetWrap.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const cnt = new Map<number, number>();
    for (const n of lessonNotes) if (!n.done && n.measure !== undefined && n.measure >= from && n.measure <= to) cnt.set(n.measure, (cnt.get(n.measure) ?? 0) + 1);
    const out: typeof lessonPos = [];
    for (const [m, n] of cnt) {
      const key = [...els.current.keys()].find((k) => k.startsWith(`${m}:`));
      const r = key ? noteRect(key) : null;
      if (!r) continue;
      out.push({ m, x: r.left - base.left - 6, top: r.outTop - base.top - 22, n });
    }
    setLessonPos(out);
  }, [renderTick, lessonNotes]); // eslint-disable-line react-hooks/exhaustive-deps
  function pickNote(clientX: number, clientY: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const key of els.current.keys()) {
      const r = noteRect(key);
      if (!r) continue;
      const dx = Math.max(r.left - clientX, 0, clientX - r.right), dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
      const d = Math.hypot(dx, dy * 0.6);
      if (d < bd) { bd = d; best = key; }
    }
    return best && bd <= 28 ? best : null;
  }
  function onSheetTap(clientX: number, clientY: number) {
    const k = pickNote(clientX, clientY);
    if (!k) { setHereKey(null); return; }
    if (tool === 'mark') setMarkKey(k);
    else if (tool === 'edit') { setEditMsg(''); setEditKey(k); }
    else if (!listening && !playing) setHereKey(k);
  }
  /** 음 고치기 적용 (처음 고칠 때 원래 악보를 따로 둠) */
  async function applyEdit(key: string, op: EditOp) {
    const [m, i] = key.split(':').map(Number);
    const r = editNote(score.xml, m, i, op, myPart);
    if ('error' in r) { setEditMsg(r.error); return; }
    setEditMsg('');
    setResult(null);
    const patch: Partial<ScoreFile> = { xml: r.xml, origXml: score.origXml ?? score.xml };
    if (op.kind === 'rest') { patch.marks = shiftMarksAfterRest(score.marks, m, i); setEditKey(null); }
    await db.scores.update(score.id!, patch);
  }
  async function revertBar(key: string) {
    if (!score.origXml) return;
    const m = Number(key.split(':')[0]);
    const r = revertMeasure(score.xml, score.origXml, m, myPart);
    if ('error' in r) { setEditMsg(r.error); return; }
    setResult(null);
    await db.scores.update(score.id!, { xml: r.xml });
  }
  async function revertAll() {
    if (!score.origXml || !confirm('고친 음을 모두 버리고 처음 악보로 되돌릴까요?')) return;
    setResult(null); setEditKey(null);
    await db.scores.update(score.id!, { xml: score.origXml, origXml: undefined });
  }
  // 누른 음부터: 구간을 옮긴 뒤 다음 화면에서 듣기·채점 시작
  function startFrom(key: string, act: 'play' | 'score') {
    const m = Number(key.split(':')[0]);
    setHereKey(null);
    setRange(m, m + (lenLock ?? span) - 1);
    setPendingFrom({ m, act });
  }
  async function saveMark(key: string, patch: Partial<UserMark> | null) {
    const cur = { ...(score.marks ?? {}) };
    const next: UserMark = patch === null ? {} : { ...cur[key], ...patch };
    for (const k of Object.keys(next) as (keyof UserMark)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    if (markEmpty(next)) delete cur[key]; else cur[key] = next;
    await db.scores.update(score.id!, { marks: cur });
  }
  useBackLayer(markKey !== null, () => setMarkKey(null));
  useBackLayer(editKey !== null, () => setEditKey(null));
  useBackLayer(hereKey !== null, () => setHereKey(null));
  useEffect(() => {
    if (!pendingFrom || from !== pendingFrom.m) return;
    const act = pendingFrom.act;
    setPendingFrom(null);
    if (act === 'play') { curIdx.current = 0; playRangeRef.current(); } else void startRef.current();
  }, [pendingFrom, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { osmd.current?.clear(); } catch { /* 무시 */ } osmd.current = null; }, []);

  // 악보 그리기
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!osmdInit.current && holder.current) {
          const el = holder.current;
          osmdInit.current = (async () => { const o = await createOSMD(el); await o.load(score.xml); osmd.current = o; })();
        }
        await osmdInit.current;
        if (!alive || !osmd.current) return;
        setRendering(true);
        osmd.current.setOptions({ drawFromMeasureNumber: from, drawUpToMeasureNumber: to });
        osmd.current.zoom = zoomView;
        if (parsed.parts.length > 1) showParts(osmd.current, myPart, !!score.showOthers);
        // 색은 그린 뒤 SVG 에 직접 칠함 (채점 결과만 바뀔 때 다시 그리지 않게)
        colorNotes(osmd.current, new Map(), myPart);
        osmd.current.render();
        els.current = noteElements(osmd.current, myPart);
        setRenderTick((x) => x + 1);
        lit.current = [];
        if (litKey.current) highlight(litKey.current, false); // 다시 그려도 지금 음 강조 유지
        setRenderError(null);
      } catch (e) {
        setRenderError('악보를 그리지 못했어요: ' + ((e as Error).message ?? ''));
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => { alive = false; };
  }, [score.xml, from, to, myPart, score.showOthers, zoomView, focus, sizeTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 음표 색: 다시 그린 뒤나 채점 결과·보기가 바뀔 때 칠하기만
  useEffect(() => { paintNotes(els.current, noteColors, holder.current ?? document); }, [noteColors, renderTick]);

  useEffect(() => {
    const id = setTimeout(() => { db.scores.update(score.id!, { lastFrom: from, lastTo: to }).catch(() => {}); }, 1500);
    return () => clearTimeout(id);
  }, [score.id, from, to]);

  // 연주 듣기: 음 단위로 모으기
  const segRef = useRef<NoteSegmenter | null>(null);
  /** 채점하는 동안 소리 크기 [초, dB] (셈여림 비교용) */
  const dbTrack = useRef<[number, number][]>([]);
  /** 채점을 시작할 때의 구간 (듣는 중에 구간을 바꿔도 채점은 이 구간으로) */
  const listenCtx = useRef<{ expected: typeof expected; from: number; to: number; inSession: boolean } | null>(null);

  useEffect(() => {
    if (!listening) return;
    const seg = new NoteSegmenter(equalRef(settings.a4));
    segRef.current = seg;
    dbTrack.current = [];
    const unsub = pitchTracker.subscribe((r) => {
      if (r.freq !== null && Number.isFinite(r.db)) dbTrack.current.push([r.time, r.db]);
      const n = seg.push(r.time, r.freq);
      if (n) { played.current.push({ midi: n.midi, cents: n.settledCents ?? n.meanCents, start: n.start, db: meanDb(dbTrack.current, n.start + 0.05, n.end) }); tick((x) => x + 1); }
    });
    return unsub;
  }, [listening, settings.a4]);

  // 진행 표시: 짧은 구간은 정확히 맞춰 보고, 긴 구간은 연주한 음 수로 대신 (매 음마다 전체 맞추기는 무거움)
  const live = useMemo(() => {
    if (!listening) return 0;
    const exp = listenCtx.current?.expected ?? expected;
    if (exp.length <= 160) return alignNotes(exp, played.current).filter((r) => r.status !== 'missed').length;
    let n = 0, last = -1;
    for (const p of played.current) { if (p.midi !== last) n++; last = p.midi; }
    return Math.min(exp.length, n);
  }, [listening, expected, played.current.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveDone = live;

  function highlight(key: string | null, scroll = true) {
    litKey.current = key;
    lit.current.forEach((g) => g.classList.remove('now-note'));
    const ids = key ? els.current.get(key) ?? [] : [];
    lit.current = ids.map((id) => document.getElementById(id) ?? document.getElementById(`vf-${id}`)).filter((x): x is HTMLElement & SVGGElement => !!x) as unknown as SVGGElement[];
    lit.current.forEach((g) => g.classList.add('now-note'));
    if (scroll) lit.current[0]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  const curIdx = useRef(0);
  async function playRange(resumeAt?: number, o: { keepListening?: boolean; muteMine?: boolean; click?: boolean | 'visual'; acc?: boolean } = {}) {
    if (listening && !o.keepListening) stop();
    const full = planPlayback(playParsed, { bpm: playBpm, from, to, countIn: o.keepListening ? true : resumeAt === undefined && countIn }, hasAcc && (o.keepListening ? o.acc : accOn) ? accParts : []);
    const plan = resumeAt === undefined ? full : slicePlan(full, resumeAt);
    const base = resumeAt ?? 0;
    setPausedAt(null);
    setPlaying(true);
    await scorePlayer.play(plan, {
      a4: settings.a4,
      click: o.click ?? withClick,
      onBeat,
      voice,
      mute: o.muteMine ?? (hasAcc && mute),
      onNote: (e, idx) => {
        if (e) curIdx.current = base + (idx ?? plan.events.indexOf(e));
        highlight(e ? `${e.note.measure}:${e.note.index}` : null);
        setNowMeasure(e ? e.note.measure : null);
      },
      onEnd: () => {
        if (o.keepListening) {
          highlight(null); setPlaying(false);
          endTimer.current = setTimeout(() => { endTimer.current = null; stopRef.current(); }, o.acc ? 800 : 1500);
          return;
        }
        if (loopRef.current) playRangeRef.current(); else { highlight(null); setPlaying(false); }
      },
    });
    setVoiceNote(voice === 'sample' && !scorePlayer.usedSample ? '바이올린 소리를 불러오지 못해서 합성음으로 재생해요. (첫 재생은 인터넷 연결이 필요해요)' : '');
  }
  const playRangeRef = useRef(playRange);
  playRangeRef.current = playRange;
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (listeningRef.current) return;
    if (playing || pausedAt !== null) stopPlay();
    setResult(null);
    setSaved(null);
    setPassMsg(null);
    played.current = [];
    if (!pitchTracker.running) await pitch.start();
    if (!pitchTracker.running) return; // 마이크를 못 열면 시작하지 않음 (오류 문구는 pitch.error)
    runStart.current = Date.now();
    listenCtx.current = { expected, from, to, inSession: !!session && session.runningSince !== null };
    if (recOn) { try { await recorder.start(settings.a4); } catch { /* 녹음 못 해도 채점은 계속 */ } }
    listeningRef.current = true;
    setListening(true);
    const withAcc = hasAcc && scoreWithAcc;
    // 집중 연습은 템포가 중요해서 박자를 꼭 (꺼 두었으면 깜빡임)
    const metro = scoreMetro !== 'off' ? scoreMetro : drillRef.current && drillRef.current.from === from && drillRef.current.to === to ? 'visual' : 'off';
    if (withAcc || metro !== 'off') {
      curIdx.current = 0;
      playRange(undefined, { keepListening: true, muteMine: true, acc: withAcc, click: metro === 'sound' ? true : metro === 'visual' ? 'visual' : false });
    }
  }
  function stop() {
    if (!listeningRef.current) return; // 두 번 끝나지 않게
    listeningRef.current = false;
    if (endTimer.current) { clearTimeout(endTimer.current); endTimer.current = null; }
    if (playingRef.current) stopPlay();
    // 마지막 음까지 모으고 바로 채점
    const last_ = segRef.current?.flush();
    if (last_) played.current.push({ midi: last_.midi, cents: last_.settledCents ?? last_.meanCents, start: last_.start, db: meanDb(dbTrack.current, last_.start + 0.05, last_.end) });
    segRef.current = null;
    setListening(false);
    const ctx = listenCtx.current ?? { expected, from, to, inSession: !!session };
    listenCtx.current = null;
    const recP = recorder.stop();
    const durationSec = (Date.now() - runStart.current) / 1000;
    const r = alignNotes(ctx.expected, played.current);
    setResult(r);
    const sm = summarizeScore(r);
    // 약한 마디 집중 연습: 템포 사다리 한 칸
    const dr = drillRef.current;
    if (dr && ctx.from === dr.from && ctx.to === dr.to && r.length) {
      const key = ladderKey(score.id!, dr.measure);
      const l = laddersRef.current[key] ?? newLadder(playBpm);
      const pct = Math.round((sm.ok / Math.max(1, sm.total)) * 100);
      const { next, passed } = ladderStep(l, pct, sm.meanAbs);
      void saveDrill(key, next);
      if (next.done) setDrillMsg(`✓ ${dr.measure}마디 집중 연습 끝! 원래 템포 ♩${ladderBpm(next)}에서도 통과했어요.`);
      else if (passed) { setDrillMsg(`통과! 다음은 ♩${ladderBpm(next)} (${LADDER_PCTS[next.idx]}%)`); setPlayBpm(ladderBpm(next)); }
      else setDrillMsg(`맞은 음 ${pct}%${sm.meanAbs !== null ? ` · ±${Math.round(sm.meanAbs)}센트` : ''} — 같은 템포 ♩${ladderBpm(next)}로 한 번 더 (90% · ±15센트 안이면 통과)`);
    }
    // 연습곡 진도는 먼저 (저장 공간 문제로 녹음 저장이 실패해도 남도록)
    if (ex && ctx.from <= firstNoteMeasure && ctx.to >= last && r.length) {
      const pct = Math.round((sm.ok / Math.max(1, sm.total)) * 100);
      recordProgress(ex.progressId ?? ex.stepId, pct, sm.meanAbs, playBpm).then((ok) => setPassMsg(ok ? '통과! 다음 단계로 가거나 템포를 올려 보세요.' : null)).catch(() => {});
    }
    void (async () => {
      const rec = await recP;
      const played_ = r.filter((x) => x.status !== 'missed').length;
      if (played_ < 2 || durationSec < 2) return;
      const rh = analyzeRhythm(parsed, r);
      const weak = [...sm.byMeasure.entries()].filter(([, v]) => v !== null).sort((a, b) => b[1]! - a[1]!).slice(0, 3).map(([m]) => m);
      const run: ScoreRun = {
        createdAt: Date.now(), date: localDate(), scoreId: score.id!, title: score.title, pieceId: score.pieceId, exerciseId: ex?.stepId,
        from: ctx.from, to: ctx.to, durationSec, total: sm.total, ok: sm.ok, wrong: sm.wrong, missed: sm.missed, meanAbs: sm.meanAbs,
        rhythmMs: rh?.meanAbsMs ?? null, bpm: rh ? Math.round(rh.bpm) : null, inSession: ctx.inSession, weakMeasures: weak,
        notes: toRunNotes(r),
      };
      let runId: number;
      try { runId = await db.scoreRuns.add(run); } catch { setSaved('연습 기록을 저장하지 못했어요. 저장 공간을 확인해 주세요.'); return; }
      let recMsg = '';
      if (rec && rec.durationSec >= 1) {
        try {
          const recId = await db.recordings.add({
            createdAt: run.createdAt, date: run.date, pieceId: score.pieceId, title: `${score.title} · ${ctx.from}~${ctx.to}마디`,
            durationSec: rec.durationSec, mime: rec.mime, blob: rec.blob, track: rec.track, scoreId: score.id!, runId,
          } as Recording);
          await db.scoreRuns.update(runId, { recordingId: recId });
          recMsg = '과 녹음';
        } catch { recMsg = '(녹음은 저장 공간이 부족해 저장하지 못했어요)'; }
      }
      if (score.pieceId) await db.pieces.update(score.pieceId, { lastPracticed: run.date }).catch(() => {});
      setSaved(recMsg.startsWith('(') ? `연습 기록을 저장했어요 ${recMsg}` : `연습 기록${recMsg}을 저장했어요.`);
    })();
    pitch.stop(); // 채점이 끝나면 마이크를 닫음
  }
  // 화면을 떠날 때: 듣는 중이면 지금까지를 채점·저장 (layout 정리는 마이크가 닫히기 전에 돌아감)
  useLayoutEffect(() => () => {
    if (listeningRef.current) stopRef.current();
    else if (recorder.recording) void recorder.stop();
    if (endTimer.current) clearTimeout(endTimer.current);
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const startRef = useRef(start);
  startRef.current = start;
  const setRange = (a: number, b: number) => {
    if (listeningRef.current) return; // 채점 중에는 구간 고정
    if (playingRef.current || pausedAt !== null) stopPlay();
    const A = Math.max(first, Math.min(last, a)), B = Math.max(A, Math.min(last, b));
    if (drillRef.current && (A !== drillRef.current.from || B !== drillRef.current.to)) { setDrill(null); setDrillMsg(null); }
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
  /** 집중 연습 시작: 그 마디만, 사다리의 지금 템포로 */
  function beginDrill(m: number) {
    if (listeningRef.current) return;
    const key = ladderKey(score.id!, m);
    let l: DrillLadder | undefined = ladders[key];
    if (!l || l.done) { l = newLadder(l?.base ?? playBpm); void saveDrill(key, l); }
    setRange(m, m);
    setLenLock(1);
    setDrill({ measure: m, from: Math.max(first, Math.min(last, m)), to: Math.max(first, Math.min(last, m)) });
    setDrillMsg(null);
    setPlayBpm(ladderBpm(l));
  }
  function endDrill() { setDrill(null); setDrillMsg(null); }
  // 다른 화면에서 열 때: 그 마디로 (집중 연습이면 바로 준비)
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current || !initial?.measure) return;
    initDone.current = true;
    if (initial.drill) beginDrill(initial.measure); else setRange(initial.measure, initial.measure + span - 1);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const drillLadder = drill ? ladders[ladderKey(score.id!, drill.measure)] : undefined;
  const hasDyn = useMemo(() => parsed.notes.some((n) => n.art?.vel !== undefined), [parsed]);
  const sum = result ? summarizeScore(result) : null;
  const worst = result ? result.filter((r) => r.status === 'ok').sort((a, b) => Math.abs(b.cents!) - Math.abs(a.cents!)).slice(0, 6) : [];

  return (
    <section className={`page score score-view ${focus ? 'focus' : ''}`} data-testid="score-view">
      <div className="score-top">
      <div className="card-head">
        <button className="mini" onClick={() => { if (listening) stop(); pitch.stop(); onClose(); }}>◀ 목록</button>
        <b className="score-title">{score.title}</b>
      </div>

      {!ex && <LessonChecklist scoreId={score.id!} onMeasure={(m) => setRange(m, m + (lenLock ?? span) - 1)} />}

      {drill && (
        <div className="card drill-card" data-testid="drill-card">
          <div className="card-head"><b>{drill.measure}마디 집중 연습</b><button className="mini" onClick={endDrill} data-testid="drill-end">그만</button></div>
          <div className="ladder" data-testid="drill-ladder">
            {LADDER_PCTS.map((pc, k) => {
              const l = drillLadder;
              const done = l ? (l.done || k < l.idx) : false;
              const now = l && !l.done && k === l.idx;
              return <span key={pc} className={`ladder-step ${done ? 'done' : ''} ${now ? 'now' : ''}`}>{l ? Math.round((l.base * pc) / 100) : pc}{done ? ' ✓' : ''}</span>;
            })}
          </div>
          <p className="small">{drillLadder?.done ? '끝까지 통과했어요! 다른 약한 마디로 가거나 앞뒤 마디와 이어서 연습해 보세요.' : `지금 ♩${playBpm} — 아래 "채점받기"로 연주해요. 맞은 음 90% · ±15센트 안이면 다음 템포로 올라가요.`}</p>
          {drillMsg && <p className="small" data-testid="drill-msg"><b>{drillMsg}</b></p>}
          <p className="hint">사다리는 저장돼서 다른 날에도 이어서 할 수 있어요. 박자를 꺼 두었으면 깜빡임으로 박을 보여줘요.</p>
        </div>
      )}

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
          <NumField value={from} min={first} max={last} label="시작 마디" disabled={listening} testId="from" width={52} onChange={(v) => setRange(v, lenLock ? v + lenLock - 1 : Math.max(v, to))} /></span>
          <span className="rg"><span className="range-label">끝</span>
          <NumField value={to} min={from} max={last} label="끝 마디" disabled={listening} testId="to" width={52} onChange={(v) => { setLenLock(null); setRange(from, v); }} /></span>
          <span className="muted small">{span}마디 · {expected.length}음</span>
        </div>
        <div className="chips len-chips" data-testid="len-chips">
          {[1, 2, 4, 8, 16].map((n) => (
            <button key={n} className={`chip ${lenLock === n ? 'on' : ''}`} disabled={listening} onClick={() => { setLenLock(n); setRange(from, from + n - 1); }}>{n}마디</button>
          ))}
        </div>
        <div className="session-controls">
          <button onClick={() => setRange(from - span, to - span)} disabled={listening || from <= first}>◀ 앞 구간</button>
          <button disabled={listening} onClick={() => { setLenLock(null); setRange(firstNoteMeasure, last); }}>전체</button>
          <button onClick={() => setRange(from + span, to + span)} disabled={listening || to >= last}>다음 구간 ▶</button>
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
        {!listening && (
          <div className="metro-pick" role="group" aria-label="채점할 때 박자">
            <span className="small">박자</span>
            {([['off', '끔'], ['visual', '깜빡임'], ['sound', '메트로놈 소리']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`chip ${scoreMetro === v ? 'on' : ''}`} onClick={() => setScoreMetro(v)} data-testid={`score-metro-${v}`}>{l}</button>
            ))}
          </div>
        )}
        {!listening && scoreMetro !== 'off' && (
          <p className="hint small">재생 템포 ♩{playBpm}로 한 마디 세고 시작해요. 악보에 지금 칠 음도 따라 표시돼요.{scoreMetro === 'sound' ? ' 이어폰(유선 권장)으로 들으면 녹음에 클릭이 안 들어가요. 스피커로 들어도 채점은 클릭 소리를 빼고 해요.' : ' 소리 없이 아래 점이 박마다 깜빡여요.'}</p>
        )}
        {pitch.error && <p className="error">{pitch.error}</p>}
        <p className="hint">템포는 상관없어요. 악보 순서대로 연주하면 음을 맞춰 보고, 음표 색으로 보여줘요. 초록 ±10센트 안, 노랑 ±20, 빨강 그 이상, 보라 다른 음, 회색 놓친 음. 박자도 함께 봐요: 내 템포에 맞춰 각 음이 일찍·늦게 들어갔는지.</p>
      </div>

      </div>
      <div className="score-main">
      <div className="sheet-bar">
        <span className="muted small">{from}~{to}마디{nowMeasure !== null ? ` · 지금 ${nowMeasure}마디` : ''}</span>
        <span className="zoom">
          <button className={`mini ${markMode ? 'on' : ''}`} onClick={() => { setTool(markMode ? 'none' : 'mark'); setMarkKey(null); setEditKey(null); setHereKey(null); }} disabled={listening} data-testid="mark-toggle" title="음표를 눌러 활·셈여림·메모 붙이기">✎ 표시</button>
          <button className={`mini ${tool === 'edit' ? 'on' : ''}`} onClick={() => { setTool(tool === 'edit' ? 'none' : 'edit'); setMarkKey(null); setEditKey(null); setHereKey(null); }} disabled={listening} data-testid="edit-toggle" title="틀린 음을 눌러 높이·길이 고치기">♪ 음 고치기</button>
          <button className={`mini ${focus ? 'on' : ''}`} onClick={() => setFocus(!focus)} data-testid="focus-toggle">{focus ? '메뉴 보기' : '악보만'}</button>
          <button className="mini" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} aria-label="악보 작게">가−</button>
          <button className="mini" onClick={() => setZoom(1)} aria-label="악보 기본 크기">{Math.round(zoom * 100)}%</button>
          <button className="mini" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} aria-label="악보 크게">가+</button>
        </span>
      </div>
      <div className="score-sheet">
        {rendering && <p className="muted small">악보를 그리는 중…</p>}
        {renderError && <p className="error">{renderError}</p>}
        {markMode && <p className="hint mark-hint">음표를 누르면 활·셈여림·메모를 붙여요. 다 했으면 ✎ 표시를 다시 눌러요.</p>}
        {tool === 'edit' && (
          <p className="hint mark-hint">틀린 음표를 누르면 높이·길이를 고쳐요. 고친 악보는 이 기기에만 저장돼요.
            {score.origXml && <button className="link small" onClick={revertAll} data-testid="edit-revert-all"> 원래 악보로 되돌리기</button>}</p>
        )}
        {tool === 'none' && !listening && !playing && <p className="muted small tap-hint">음표를 누르면 그 마디부터 듣거나 채점할 수 있어요.</p>}
        <div ref={sheetWrap} className={`sheet-wrap ${tool !== 'none' ? 'marking' : ''}`}
          onClick={(e) => onSheetTap(e.clientX, e.clientY)} data-testid="sheet-wrap">
          <div ref={holder} data-testid="osmd" />
          <div className="mark-layer" aria-hidden>
            {lessonPos.map(({ m, x, top, n }) => (
              <span key={`l${m}`} className="lesson-pin" style={{ left: x, top }} title={`레슨 노트 ${n}개`} data-testid="lesson-pin">📝{n > 1 ? n : ''}</span>
            ))}
            {markPos.map(({ key, x, top, bottom, m }) => (
              <div key={key} className={`mark-at ${markKey === key ? 'sel' : ''}`} style={{ left: x }}>
                {(m.bow || m.text) && (
                  <span className="mark-up" style={{ top: top - 4 }} data-testid="mark-label">
                    {m.text && <span className="mark-text">{m.text}</span>}
                    {m.bow && <b className="mark-bow">{m.bow === 'down' ? '∏' : 'V'}</b>}
                  </span>
                )}
                {(m.dyn || m.hair) && (
                  <span className="mark-down" style={{ top: bottom + 4 }} data-testid="mark-label">
                    {m.dyn && <i className="mark-dyn">{m.dyn}</i>}
                    {m.hair && <b className="mark-hair">{m.hair === 'cresc' ? '＜' : m.hair === 'dim' ? '＞' : '⊣'}</b>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
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
              {hasDyn && <button className={view === 'dyn' ? 'on' : ''} onClick={() => setView('dyn')} data-testid="view-dyn">셈여림으로 보기</button>}
            </div>
          )}
          {view === 'dyn' && hasDyn && <DynChart result={result!} />}
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

      {weak.length > 0 && !listening && (
        <div className="card" data-testid="weak-card">
          <div className="card-head"><b>약한 마디</b><span className="muted small">최근 기록에서</span></div>
          <ul className="weak-list">
            {weak.map((w) => {
              const l = ladders[ladderKey(score.id!, w.measure)];
              return (
                <li key={w.measure}>
                  <button className="link" onClick={() => setRange(w.measure, w.measure + (lenLock ?? span) - 1)}><b>{w.measure}마디</b></button>
                  <span className="muted small">{w.okRate !== null ? `맞은 음 ${Math.round(w.okRate * 100)}%` : '자주 벗어남'}{w.meanAbs !== null ? ` · ±${Math.round(w.meanAbs)}센트` : ''} · {w.tries}번{l && !l.done ? ` · 사다리 ${LADDER_PCTS[l.idx]}%` : ''}</span>
                  <button className="mini primary" onClick={() => beginDrill(w.measure)} disabled={listening} data-testid="drill-start">집중 연습</button>
                </li>
              );
            })}
          </ul>
          <p className="hint">느린 템포(60%)부터 통과할 때마다 10%씩 올려 원래 템포까지 가요.</p>
        </div>
      )}
      <RunHistory runs={runs} onPick={(r) => setRange(r.from, r.to)} />
      <ScoreProgress runs={runs} from={from} to={to} />
      {!ex && <LessonNotesCard scoreId={score.id!} scoreTitle={score.title} pieceId={score.pieceId} measure={from} onMeasure={(m) => setRange(m, m + (lenLock ?? span) - 1)} />}
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

      {markKey !== null && (
        <MarkSheet keyName={markKey} mark={marks[markKey] ?? {}} onPatch={(p) => saveMark(markKey, p)} onClose={() => setMarkKey(null)} />
      )}

      {editKey !== null && (() => {
        const [m, i] = editKey.split(':').map(Number);
        const nt = parsed.notes.find((x) => x.measure === m && x.index === i);
        return nt ? (
          <EditSheet keyName={editKey} midi={nt.midi} dur={nt.dur} msg={editMsg} canRevert={!!score.origXml}
            onOp={(op) => applyEdit(editKey, op)} onRevertBar={() => revertBar(editKey)} onClose={() => setEditKey(null)} />
        ) : null;
      })()}

      {hereKey !== null && (
        <div className="here-bar" data-testid="here-bar" role="dialog" aria-label="여기부터">
          <span className="small"><b>{hereKey.split(':')[0]}마디</b>부터 {lenLock ?? span}마디</span>
          <button className="primary" onClick={() => startFrom(hereKey, 'play')} data-testid="here-play">▶ 듣기</button>
          <button onClick={() => startFrom(hereKey, 'score')} disabled={!expected.length} data-testid="here-score">● 채점</button>
          <button className="mini" onClick={() => setHereKey(null)} aria-label="닫기">✕</button>
        </div>
      )}

      {(focus || playing || pausedAt !== null || listening) && !markKey && !editKey && !hereKey && (
        <div className="float-ctl" data-testid="float-ctl" role="toolbar" aria-label="재생 조작">
          {listening ? (
            <>
              {playing && <span ref={beatDot} className="beat-dot" data-testid="beat-dot" aria-hidden />}
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
              <span ref={beatDot} className="beat-dot" aria-hidden />
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


const DUR_TYPES: { type: NoteType; q: number; label: string }[] = [
  { type: 'whole', q: 4, label: '온' }, { type: 'half', q: 2, label: '2분' }, { type: 'quarter', q: 1, label: '4분' }, { type: 'eighth', q: 0.5, label: '8분' }, { type: '16th', q: 0.25, label: '16분' },
];
/** 음표 하나 고치기: 높이·길이·쉼표 */
function EditSheet({ keyName, midi, dur, msg, canRevert, onOp, onRevertBar, onClose }: {
  keyName: string; midi: number; dur: number; msg: string; canRevert: boolean;
  onOp: (op: EditOp) => void; onRevertBar: () => void; onClose: () => void;
}) {
  const [measure, idx] = keyName.split(':');
  const cur = DUR_TYPES.find((d) => Math.abs(d.q - dur) < 1e-6 || Math.abs(d.q * 1.5 - dur) < 1e-6);
  const dotted = !!cur && Math.abs(cur.q * 1.5 - dur) < 1e-6 && Math.abs(cur.q - dur) > 1e-6;
  return (
    <div className="mark-sheet" data-testid="edit-sheet" role="dialog" aria-label="음 고치기">
      <div className="card-head"><b>{measure}마디 {Number(idx) + 1}번째 음 · <span data-testid="edit-note">{midiName(midi)}</span></b><button className="mini" onClick={onClose} data-testid="edit-close">닫기</button></div>
      <div className="mark-row">
        <span className="muted small">높이</span>
        <button className="chip" onClick={() => onOp({ kind: 'shift', semis: -1 })} data-testid="edit-down">반음 ↓</button>
        <button className="chip" onClick={() => onOp({ kind: 'shift', semis: 1 })} data-testid="edit-up">반음 ↑</button>
        <button className="chip" onClick={() => onOp({ kind: 'shift', semis: -12 })}>옥타브 ↓</button>
        <button className="chip" onClick={() => onOp({ kind: 'shift', semis: 12 })}>옥타브 ↑</button>
      </div>
      <div className="mark-row">
        <span className="muted small">길이</span>
        {DUR_TYPES.map((d) => (
          <button key={d.type} className={`chip ${cur?.type === d.type ? 'on' : ''}`} onClick={() => onOp({ kind: 'dur', type: d.type, dot: dotted })}>{d.label}</button>
        ))}
        <button className={`chip ${dotted ? 'on' : ''}`} disabled={!cur} onClick={() => cur && onOp({ kind: 'dur', type: cur.type, dot: !dotted })}>점</button>
      </div>
      {msg && <p className="error small" data-testid="edit-msg">{msg}</p>}
      <div className="session-controls">
        <button className="danger" onClick={() => onOp({ kind: 'rest' })} data-testid="edit-rest">쉼표로 바꾸기</button>
        {canRevert && <button className="secondary" onClick={onRevertBar} data-testid="edit-revert-bar">이 마디 되돌리기</button>}
      </div>
      <p className="hint">짧게 하면 뒤에 쉼표가 생기고, 길게 하려면 바로 뒤에 쉼표가 있어야 해요. 붙임줄·셋잇단 음은 높이만 고칠 수 있어요.</p>
    </div>
  );
}

/** 음표 하나에 표시 붙이기 */
function MarkSheet({ keyName, mark, onPatch, onClose }: { keyName: string; mark: UserMark; onPatch: (p: Partial<UserMark> | null) => void; onClose: () => void }) {
  const [measure, idx] = keyName.split(':');
  const tog = <K extends keyof UserMark>(k: K, v: UserMark[K]) => onPatch({ [k]: mark[k] === v ? undefined : v } as Partial<UserMark>);
  return (
    <div className="mark-sheet" data-testid="mark-sheet" role="dialog" aria-label="표시 붙이기">
      <div className="card-head"><b>{measure}마디 {Number(idx) + 1}번째 음</b><button className="mini" onClick={onClose} data-testid="mark-close">닫기</button></div>
      <div className="mark-row">
        <span className="muted small">활</span>
        <button className={`chip ${mark.bow === 'down' ? 'on' : ''}`} onClick={() => tog('bow', 'down')} data-testid="mark-down">∏ 내림</button>
        <button className={`chip ${mark.bow === 'up' ? 'on' : ''}`} onClick={() => tog('bow', 'up')} data-testid="mark-up">V 올림</button>
      </div>
      <div className="mark-row">
        <span className="muted small">셈여림</span>
        {(['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const).map((d) => (
          <button key={d} className={`chip dyn ${mark.dyn === d ? 'on' : ''}`} onClick={() => tog('dyn', d)} data-testid={`mark-dyn-${d}`}><i>{d}</i></button>
        ))}
      </div>
      <div className="mark-row">
        <span className="muted small">점점</span>
        <button className={`chip ${mark.hair === 'cresc' ? 'on' : ''}`} onClick={() => tog('hair', 'cresc')} data-testid="mark-cresc">＜ 세게 시작</button>
        <button className={`chip ${mark.hair === 'dim' ? 'on' : ''}`} onClick={() => tog('hair', 'dim')} data-testid="mark-dim">＞ 여리게 시작</button>
        <button className={`chip ${mark.hair === 'end' ? 'on' : ''}`} onClick={() => tog('hair', 'end')} data-testid="mark-hair-end">⊣ 여기까지</button>
      </div>
      <div className="mark-row">
        <span className="muted small">메모</span>
        <DraftInput value={mark.text ?? ''} onCommit={(v) => onPatch({ text: v.trim() ? v.trim().slice(0, 30) : undefined })} label="메모" placeholder="예: 활 끝까지, 4번" className="mark-input" />
      </div>
      <div className="session-controls">
        <button className="danger" onClick={() => onPatch(null)} data-testid="mark-clear">이 음 표시 지우기</button>
      </div>
      <p className="hint">파란 글씨가 내 표시예요. 활·셈여림·꺾쇠는 악보 듣기에도 반영돼요.</p>
    </div>
  );
}

function RecPlayer({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, alive = true;
    db.recordings.get(id).then((r) => { if (r && alive) { u = URL.createObjectURL(r.blob); setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
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
