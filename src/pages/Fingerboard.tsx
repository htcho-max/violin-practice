import { useEffect, useRef, useState } from 'react';
import { MiniStaff } from '../components/MiniStaff';
import { CentsGauge, centsText } from '../components/CentsGauge';
import { centsBetween, freqToNote, midiToFreq } from '../audio/notes';
import { planPlayback, scorePlayer } from '../score/player';
import type { ParsedScore, ScoreNote } from '../score/parse';
import { STRINGS, STRING_NAMES, type ChartSpot } from '../score/fingering';
import { solfaName } from '../score/solfa';
import { tolFor } from '../score/tolerance';
import { useSettings } from '../state/settings';
import { usePitch } from '../state/usePitch';
import { useWakeLock } from '../state/wakeLock';
import {
  CHART_KEYS, CHART_POSITIONS, enharmonic, fretPos, keyShape, noteRows, positionSpots, posLabel, randomSpot, spell,
  spelledName, spotChip, spotMidi, spotTitle, type ChartKey, type Spelled,
} from '../violin/fingerchart';

type View = 'list' | 'board' | 'shape' | 'practice';
interface Prefs { view: View; key: number | 'all'; maxPos: number; pos: number }
const PREF_KEY = 'violin-fingerchart';
const VIEWS: { id: View; label: string }[] = [
  { id: 'list', label: '음 목록' }, { id: 'board', label: '지판' }, { id: 'shape', label: '손 모양' }, { id: 'practice', label: '짚어 보기' },
];
function loadPrefs(): Prefs {
  const d: Prefs = { view: 'list', key: 'all', maxPos: 7, pos: 1 };
  try {
    const p = { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } as Prefs;
    if (!VIEWS.some((v) => v.id === p.view)) p.view = d.view;
    if (p.key !== 'all' && !CHART_KEYS.some((k) => k.id === p.key)) p.key = d.key;
    if (![1, 3, 5, 7].includes(p.maxPos)) p.maxPos = d.maxPos;
    if (!CHART_POSITIONS.includes(p.pos)) p.pos = d.pos;
    return p;
  } catch { return d; }
}

export interface Target { spot: ChartSpot; midi: number; note: Spelled }

/** 음 이름 두 가지: C D E (옥타브) + 고정 도 */
const fixedDo = (n: Spelled) => solfaName(n.step, n.alter, 0, 'fixed');

/** 음 여러 개를 바이올린 샘플로 (따라 하기와 같은 재생기) */
function playMidis(midis: number[], a4: number, beats = 1.2) {
  const ns: ScoreNote[] = midis.map((midi, i) => ({ measure: 1, index: i, midi, beat: i * beats, dur: beats }));
  const len = midis.length * beats;
  const s: ParsedScore = { title: '', measures: [1], notes: ns, measureLen: new Map([[1, len]]), time: [Math.max(1, Math.ceil(len)), 4], parts: [''], dyn: [], measureStart: new Map([[1, 0]]), bars: [] };
  void scorePlayer.play(planPlayback(s, { bpm: midis.length > 1 ? 120 : 60, from: 1, to: 1, countIn: false }), { a4, click: false, voice: 'sample' });
}

/** 튜너 탭 → 운지표: 음 목록 · 지판 · 조별 손 모양 · 짚어 보기 */
export function Fingerboard() {
  const { settings } = useSettings();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 무시 */ } }, [prefs]);
  const set = (p: Partial<Prefs>) => setPrefs((o) => ({ ...o, ...p }));
  const key: ChartKey = prefs.key === 'all' ? null : prefs.key;
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => () => scorePlayer.stop(), []);
  const play = (m: number | number[]) => playMidis(Array.isArray(m) ? m : [m], settings.a4);
  const pick = (spot: ChartSpot, note: Spelled) => { setTarget({ spot, midi: note.midi, note }); play(note.midi); };

  const keySelect = (
    <label className="fc-key">
      <span>조</span>
      <select value={String(prefs.key)} onChange={(e) => set({ key: e.target.value === 'all' ? 'all' : Number(e.target.value) })} data-testid="chart-key">
        {CHART_KEYS.map((k) => <option key={String(k.id)} value={k.id === null ? 'all' : String(k.id)}>{k.label}</option>)}
      </select>
    </label>
  );
  const posChips = (
    <div className="chips fc-pos" role="group" aria-label="포지션">
      {CHART_POSITIONS.map((p) => (
        <button key={p} className={`chip ${prefs.pos === p ? 'on' : ''}`} onClick={() => set({ pos: p })} data-testid={`pos-${p}`}>{posLabel(p)}</button>
      ))}
    </div>
  );

  return (
    <div className="page-sub fingerchart">
      <div className="segmented" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={prefs.view === v.id} className={prefs.view === v.id ? 'on' : ''} onClick={() => set({ view: v.id })} data-testid={`fc-${v.id}`}>{v.label}</button>
        ))}
      </div>

      {prefs.view === 'list' && (
        <>
          <div className="fc-bar">
            {keySelect}
            <div className="fc-maxpos">
              <span>최고 포지션</span>
              <div className="segmented small">
                {[1, 3, 5, 7].map((p) => <button key={p} className={prefs.maxPos === p ? 'on' : ''} onClick={() => set({ maxPos: p })} data-testid={`maxpos-${p}`}>{p}</button>)}
              </div>
            </div>
          </div>
          <NoteList chartKey={key} maxPos={prefs.maxPos} target={target} onPick={pick} onPlay={play} />
        </>
      )}

      {prefs.view === 'board' && (
        <>
          <div className="fc-bar">{keySelect}</div>
          {posChips}
          <Board pos={prefs.pos} chartKey={key} target={target} onPick={pick} />
        </>
      )}

      {prefs.view === 'shape' && (
        <>
          <div className="fc-bar">{keySelect}</div>
          {posChips}
          {key === null
            ? <p className="hint">손 모양은 조를 골라야 보여요. 위에서 조를 골라 주세요.</p>
            : <Shapes fifths={key} pos={prefs.pos} onPlay={play} />}
        </>
      )}

      {prefs.view === 'practice' && (
        <Practice target={target} setTarget={setTarget} pos={prefs.pos} chartKey={key} onPlay={play} posChips={posChips} keySelect={keySelect} />
      )}
    </div>
  );
}

function NoteList({ chartKey, maxPos, target, onPick, onPlay }: { chartKey: ChartKey; maxPos: number; target: Target | null; onPick: (s: ChartSpot, n: Spelled) => void; onPlay: (m: number) => void }) {
  const rows = noteRows(chartKey, maxPos);
  return (
    <div className="fc-list" data-testid="note-list">
      {rows.map(({ note, spots }) => {
        const alt = chartKey === null ? enharmonic(note.midi) : null;
        return (
          <div key={note.midi} className="fc-row">
            <button className="fc-note" onClick={() => onPlay(note.midi)} aria-label={`${spelledName(note)} 듣기`}>
              <MiniStaff step={note.step} alter={note.alter} octave={note.octave} title={spelledName(note)} />
              <span className="fc-name"><b>{spelledName(note)}</b><small>{fixedDo(note)}{alt ? ` · ${spelledName(alt)}` : ''}</small></span>
            </button>
            <div className="chips fc-spots">
              {spots.map((s) => {
                const on = target?.midi === note.midi && target.spot.string === s.string && target.spot.pos === s.pos;
                return (
                  <button key={`${s.string}-${s.pos}`} className={`chip spot-chip ${on ? 'on' : ''} ${s.stretch ? 'stretch' : ''}`} onClick={() => onPick(s, note)} data-testid="spot-chip">
                    {spotChip(s)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 지판 그림 ── */
const BW = 360, TOP = 40, BH = 600, N_MAX = 20;
const strX = (s: number) => 54 + s * 84;
const semY = (n: number) => TOP + (fretPos(n) / fretPos(N_MAX)) * BH;

interface BoardSpot extends ChartSpot { note: Spelled; semis: number }
function boardSpots(pos: number, key: ChartKey, s: number): BoardSpot[] {
  const base = positionSpots(pos, s, key);
  if (key === null) return base.map((b) => ({ ...b, semis: spotMidi(b) - STRINGS[s] }));
  // 조를 고르면 손 모양(손가락 1~4 하나씩)과 같게
  const sh = keyShape(key, pos, s);
  return sh.fingers.map((f) => ({ string: s, pos, finger: f.finger, rel: f.rel, open: false, stretch: f.rel === 8, note: f.note, semis: f.semis }));
}

function Board({ pos, chartKey, target, onPick }: { pos: number; chartKey: ChartKey; target: Target | null; onPick: (s: ChartSpot, n: Spelled) => void }) {
  const spots = [0, 1, 2, 3].map((s) => boardSpots(pos, chartKey, s));
  const all = spots.flat();
  const lo = Math.min(...all.map((b) => b.semis), 99), hi = Math.max(...all.map((b) => b.semis), 0);
  const isOn = (b: ChartSpot, midi: number) => !!target && target.midi === midi && target.spot.string === b.string && (b.open ? target.spot.open : target.spot.pos === b.pos);
  const openSpot = (s: number): ChartSpot => ({ string: s, pos: 0, finger: 0, rel: 0, open: true, stretch: false });
  return (
    <div className="fc-board-wrap">
      <svg className="fc-board" viewBox={`0 0 ${BW} ${TOP + BH + 16}`} role="img" aria-label={`${posLabel(pos)} 포지션 지판`} data-testid="board">
        <rect x={20} y={TOP} width={BW - 40} height={BH} rx={6} className="fb-wood" />
        {all.length > 0 && <rect x={22} y={semY(lo - 0.5)} width={BW - 44} height={semY(hi + 0.5) - semY(lo - 0.5)} className="fb-band" />}
        {Array.from({ length: N_MAX }, (_, i) => i + 1).map((n) => (
          <g key={n}>
            <line x1={22} x2={BW - 22} y1={semY(n)} y2={semY(n)} className={n === 12 ? 'fb-semi oct' : 'fb-semi'} />
            {n % 12 === 0 || n === 7 || n === 5 ? <text x={14} y={semY(n) + 3} className="fb-num" textAnchor="end">{n}</text> : null}
          </g>
        ))}
        <rect x={18} y={TOP - 6} width={BW - 36} height={6} rx={2} className="fb-nut" />
        {[0, 1, 2, 3].map((s) => {
          const openNote = spell(STRINGS[s], chartKey);
          const open = openSpot(s);
          return (
            <g key={s}>
              <line x1={strX(s)} x2={strX(s)} y1={TOP - 6} y2={TOP + BH} className="fb-string" strokeWidth={2.6 - s * 0.45} />
              <g className={`fb-dot open ${openNote ? '' : 'out'} ${isOn(open, STRINGS[s]) ? 'on' : ''}`} role="button" aria-label={`${STRING_NAMES[s]}현 개방`}
                onClick={() => openNote && onPick(open, openNote)}>
                <circle cx={strX(s)} cy={TOP - 22} r={11} />
                <text x={strX(s)} y={TOP - 18}>{STRING_NAMES[s]}</text>
              </g>
              {spots[s].map((b, i) => {
                const prev = spots[s][i - 1];
                const join = chartKey !== null && prev && b.semis - prev.semis === 1;
                return (
                  <g key={b.rel}>
                    {join && <line x1={strX(s) - 12} x2={strX(s) - 12} y1={semY(prev.semis)} y2={semY(b.semis)} className="fb-join" />}
                    <g className={`fb-dot ${b.stretch ? 'stretch' : ''} ${isOn(b, b.note.midi) ? 'on' : ''}`} role="button" aria-label={spotTitle(b, spelledName(b.note))}
                      onClick={() => onPick(b, b.note)} data-testid="board-dot">
                      <circle cx={strX(s)} cy={semY(b.semis)} r={8.5} />
                      <text x={strX(s)} y={semY(b.semis) + 3.6}>{b.finger}</text>
                      <text x={strX(s) + 12} y={semY(b.semis) + 3.6} className="fb-name">{spelledName(b.note).replace(/\d+$/, '')}</text>
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="fc-board-side">
        <p className="hint">{chartKey === null ? '반음 자리를 모두 보여 줘요. 같은 번호가 두 개면 낮은·높은 자리예요.' : '조의 음만 보여 줘요. 왼쪽 막대는 반음으로 붙은 손가락이에요.'} 점선(늘림)은 4번을 늘려 닿는 자리예요.</p>
        {[3, 2, 1, 0].map((s) => (
          <div key={s} className="fc-side-row" data-testid={`board-row-${STRING_NAMES[s]}`}>
            <b>{STRING_NAMES[s]}현</b>
            <span>{spots[s].map((b) => `${b.finger}${b.stretch ? '(늘림)' : ''} ${spelledName(b.note)}`).join(' · ') || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shapes({ fifths, pos, onPlay }: { fifths: number; pos: number; onPlay: (m: number[]) => void }) {
  return (
    <div className="card fc-shapes">
      {[3, 2, 1, 0].map((s) => {
        const sh = keyShape(fifths, pos, s);
        // 음 이름도 같은 간격으로: 붙은 반음은 |
        let names = '';
        sh.fingers.forEach((f, i) => { if (i) names += f.semis - sh.fingers[i - 1].semis === 1 ? '|' : ' '; names += spelledName(f.note).replace(/\d+$/, ''); });
        const midis = sh.fingers.map((f) => STRINGS[s] + f.semis);
        return (
          <button key={s} className="fc-shape" onClick={() => onPlay(sh.openInKey ? [STRINGS[s], ...midis] : midis)} data-testid={`shape-${STRING_NAMES[s]}`}>
            <b className="fc-shape-str">{STRING_NAMES[s]}현</b>
            <span className="fc-pattern">{sh.pattern}</span>
            <span className="fc-pattern names">{names}</span>
            <small className="fc-tags">{sh.tags.join(' · ')}{sh.openInKey ? '' : ` · 개방 ${STRING_NAMES[s]} 안 씀`}</small>
          </button>
        );
      })}
      <p className="hint">| 는 반음으로 붙은 손가락, 띄어 쓴 곳은 온음이에요. 누르면 소리로 들려줘요.</p>
    </div>
  );
}

/* ── 짚어 보기 ── */
const HOLD = 0.5;
function stepWord(n: number) { return n === 1 ? '반음' : n === 2 ? '온음' : n === 12 ? '한 옥타브' : `${n}반음`; }

function Practice({ target, setTarget, pos, chartKey, onPlay, posChips, keySelect }: {
  target: Target | null; setTarget: (t: Target | null) => void; pos: number; chartKey: ChartKey; onPlay: (m: number) => void; posChips: JSX.Element; keySelect: JSX.Element;
}) {
  const { settings } = useSettings();
  const pitch = usePitch(settings.minDb);
  useWakeLock(pitch.on, settings.wakeLock);
  const tol = tolFor(settings.pitchTolerance);
  const [tally, setTally] = useState({ right: 0, tries: 0 });
  const [done, setDone] = useState(false);
  const hold = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** 다음 자리: 골라 주기는 고른 포지션에서, 맞힌 뒤에는 지금 목표의 포지션에서 이어서 */
  const next = (keepPos = false) => {
    const p = keepPos && target && !target.spot.open ? target.spot.pos : pos;
    const s = randomSpot(p, chartKey, Math.random, target?.midi);
    hold.current = null; setDone(false);
    if (!s) return;
    setTarget({ spot: s, midi: spotMidi(s), note: s.note });
    onPlay(spotMidi(s));
  };

  const a4 = settings.a4;
  const freq = pitch.reading?.freq ?? null;
  let cents: number | null = null, nowName = '—', msg = pitch.on ? '소리를 내 주세요' : '마이크를 켜 주세요';
  let good = false;
  if (target && freq) {
    const n = freqToNote(freq, a4);
    const c = centsBetween(freq, midiToFreq(target.midi, a4));
    const sp = spell(n.midi, chartKey) ?? spell(n.midi, null)!;
    nowName = spelledName(sp);
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

  return (
    <>
      <div className="fc-bar">{keySelect}</div>
      {posChips}
      <div className={`card fc-practice ${done ? 'in-tune' : ''}`}>
        <div className="fc-target" data-testid="practice-target">
          {target ? spotTitle(target.spot, spelledName(target.note)) : '음 목록이나 지판에서 자리를 누르거나, 골라 주기를 눌러 주세요'}
        </div>
        {target && <div className="muted fc-target-sub">{fixedDo(target.note)} · 기준 ±{tol.good}센트 안에서 {HOLD}초</div>}
        <div className="fc-reading">
          <span className="note-mid" data-testid="practice-now">{nowName}</span>
          <span className="cents-num" data-testid="practice-cents">{centsText(cents)}<small> 센트</small></span>
        </div>
        <CentsGauge cents={cents} label="짚은 음 게이지" />
        <p className={`fc-msg ${done ? 'good' : ''}`} data-testid="practice-msg">{msg}</p>
        <div className="fc-actions">
          <button className="secondary" onClick={() => next()} data-testid="practice-pick">🎲 골라 주기</button>
          <button className="secondary" onClick={() => target && onPlay(target.midi)} disabled={!target} data-testid="practice-ref">▶ 참고 소리</button>
          <button className="secondary" onClick={() => { if (!target) return; setTally((x) => ({ ...x, tries: x.tries + 1 })); next(true); }} disabled={!target || done}>건너뛰기</button>
        </div>
        <button className={`primary wide ${pitch.on ? 'stop' : ''}`} onClick={pitch.on ? pitch.stop : pitch.start} data-testid="practice-mic">
          {pitch.on ? '마이크 끄기' : '마이크 켜기'}
        </button>
        {pitch.error && <p className="error">{pitch.error}</p>}
        <div className="fc-tally" data-testid="practice-tally">맞힘 {tally.right} / 시도 {tally.tries}</div>
      </div>
    </>
  );
}
