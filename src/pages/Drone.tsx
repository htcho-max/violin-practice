import { useEffect, useMemo, useState } from 'react';
import { drone, DRONE_PRESETS } from '../audio/drone';
import { NOTE_NAMES, NOTE_NAMES_KO, JUST_RATIOS, intervalName, freqToNote, justCents, midiName, midiToFreq } from '../audio/notes';
import { equalRef, justRef, summarize } from '../audio/segment';
import { vibratoAdvice } from '../audio/vibrato';
import { CentsGauge, centsText } from '../components/CentsGauge';
import { CentsTrace } from '../components/CentsTrace';
import { usePieces } from '../state/usePieces';
import { useSettings } from '../state/settings';
import { usePitch } from '../state/usePitch';
import { useAnalysis } from '../state/useAnalysis';
import { useAudioStatus, setAudioStatus } from '../state/audioStatus';
import { useWakeLock } from '../state/wakeLock';
import { EchoTrainer } from './EchoTrainer';

type Ref = 'equal' | 'just';
type Mode = 'graph' | 'arrival' | 'vibrato' | 'echo';

const fmt = (c: number | null) => (c === null ? '—' : centsText(c));
const tone = (c: number | null) => (c === null ? '' : Math.abs(c) <= 5 ? 'good' : Math.abs(c) <= 15 ? 'warn' : 'bad');

export function Drone() {
  const { settings, update } = useSettings();
  const { drone: playing } = useAudioStatus();
  const pieces = usePieces();
  const [root, setRoot] = useState(55); // G3
  const [fifth, setFifth] = useState(true);
  const [refMode, setRefMode] = useState<Ref>('just');
  const [mode, setMode] = useState<Mode>('graph');
  const pitch = usePitch(settings.minDb);
  useWakeLock(playing || pitch.on, settings.wakeLock);

  const a4 = settings.a4;
  const rootFreq = midiToFreq(root, a4);
  const label = `${midiName(root)}${fifth ? ' + 5도' : ''}`;
  const useJust = refMode === 'just' && playing;
  const reference = useMemo(() => (useJust ? justRef(root, a4, JUST_RATIOS) : equalRef(a4)), [useJust, root, a4]);
  const an = useAnalysis(reference);
  const vibSource = useMemo(() => ({ get current() { return an.raw.current.pts.map((p) => ({ ...p, midi: an.raw.current.midi })); } }), [an.raw]);

  async function play(r = root, f = fifth) {
    const base = midiToFreq(r, a4);
    const voices = [{ freq: base, gain: 1 }];
    if (f) voices.push({ freq: base * 1.5, gain: 0.6 }); // 순정 5도
    drone.volume = settings.droneVolume;
    await drone.start(voices);
    setAudioStatus({ drone: true, droneLabel: `${midiName(r)}${f ? '+5' : ''}` });
  }
  function stopDrone() { drone.stop(); setAudioStatus({ drone: false }); }

  useEffect(() => { if (drone.playing) play(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [root, fifth, a4]);
  useEffect(() => { drone.setVolume(settings.droneVolume); }, [settings.droneVolume]);

  const freq = pitch.reading?.freq ?? null;
  const note = freq ? freqToNote(freq, a4) : null;
  const jc = freq ? justCents(freq, rootFreq) : null;
  const cents = useJust ? jc?.cents ?? null : note?.cents ?? null;

  const octave = Math.floor(root / 12) - 1;
  const pc = root % 12;
  const summary = summarize(an.notes);
  const recent = an.notes.slice(-8).reverse();
  const withSettle = an.notes.filter((n) => n.settledCents !== null);
  const corrected = withSettle.filter((n) => n.corrected).length;
  const arrAbs = an.notes.length ? an.notes.reduce((a, n) => a + Math.abs(n.arrivalCents), 0) / an.notes.length : null;

  return (
    <section className="page drone">
      <details className="card" open={!pitch.on}>
        <summary className="card-summary"><b>드론</b> <span className="muted">{playing ? `켜짐 · ${label}` : '꺼짐'}</span></summary>
        <div className="chips">
          {DRONE_PRESETS.map((p) => (
            <button key={p.id} className={p.rootMidi === root ? 'chip on' : 'chip'} onClick={() => setRoot(p.rootMidi)}>{p.label}</button>
          ))}
        </div>
        <details className="pieces">
          <summary>곡으로 고르기</summary>
          <ul>
            {pieces.filter((p) => DRONE_PRESETS.some((d) => d.id === p.key)).map((p) => {
              const preset = DRONE_PRESETS.find((d) => d.id === p.key)!;
              return <li key={p.id}><button className="link" onClick={() => setRoot(preset.rootMidi)}>{p.title} <small>({preset.label})</small></button></li>;
            })}
          </ul>
        </details>
        <div className="note-grid">
          {NOTE_NAMES.map((n, i) => (
            <button key={n} className={i === pc ? 'chip on' : 'chip'} onClick={() => setRoot((octave + 1) * 12 + i)}>{n}</button>
          ))}
        </div>
        <div className="row-setting">
          <span>옥타브</span>
          {[3, 4].map((o) => (
            <button key={o} className={o === octave ? 'chip on' : 'chip'} onClick={() => setRoot((o + 1) * 12 + pc)}>{o}</button>
          ))}
          <label><input type="checkbox" checked={fifth} onChange={(e) => setFifth(e.target.checked)} /> 5도 함께</label>
        </div>
        <div className="row-setting">
          <span>음량</span>
          <input type="range" min={0.05} max={0.8} step={0.05} value={settings.droneVolume} onChange={(e) => update({ droneVolume: Number(e.target.value) })} aria-label="드론 음량" />
        </div>
      </details>
      <button className={`primary wide big ${playing ? 'stop' : ''}`} onClick={() => (playing ? stopDrone() : play())} data-testid="drone-toggle">
        {playing ? `■ 드론 끄기 (${label})` : `▶ 드론 켜기 (${label})`}
      </button>

      <div className="card">
        <div className="card-head">
          <b>내 음정</b>
          <div className="segmented small">
            <button className={refMode === 'just' ? 'on' : ''} onClick={() => setRefMode('just')}>드론 기준 순정률</button>
            <button className={refMode === 'equal' ? 'on' : ''} onClick={() => setRefMode('equal')}>평균율</button>
          </div>
        </div>
        {refMode === 'just' && !playing && <p className="hint">드론을 켜면 드론 기준 순정률로 계산해요. 지금은 평균율이에요.</p>}
        <div className="drone-reading">
          <span className="note-mid">{note ? `${note.name}${note.octave}` : '—'}</span>
          <span className="muted">{note ? `${NOTE_NAMES_KO[note.name]}${useJust && jc ? ` · 드론에서 ${intervalName(jc.semis, jc.octave)}` : ''}` : pitch.on ? '소리를 내 주세요' : ''}</span>
          <span className="cents-num">{centsText(cents)}<small> 센트</small></span>
        </div>
        <CentsGauge cents={cents} />
        <button className={`secondary wide ${pitch.on ? 'on' : ''}`} onClick={pitch.on ? pitch.stop : pitch.start} data-testid="mic-toggle">
          {pitch.on ? '마이크 끄기' : '마이크 켜고 음정 보기'}
        </button>
        {pitch.error && <p className="error">{pitch.error}</p>}
      </div>

      <div className="segmented">
        <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>음정 그래프</button>
        <button className={mode === 'arrival' ? 'on' : ''} onClick={() => setMode('arrival')}>도착 음정</button>
        <button className={mode === 'vibrato' ? 'on' : ''} onClick={() => setMode('vibrato')}>비브라토</button>
        <button className={mode === 'echo' ? 'on' : ''} onClick={() => setMode('echo')} data-testid="mode-echo">따라 하기</button>
      </div>

      {mode === 'echo' && <EchoTrainer pitch={pitch} beforePlay={() => { if (drone.playing) stopDrone(); }} />}

      {mode === 'graph' && (
        <div className="card">
          <div className="card-head"><b>최근 10초</b><button className="mini" onClick={an.reset}>지우기</button></div>
          <CentsTrace source={an.trace} seconds={10} testId="trace" />
          <b>음별 평균 오차</b>
          {summary.length === 0 ? <p className="muted small">음을 0.15초 이상 내면 여기에 쌓여요. 음계를 천천히 연주해 보세요.</p> : (
            <table className="tbl" data-testid="note-summary">
              <thead><tr><th>음</th><th>평균</th><th>횟수</th></tr></thead>
              <tbody>
                {summary.slice(0, 12).map((s) => (
                  <tr key={s.midi}><td>{midiName(s.midi)}</td><td className={tone(s.meanCents)}>{fmt(s.meanCents)}</td><td>{s.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">순정률에서는 장3도가 평균율보다 약 14센트 낮고, 완전5도는 2센트 높아요. 드론과 맥놀이가 사라지는 지점을 귀로 찾고 숫자로 확인하세요.</p>
        </div>
      )}

      {mode === 'arrival' && (
        <div className="card">
          <div className="card-head"><b>도착 음정</b><button className="mini" onClick={an.reset}>지우기</button></div>
          <p className="hint">음을 시작한 뒤 0.05~0.3초의 음정(도착)과 그 뒤의 음정(안정)을 따로 봐요. 포지션 이동 뒤 도착이 틀렸다가 고쳐 잡으면 표시돼요.</p>
          {an.notes.length > 0 && (
            <div className="stats">
              <div><b>{an.notes.length}</b><span>음</span></div>
              <div><b>{arrAbs === null ? '—' : `±${Math.round(arrAbs)}`}</b><span>도착 평균 오차</span></div>
              <div><b>{corrected}</b><span>고쳐 잡음</span></div>
            </div>
          )}
          {recent.length === 0 ? <p className="muted small">예: A현 1포지션 B(1) → 3포지션 D(1)로 이동, 0.5초 이상 길게.</p> : (
            <table className="tbl" data-testid="arrival-table">
              <thead><tr><th>음</th><th>도착</th><th>안정</th><th></th></tr></thead>
              <tbody>
                {recent.map((n) => (
                  <tr key={n.start}>
                    <td>{midiName(n.midi)}</td>
                    <td className={tone(n.arrivalCents)}>{fmt(n.arrivalCents)}</td>
                    <td className={tone(n.settledCents)}>{fmt(n.settledCents)}</td>
                    <td>{n.corrected ? <span className="badge">고쳐 잡음</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {mode === 'vibrato' && (
        <div className="card">
          <div className="card-head"><b>비브라토</b><button className="mini" onClick={an.reset}>지우기</button></div>
          <p className="hint">한 음을 1초 이상 길게, 비브라토를 넣어 연주하세요. 최근 1초를 분석해요.</p>
          <CentsTrace source={vibSource} seconds={1.2} range={60} height={140} labels={false} />
          {an.vibrato ? (
            <>
              <div className="stats" data-testid="vibrato-stats">
                <div><b>{an.vibrato.v.rateHz.toFixed(1)} Hz</b><span>속도</span></div>
                <div><b>±{Math.round(an.vibrato.v.widthCents)}</b><span>폭(센트)</span></div>
                <div><b className={tone(an.vibrato.v.centerCents)}>{centsText(an.vibrato.v.centerCents)}</b><span>중심</span></div>
              </div>
              <div className="muted small">{midiName(an.vibrato.midi)} · 가장 높이 {centsText(an.vibrato.v.topCents)}, 가장 낮게 {centsText(an.vibrato.v.bottomCents)}</div>
              <ul className="advice">{vibratoAdvice(an.vibrato.v).map((a) => <li key={a}>{a}</li>)}</ul>
            </>
          ) : <p className="muted small">{pitch.on ? '아직 비브라토가 감지되지 않았어요 (초당 3~9번, 폭 3센트 이상).' : '먼저 마이크를 켜 주세요.'}</p>}
        </div>
      )}
    </section>
  );
}
