import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MiniStaff, staffRange } from '../components/MiniStaff';
import { CentsGauge, centsText } from '../components/CentsGauge';
import { centsBetween, freqToNote, midiToFreq } from '../audio/notes';
import { PitchSmoother } from '../audio/smooth';
import { planPlayback, scorePlayer } from '../score/player';
import type { ParsedScore, ScoreNote } from '../score/parse';
import { STRINGS, STRING_NAMES, chartSpots, posBase, type ChartSpot } from '../score/fingering';
import { solfaName } from '../score/solfa';
import { tolFor, toneOf } from '../score/tolerance';
import { useSettings } from '../state/settings';
import { usePitch } from '../state/usePitch';
import { useWakeLock } from '../state/wakeLock';
import { useBackLayer } from '../state/back';
import { requestScore, takeFingeringRequest, type FingeringRequest } from '../state/openRequest';
import type { TabId } from '../components/TabBar';
import { chartKeyFor, chartPosFor, spelledFrom, spotFromHint } from '../violin/fromScore';
import {
  CHART_KEYS, CHART_POSITIONS, autoBoard, enharmonic, fretPos, hitInPos, keyShape, liveString, nextInRun, noteHits, noteRows,
  positionSpots, posLabel, randomSpot, scaleRun, spell, spelledName, spotChip, spotMidi, spotTitle,
  type BoardView, type ChartKey, type Hit, type NoteRow, type Spelled,
} from '../violin/fingerchart';

interface Prefs { key: number | 'all'; maxPos: number; pos: number; labels: boolean; board: BoardView; autoNext: boolean }
const PREF_KEY = 'violin-fingerchart';
const BOARD_VIEWS: { id: BoardView; label: string }[] = [{ id: 'auto', label: '자동' }, { id: 'h', label: '가로' }, { id: 'v', label: '세로' }];
function loadPrefs(): Prefs {
  const d: Prefs = { key: 'all', maxPos: 7, pos: 1, labels: false, board: 'auto', autoNext: false };
  try {
    const p = { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } as Prefs;
    if (p.key !== 'all' && !CHART_KEYS.some((k) => k.id === p.key)) p.key = d.key;
    if (![1, 3, 5, 7].includes(p.maxPos)) p.maxPos = d.maxPos;
    if (!CHART_POSITIONS.includes(p.pos)) p.pos = d.pos;
    if (!BOARD_VIEWS.some((b) => b.id === p.board)) p.board = d.board;
    p.labels = p.labels === true; p.autoNext = p.autoNext === true;
    return { key: p.key, maxPos: p.maxPos, pos: p.pos, labels: p.labels, board: p.board, autoNext: p.autoNext };
  } catch { return d; }
}

/** 짚어 보기 목표: 음 (spot 이 없으면 아무 자리나) 또는 줄·포지션·손가락까지 정한 자리 */
export interface Target { midi: number; note: Spelled; spot: ChartSpot | null }

/** 음 이름 두 가지: C D E (옥타브) + 고정 도 */
const fixedDo = (n: Spelled) => solfaName(n.step, n.alter, 0, 'fixed');

/** 음 여러 개를 바이올린 샘플로 (따라 하기와 같은 재생기) */
function playMidis(midis: number[], a4: number, beats = 1.2) {
  const ns: ScoreNote[] = midis.map((midi, i) => ({ measure: 1, index: i, midi, beat: i * beats, dur: beats }));
  const len = midis.length * beats;
  const s: ParsedScore = { title: '', measures: [1], notes: ns, measureLen: new Map([[1, len]]), time: [Math.max(1, Math.ceil(len)), 4], parts: [''], dyn: [], measureStart: new Map([[1, 0]]), bars: [] };
  void scorePlayer.play(planPlayback(s, { bpm: midis.length > 1 ? 120 : 60, from: 1, to: 1, countIn: false }), { a4, click: false, voice: 'sample' });
}

/** 자동 보기: 넓은 화면·가로 방향이면 가로 지판 */
function useAutoBoard(): 'h' | 'v' {
  const q = '(min-width: 720px), (orientation: landscape)';
  const get = () => (typeof window === 'undefined' ? 'v' : autoBoard(window.innerWidth, window.matchMedia?.(q).matches ?? false));
  const [v, setV] = useState<'h' | 'v'>(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

const HOLD = 0.5;
function stepWord(n: number) { return n === 1 ? '반음' : n === 2 ? '온음' : n === 12 ? '한 옥타브' : `${n}반음`; }

/** 튜너 탭 → 운지표: 음 목록(가로 줄) · 지판 · 짚어 보기를 한 화면에 */
export function Fingerboard({ go }: { go?: (t: TabId) => void } = {}) {
  const { settings } = useSettings();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 무시 */ } }, [prefs]);
  const set = (p: Partial<Prefs>) => setPrefs((o) => ({ ...o, ...p }));
  const key: ChartKey = prefs.key === 'all' ? null : prefs.key;
  const autoView = useAutoBoard();
  const view = prefs.board === 'auto' ? autoView : prefs.board;
  const [target, setTargetRaw] = useState<Target | null>(null);
  const a4 = settings.a4;
  useEffect(() => () => scorePlayer.stop(), []);
  const play = useCallback((m: number) => playMidis([m], a4), [a4]);

  // ── 짚어 보기 상태 ──
  const pitch = usePitch(settings.minDb);
  useWakeLock(pitch.on, settings.wakeLock);
  const tol = tolFor(settings.pitchTolerance);
  const [tally, setTally] = useState({ right: 0, tries: 0 });
  const [done, setDone] = useState(false);
  const hold = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dir = useRef<1 | -1>(1);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setTarget = useCallback((t: Target | null, sound = true) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    hold.current = null; setDone(false);
    setTargetRaw(t);
    if (t && sound) play(t.midi);
  }, [play]);
  const selectNote = useCallback((note: Spelled) => setTarget({ midi: note.midi, note, spot: null }), [setTarget]);
  const pickSpot = (spot: ChartSpot, note: Spelled) => setTarget({ midi: note.midi, note, spot });

  // ── 악보에서 음표를 길게 눌러 왔을 때: 그 음(자리)을 목표로, 조·포지션 맞추기 ──
  const [ret, setRet] = useState<FingeringRequest['back'] | null>(null);
  useEffect(() => {
    const r = takeFingeringRequest();
    if (!r) return;
    const spot = spotFromHint(r.midi, r.spot);
    const k = chartKeyFor(r.midi, key, r.fifths);
    const pos = chartPosFor(r.midi, spot, prefs.pos);
    // 음 줄에 보이도록 최고 포지션도 (자리 또는 그 음의 가장 낮은 자리까지)
    const need = spot ? spot.pos : Math.min(...chartSpots(r.midi, 7).map((s) => s.pos), 1);
    const maxPos = prefs.maxPos >= need ? prefs.maxPos : [1, 3, 5, 7].find((p) => p >= need) ?? 7;
    set({ key: k === null ? 'all' : k, pos, maxPos });
    setTarget({ midi: r.midi, note: spelledFrom(r.midi, r.step, r.alter), spot });
    setRet(r.back ?? null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const backToScore = () => {
    if (!ret) return;
    requestScore({ scoreId: ret.scoreId, measure: ret.from, to: ret.to });
    setRet(null);
    go?.('score');
  };
  useBackLayer(!!ret && !!go, backToScore);

  const run = useMemo(() => scaleRun(prefs.pos, key), [prefs.pos, key]);
  /** 음계 따라 짚기: 지금 조·포지션 안에서 다음 음 */
  const stepRun = (from: number | null) => {
    const n = nextInRun(run, from, dir.current);
    if (!n) return;
    dir.current = n.dir;
    setTarget({ midi: n.item.note.midi, note: n.item.note, spot: n.item });
  };
  /** 다음 자리: 다음 음 자동이면 음계 다음 음, 아니면 무작위 (맞힌 뒤에는 지금 목표의 포지션에서 이어서) */
  const next = (keepPos = false) => {
    if (prefs.autoNext) { stepRun(target?.midi ?? null); return; }
    const p = keepPos && target?.spot && !target.spot.open ? target.spot.pos : prefs.pos;
    const s = randomSpot(p, key, Math.random, target?.midi);
    if (!s) { setTarget(null); return; }
    setTarget({ spot: s, midi: spotMidi(s), note: s.note });
  };

  // 지금 음 (판정용 날값) + 실시간 점 (부드럽게)
  const freq = pitch.reading?.freq ?? null;
  const smoother = useRef(new PitchSmoother(a4));
  useEffect(() => { smoother.current.setA4(a4); }, [a4]);
  const smooth = useMemo(() => (pitch.reading ? smoother.current.push(pitch.reading.time, pitch.reading.freq) : null), [pitch.reading]);

  let cents: number | null = null, nowName = '—', msg = pitch.on ? (target ? '소리를 내 주세요' : '음을 골라 주세요') : '마이크를 켜 주세요';
  let good = false;
  if (freq) {
    const n = freqToNote(freq, a4);
    nowName = spelledName(spell(n.midi, key) ?? spell(n.midi, null)!);
    if (!target) { cents = n.cents; msg = `지금 ${nowName}`; }
    else {
      const c = centsBetween(freq, midiToFreq(target.midi, a4));
      if (n.midi === target.midi || Math.abs(c) <= 50) {
        cents = c;
        good = Math.abs(c) <= tol.good;
        msg = good ? '좋아요, 그대로 유지해요' : c > 0 ? `조금 높아요 (${centsText(c)}센트)` : `조금 낮아요 (${centsText(c)}센트)`;
      } else {
        cents = n.cents;
        const d = n.midi - target.midi;
        msg = `지금 ${nowName} — ${stepWord(Math.abs(d))} ${d > 0 ? '높아요' : '낮아요'}`;
      }
    }
  }
  if (done) msg = '맞았어요!';

  // 기준 안에서 0.5초 이어지면 맞음 → 잠깐 뒤 다음 자리
  useEffect(() => {
    if (!target || done || !pitch.reading) return;
    const t = pitch.reading.time;
    if (!good) { hold.current = null; return; }
    if (hold.current === null) hold.current = t;
    else if (t - hold.current >= HOLD) {
      setDone(true);
      setTally((x) => ({ right: x.right + 1, tries: x.tries + 1 }));
      timer.current = setTimeout(() => next(true), 900);
    }
  }, [pitch.reading]); // eslint-disable-line react-hooks/exhaustive-deps

  // 실시간 점: 목표 줄 (또는 들리는 음을 지금 포지션에서 낼 수 있는 줄) 위, 센트까지 반영한 자리
  const hitMax = Math.max(prefs.maxPos, prefs.pos, target?.spot?.pos ?? 0);
  const hits = useMemo(() => (target ? noteHits(target.midi, hitMax) : []), [target, hitMax]);
  let live: { string: number; semis: number; tone: string } | null = null;
  if (pitch.on && smooth) {
    const m = smooth.midi + smooth.cents / 100;
    const prefer = hits.filter((h) => hitInPos(h, prefs.pos)).map((h) => h.string);
    const s = liveString(m, prefs.pos, target?.spot ? target.spot.string : null, prefs.maxPos, prefer);
    if (s !== null && m - STRINGS[s] > -1) {
      const tone = target ? toneOf((m - target.midi) * 100, tol) : 'idle';
      live = { string: s, semis: m - STRINGS[s], tone };
    }
  }

  const rows = useMemo(() => noteRows(key, prefs.maxPos), [key, prefs.maxPos]);
  const nHits = hits.length;

  return (
    <div className="page-sub fingerchart">
      {ret && go && (
        <button className="secondary fc-back" onClick={backToScore} data-testid="fc-back-score">◀ 악보로 ({ret.title} {ret.measure}마디)</button>
      )}
      <div className="fc-bar">
        <label className="fc-key">
          <span>조</span>
          <select value={String(prefs.key)} onChange={(e) => set({ key: e.target.value === 'all' ? 'all' : Number(e.target.value) })} data-testid="chart-key">
            {CHART_KEYS.map((k) => <option key={String(k.id)} value={k.id === null ? 'all' : String(k.id)}>{k.label}</option>)}
          </select>
        </label>
        <div className="fc-maxpos">
          <span>최고 포지션</span>
          <div className="segmented small">
            {[1, 3, 5, 7].map((p) => <button key={p} className={prefs.maxPos === p ? 'on' : ''} onClick={() => set({ maxPos: p })} data-testid={`maxpos-${p}`}>{p}</button>)}
          </div>
        </div>
        <label className="fc-toggle">
          <input type="checkbox" checked={prefs.labels} onChange={(e) => set({ labels: e.target.checked })} data-testid="fc-labels" />
          <span>자리 글자</span>
        </label>
      </div>

      <NoteStrip rows={rows} chartKey={key} labels={prefs.labels} selected={target?.midi ?? null} onSelect={selectNote} />

      <div className="fc-bar fc-bar2">
        <div className="chips fc-pos" role="group" aria-label="포지션">
          {CHART_POSITIONS.map((p) => (
            <button key={p} className={`chip ${prefs.pos === p ? 'on' : ''}`} onClick={() => set({ pos: p })} data-testid={`pos-${p}`}>{posLabel(p)}</button>
          ))}
        </div>
        <div className="fc-view">
          <span>지판</span>
          <div className="segmented small" role="group" aria-label="지판 보기">
            {BOARD_VIEWS.map((b) => (
              <button key={b.id} className={prefs.board === b.id ? 'on' : ''} onClick={() => set({ board: b.id })} data-testid={`board-${b.id}`}
                title={b.id === 'auto' ? `자동 (지금 ${autoView === 'h' ? '가로' : '세로'})` : undefined}>{b.label}</button>
            ))}
          </div>
        </div>
      </div>

      <Board view={view} pos={prefs.pos} chartKey={key} target={target} hits={hits} live={live} onPick={pickSpot} />
      <p className="hint fc-legend">
        {target
          ? `${spelledName(target.note)} 자리 ${nHits}곳 — 진한 자리는 ${posLabel(prefs.pos)} 포지션 안, 옅은 자리는 다른 포지션이에요.`
          : key === null ? '반음 자리를 모두 보여 줘요. 같은 번호가 두 개면 낮은·높은 자리예요.' : '조의 음만 보여 줘요. 막대는 반음으로 붙은 손가락이에요.'}
        {' '}점선은 4번을 늘려 닿는 자리예요.
      </p>

      {pitch.on && (
        <div className={`fc-now ${done ? 'good' : ''}`} data-testid="practice-now-bar" aria-hidden="true">
          <b>{nowName}</b><span>{centsText(cents)}</span><span className="fc-now-msg">{msg}</span>
        </div>
      )}

      <div className={`card fc-practice ${done ? 'in-tune' : ''}`}>
        <div className="fc-pr-head">
          <div>
            <div className="fc-target" data-testid="practice-target">
              {target ? (target.spot ? spotTitle(target.spot, spelledName(target.note)) : `${spelledName(target.note)} 짚기`) : '음을 골라 주세요'}
            </div>
            <div className="muted fc-target-sub">
              {target
                ? `${fixedDo(target.note)}${target.spot ? '' : ` · 자리는 마음대로 (${nHits}곳)`} · 기준 ±${tol.good}센트 안에서 ${HOLD}초`
                : '위 음 줄이나 지판에서 누르거나, 골라 주기를 눌러 주세요'}
            </div>
          </div>
          <div className="fc-reading">
            <span className="note-mid" data-testid="practice-now">{nowName}</span>
            <span className="cents-num" data-testid="practice-cents">{centsText(cents)}<small> 센트</small></span>
          </div>
        </div>
        <CentsGauge cents={cents} label="짚은 음 게이지" />
        <p className={`fc-msg ${done ? 'good' : ''}`} data-testid="practice-msg">{msg}</p>
        <div className="fc-actions">
          <button className="secondary" onClick={() => next()} data-testid="practice-pick">{prefs.autoNext ? '⏭ 다음 음' : '🎲 골라 주기'}</button>
          <button className="secondary" onClick={() => target && play(target.midi)} disabled={!target} data-testid="practice-ref">▶ 참고 소리</button>
          <button className="secondary" onClick={() => { if (!target) return; setTally((x) => ({ ...x, tries: x.tries + 1 })); next(true); }} disabled={!target || done} data-testid="practice-skip">건너뛰기</button>
        </div>
        <label className="fc-toggle fc-auto">
          <input type="checkbox" checked={prefs.autoNext} data-testid="practice-auto"
            onChange={(e) => { set({ autoNext: e.target.checked }); if (e.target.checked && !target) { dir.current = 1; const n = nextInRun(run, null, 1); if (n) setTarget({ midi: n.item.note.midi, note: n.item.note, spot: n.item }); } }} />
          <span>다음 음 자동 <small className="muted">맞으면 {posLabel(prefs.pos)} 포지션 음계의 다음 음으로 (끝에서 내려와요)</small></span>
        </label>
        <button className={`primary wide ${pitch.on ? 'stop' : ''}`} onClick={pitch.on ? pitch.stop : pitch.start} data-testid="practice-mic">
          {pitch.on ? '마이크 끄기' : '마이크 켜기'}
        </button>
        {pitch.error && <p className="error">{pitch.error}</p>}
        <div className="fc-tally" data-testid="practice-tally">맞힘 {tally.right} / 시도 {tally.tries}</div>
      </div>
    </div>
  );
}

/* ── 음 목록: 낮은 음 → 높은 음 가로 줄 ── */
const NoteStrip = memo(function NoteStrip({ rows, chartKey, labels, selected, onSelect }: {
  rows: NoteRow[]; chartKey: ChartKey; labels: boolean; selected: number | null; onSelect: (n: Spelled) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const range = useMemo(() => staffRange(rows.map((r) => r.note)), [rows]);
  // 고른 칸을 가운데로
  useLayoutEffect(() => {
    const el = box.current, cell = el?.querySelector<HTMLElement>('.fc-cell.on');
    if (!el || !cell) return;
    const left = cell.offsetLeft - el.offsetLeft - (el.clientWidth - cell.offsetWidth) / 2;
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' }); else el.scrollLeft = left;
  }, [selected, labels, rows]);
  return (
    <div className="fc-strip-wrap">
      <div className="fc-clef" aria-hidden="true"><MiniStaff range={range} width={26} /></div>
      <div className="fc-strip" ref={box} data-testid="note-list" role="listbox" aria-label="음 목록" aria-orientation="horizontal">
        {rows.map(({ note, spots }) => {
          const alt = chartKey === null ? enharmonic(note.midi) : null;
          const on = selected === note.midi;
          return (
            <button key={note.midi} role="option" aria-selected={on} className={`fc-cell ${on ? 'on' : ''}`} onClick={() => onSelect(note)}
              aria-label={`${spelledName(note)} 고르기`} data-testid="note-cell" data-midi={note.midi}>
              <MiniStaff step={note.step} alter={note.alter} octave={note.octave} clef={false} range={range} title={spelledName(note)} />
              <b className="fc-cell-name">{spelledName(note)}</b>
              <small className="fc-cell-sub">{fixedDo(note)}{alt ? ` ${spelledName(alt).replace(/\d+$/, '')}` : ''}</small>
              {labels && (
                <span className="fc-cell-spots">
                  {spots.map((s) => <span key={`${s.string}-${s.pos}`} className={`spot-chip ${s.stretch ? 'stretch' : ''}`} data-testid="spot-chip">{spotChip(s)}</span>)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ── 지판 그림 (가로: 줄감개 왼쪽·E현 위 / 세로: 줄감개 위·G현 왼쪽) ── */
const N_END = 19; // 지판 끝 (7포지션 늘린 4번 = 18반음 + 여유)
const MARK_POS = [0.5, 1, 2, 3, 4, 5, 6, 7];
interface Geo { W: number; H: number; along0: number; len: number; across0: number; gap: number; r: number; fs: number; h: boolean }
const GEO: Record<'h' | 'v', Geo> = {
  h: { W: 1000, H: 256, along0: 72, len: 900, across0: 118, gap: 52, r: 12.5, fs: 13.5, h: true },
  v: { W: 360, H: 690, along0: 70, len: 600, across0: 182, gap: 68, r: 10, fs: 12, h: false },
};
/** 지판 위 점: 줄 s(0=G), 줄감개 쪽에서 n 반음. 지판은 줄감개 쪽이 좁음 */
function makePt(g: Geo) {
  const end = fretPos(N_END);
  const along = (n: number) => g.along0 + (n >= 0 ? fretPos(n) / end : n * 0.04) * g.len;
  const spread = (n: number) => 0.84 + 0.16 * Math.max(0, Math.min(1, fretPos(Math.max(0, n)) / end));
  const across = (s: number, n: number) => (g.h ? -1 : 1) * (s - 1.5) * g.gap * spread(n);
  return (s: number, n: number): [number, number] => {
    const a = along(n), c = g.across0 + across(s, n);
    return g.h ? [a, c] : [c, a];
  };
}

interface BoardSpot extends ChartSpot { note: Spelled; semis: number }
function boardSpots(pos: number, key: ChartKey, s: number): BoardSpot[] {
  if (key === null) return positionSpots(pos, s, key).map((b) => ({ ...b, semis: spotMidi(b) - STRINGS[s] }));
  // 조를 고르면 손가락 1~4 하나씩 (반음으로 붙은 손가락은 막대로)
  return keyShape(key, pos, s).map((f) => ({ string: s, pos, finger: f.finger, rel: f.rel, open: false, stretch: f.rel === 8, note: f.note, semis: f.semis }));
}

function Board({ view, pos, chartKey, target, hits, live, onPick }: {
  view: 'h' | 'v'; pos: number; chartKey: ChartKey; target: Target | null; hits: Hit[];
  live: { string: number; semis: number; tone: string } | null; onPick: (s: ChartSpot, n: Spelled) => void;
}) {
  const g = GEO[view];
  const pt = makePt(g);
  const spots = [0, 1, 2, 3].map((s) => boardSpots(pos, chartKey, s));
  const all = spots.flat();
  const lo = Math.min(...all.map((b) => b.semis), 99), hi = Math.max(...all.map((b) => b.semis), 0);
  const hitAt = (s: number, semis: number) => hits.find((h) => h.string === s && h.semis === semis);
  const chosen = (s: number, semis: number) => !!target?.spot && target.spot.string === s && spotMidi(target.spot) - STRINGS[s] === semis;
  const openSpot = (s: number): ChartSpot => ({ string: s, pos: 0, finger: 0, rel: 0, open: true, stretch: false });
  const quad = (s0: number, s1: number, n0: number, n1: number) => `M${pt(s0, n0)} L${pt(s1, n0)} L${pt(s1, n1)} L${pt(s0, n1)} Z`;
  // 지판 (줄감개 쪽이 좁은 사다리꼴)
  const outline = quad(-0.62, 3.62, 0, N_END);
  const bandPath = all.length ? quad(-0.55, 3.55, Math.max(0, lo - 0.5), hi + 0.5) : null;
  const sw = [3.4, 2.7, 2.0, 1.4]; // G 가장 굵게
  const nameOff = (x: number, y: number): [number, number, 'start' | 'middle'] => (g.h ? [x, y + g.r + g.fs * 0.95, 'middle'] : [x + g.r + 3, y + g.fs * 0.35, 'start']);
  const fingerCls = (f: number) => `f${Math.max(0, Math.min(4, f))}`;

  return (
    <div className={`fc-board-wrap ${view}`}>
      <svg className={`fc-board ${view}`} viewBox={`0 0 ${g.W} ${g.H}`} role="img" aria-label={`${posLabel(pos)} 포지션 지판 (${view === 'h' ? '가로' : '세로'})`} data-testid="board" data-view={view}>
        <defs>
          <linearGradient id={`fb-ebony-${view}`} x1="0" y1="0" x2={g.h ? '0' : '1'} y2={g.h ? '1' : '0'}>
            <stop offset="0" stopColor="#15120f" /><stop offset="0.45" stopColor="#2c2621" /><stop offset="0.55" stopColor="#2a241f" /><stop offset="1" stopColor="#120f0c" />
          </linearGradient>
          <linearGradient id={`fb-sheen-${view}`} x1="0" y1="0" x2={g.h ? '1' : '0'} y2={g.h ? '0' : '1'}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.07" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.04" />
          </linearGradient>
          <filter id={`fb-glow-${view}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <path d={outline} className="fb-shadow" transform={g.h ? 'translate(0 4)' : 'translate(3 3)'} />
        <path d={outline} fill={`url(#fb-ebony-${view})`} className="fb-wood" />
        <path d={outline} fill={`url(#fb-sheen-${view})`} />
        {bandPath && <path d={bandPath} className="fb-band" data-testid="board-band" />}
        {/* 반음 자리 (아주 옅게) */}
        {Array.from({ length: N_END - 1 }, (_, i) => i + 1).map((n) => {
          const [a, b] = [pt(-0.45, n), pt(3.45, n)];
          return <line key={n} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="fb-semi" />;
        })}
        {/* 포지션 자리: 1번 손가락 자리에 자개 점 + 바깥 이름 */}
        {MARK_POS.map((p) => {
          const n = posBase(p);
          const [x, y] = pt(g.h ? 3.42 : -0.42, n);
          const [lx, ly] = pt(-0.7, n);
          const [dx, dy] = g.h ? [7, 0] : [0, 7];
          return (
            <g key={p} className={`fb-mark ${p === pos ? 'now' : ''}`}>
              {p === 7
                ? <><circle cx={x - dx} cy={y - dy} r={2.2} className="fb-pearl" /><circle cx={x + dx} cy={y + dy} r={2.2} className="fb-pearl" /></>
                : <circle cx={x} cy={y} r={2.3} className="fb-pearl" />}
              <text x={lx} y={ly + (g.h ? g.fs * 0.9 : g.fs * 0.35)} textAnchor={g.h ? 'middle' : 'end'} className="fb-poslabel">{posLabel(p)}</text>
            </g>
          );
        })}
        {/* 너트 */}
        {(() => { const [a, b] = [pt(-0.6, 0), pt(3.6, 0)]; return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="fb-nut" />; })()}
        {/* 줄 */}
        {[0, 1, 2, 3].map((s) => {
          const [x1, y1] = pt(s, 0), [x2, y2] = pt(s, N_END + 0.6);
          return (
            <g key={s} className={`fb-str s${s}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="fb-string-shadow" strokeWidth={sw[s] + 1.2} transform={g.h ? 'translate(0 1.5)' : 'translate(1.5 0)'} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="fb-string" strokeWidth={sw[s]} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="fb-string-hi" strokeWidth={Math.max(0.5, sw[s] * 0.3)} />
            </g>
          );
        })}
        {/* 개방현 */}
        {[0, 1, 2, 3].map((s) => {
          const openNote = spell(STRINGS[s], chartKey);
          const isHit = !!hitAt(s, 0);
          const [x, y] = g.h ? [g.along0 - 34, pt(s, 0)[1]] : [pt(s, 0)[0], g.along0 - 34];
          const note = openNote ?? (isHit ? target!.note : null);
          return (
            <g key={s} className={`fb-dot open ${note ? '' : 'out'} ${isHit ? 'hit' : ''} ${chosen(s, 0) ? 'sel' : ''}`} role="button" aria-label={`${STRING_NAMES[s]}현 개방`}
              onClick={() => note && onPick(openSpot(s), note)} data-testid={isHit ? 'board-hit' : undefined}>
              {isHit && <circle cx={x} cy={y} r={g.r + 7} className="fb-halo" filter={`url(#fb-glow-${view})`} />}
              <circle cx={x} cy={y} r={g.r + (isHit ? 2.5 : 1)} />
              <text x={x} y={y + g.fs * 0.38} style={{ fontSize: g.fs + 1 }}>{STRING_NAMES[s]}</text>
            </g>
          );
        })}
        {/* 지금 포지션 손가락 자리 */}
        {[0, 1, 2, 3].map((s) => spots[s].map((b, i) => {
          const prev = spots[s][i - 1];
          const join = chartKey !== null && prev && b.semis - prev.semis === 1;
          const [x, y] = pt(s, b.semis);
          const hit = hitAt(s, b.semis);
          const [nx, ny, na] = nameOff(x, y);
          let bar: JSX.Element | null = null;
          if (join) {
            const [px, py] = pt(s, prev.semis);
            const o = g.r + 5;
            bar = g.h ? <line x1={px} x2={x} y1={py - o} y2={y - o} className="fb-join" /> : <line x1={px - o} x2={x - o} y1={py} y2={y} className="fb-join" />;
          }
          return (
            <g key={`${s}-${b.rel}`}>
              {bar}
              {!hit && (
                <g className={`fb-dot ${fingerCls(b.finger)} ${b.stretch ? 'stretch' : ''} ${target ? 'dim' : ''} ${chosen(s, b.semis) ? 'sel' : ''}`} role="button"
                  aria-label={spotTitle(b, spelledName(b.note))} onClick={() => onPick(b, b.note)} data-testid="board-dot">
                  <circle cx={x} cy={y} r={g.r + 1} className="fb-back" />
                  <circle cx={x} cy={y} r={g.r} />
                  <text x={x} y={y + g.fs * 0.36} style={{ fontSize: g.fs }}>{b.finger}</text>
                  <text x={nx} y={ny} textAnchor={na} className="fb-name" style={{ fontSize: g.fs - 1.5 }}>{spelledName(b.note).replace(/\d+$/, '')}</text>
                </g>
              )}
            </g>
          );
        }))}
        {/* 고른 음 자리: 지금 포지션 안은 진하게, 다른 포지션은 옅게 + 포지션 이름 */}
        {target && hits.filter((h) => !h.open).map((h) => {
          const inPos = hitInPos(h, pos);
          const sp = inPos ?? h.spots[0];
          const [x, y] = pt(h.string, h.semis);
          const [nx, ny, na] = nameOff(x, y);
          
          const others = h.spots.filter((s) => s !== inPos).map((s) => `${posLabel(s.pos)}${s.finger}`);
          return (
            <g key={h.string} className={`fb-dot hit ${inPos ? 'in' : 'other'} ${fingerCls(sp.finger)} ${sp.stretch ? 'stretch' : ''} ${chosen(h.string, h.semis) ? 'sel' : ''}`} role="button"
              aria-label={spotTitle(sp, spelledName(target.note))} onClick={() => onPick(sp, target.note)} data-testid="board-hit" data-inpos={inPos ? '1' : '0'}>
              {inPos && <circle cx={x} cy={y} r={g.r + 8} className="fb-halo" filter={`url(#fb-glow-${view})`} />}
              <circle cx={x} cy={y} r={(inPos ? g.r + 3.5 : g.r) + 1} className="fb-back" />
              <circle cx={x} cy={y} r={inPos ? g.r + 3.5 : g.r} />
              <text x={x} y={y + g.fs * 0.38} style={{ fontSize: inPos ? g.fs + 2 : g.fs - 1 }}>{inPos ? sp.finger : ''}</text>
              {inPos && <text x={nx} y={ny + (g.h ? 3 : 0)} textAnchor={na} className="fb-name strong" style={{ fontSize: g.fs }}>{spelledName(target.note)}</text>}
              {!inPos && <text x={nx} y={ny} textAnchor={na} className="fb-other" style={{ fontSize: g.fs - 2 }}>{others.slice(0, 2).join('·')}</text>}
            </g>
          );
        })}
        {/* 지금 내는 음 (실시간) */}
        {live && (() => {
          const [x, y] = pt(live.string, Math.max(-0.4, Math.min(N_END, live.semis)));
          return (
            <g className={`fb-live ${live.tone}`} data-testid="live-dot" data-string={live.string} data-semis={live.semis.toFixed(2)}>
              <circle cx={x} cy={y} r={g.r * 0.62 + 4} className="fb-live-ring" />
              <circle cx={x} cy={y} r={g.r * 0.5} />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
