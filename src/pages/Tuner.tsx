import { useEffect, useRef, useState } from 'react';
import { CentsGauge, centsText } from '../components/CentsGauge';
import { usePitch } from '../state/usePitch';
import { useSettings } from '../state/settings';
import { useWakeLock } from '../state/wakeLock';
import { OPEN_STRINGS, NOTE_NAMES_KO, centsBetween, freqToNote, midiToFreq, nearestString, type OpenString } from '../audio/notes';
import { playTone } from '../audio/tone';
import { Fingerboard } from './Fingerboard';

type Mode = 'auto' | 'string';
type View = 'tuner' | 'chart';
const VIEW_KEY = 'violin-tuner-view';

/** 튜너 탭: 튜너 | 운지표 (고른 쪽 기억) */
export function Tuner() {
  const [view, setView] = useState<View>(() => { try { return localStorage.getItem(VIEW_KEY) === 'chart' ? 'chart' : 'tuner'; } catch { return 'tuner'; } });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* 무시 */ } }, [view]);
  return (
    <section className={`page ${view === 'chart' ? 'fc-page' : 'tuner'}`}>
      <div className="segmented small tuner-switch">
        <button className={view === 'tuner' ? 'on' : ''} onClick={() => setView('tuner')} data-testid="view-tuner">튜너</button>
        <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')} data-testid="view-chart">운지표</button>
      </div>
      {view === 'tuner' ? <TunerMain /> : <Fingerboard />}
    </section>
  );
}

function TunerMain() {
  const { settings, update } = useSettings();
  const { reading, on, error, start, stop } = usePitch(settings.minDb);
  const [mode, setMode] = useState<Mode>('auto');
  const [target, setTarget] = useState<OpenString>(OPEN_STRINGS[2]);
  const [refOn, setRefOn] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  useWakeLock(on || refOn, settings.wakeLock);

  const a4 = settings.a4;
  const freq = reading?.freq ?? null;
  const note = freq ? freqToNote(freq, a4) : null;
  const near = freq ? nearestString(freq, a4) : null;

  let cents: number | null = null;
  let mainLabel = '—';
  let subLabel = on ? '소리를 내 주세요' : '마이크를 켜 주세요';
  if (mode === 'auto' && note) {
    cents = note.cents;
    mainLabel = `${note.name}${note.octave}`;
    subLabel = NOTE_NAMES_KO[note.name];
  } else if (mode === 'string') {
    mainLabel = `${target.name}현`;
    subLabel = `${midiToFreq(target.midi, a4).toFixed(1)} Hz`;
    if (freq) {
      const c = centsBetween(freq, midiToFreq(target.midi, a4));
      cents = Math.abs(c) <= 300 ? c : null; // 다른 현 소리는 무시
    }
  }
  const tight = cents !== null && Math.abs(cents) <= 5;
  const highlighted = mode === 'string' ? target.name : near && Math.abs(near.cents) < 100 ? near.string.name : null;

  const stopRef0 = () => { stopRef.current?.(); stopRef.current = null; setRefOn(false); };
  useEffect(() => () => { stopRef.current?.(); }, []);

  async function tapString(s: OpenString) {
    if (mode === 'string') {
      setTarget(s);
      if (refOn) { stopRef.current?.(); stopRef.current = await playTone(midiToFreq(s.midi, a4)); }
    } else {
      stopRef0();
      await playTone(midiToFreq(s.midi, a4), 2.5);
    }
  }
  async function toggleRef() {
    if (refOn) return stopRef0();
    stopRef.current = await playTone(midiToFreq(target.midi, a4));
    setRefOn(true);
  }

  return (
    <>
      <div className="segmented">
        <button className={mode === 'auto' ? 'on' : ''} onClick={() => { setMode('auto'); stopRef0(); }}>자동</button>
        <button className={mode === 'string' ? 'on' : ''} onClick={() => setMode('string')}>현 선택</button>
      </div>

      <div className={`tuner-display ${tight ? 'in-tune' : ''}`}>
        <div className="note-big" data-testid="note">{mainLabel}</div>
        <div className="note-sub">{subLabel}</div>
        <div className="cents-num" data-testid="cents">{centsText(cents)}<small> 센트</small></div>
        <CentsGauge cents={cents} />
        <div className="freq">{freq ? `${freq.toFixed(1)} Hz` : ' '}</div>
      </div>

      <div className="strings">
        {OPEN_STRINGS.map((s) => (
          <button key={s.name} className={`string-btn ${highlighted === s.name ? 'hl' : ''}`} onClick={() => tapString(s)}>
            <b>{s.name}</b>
            <small>{mode === 'auto' ? '▶ 기준음' : target.name === s.name ? '선택됨' : '선택'}</small>
          </button>
        ))}
      </div>
      {mode === 'string' && (
        <button className={`wide ${refOn ? 'secondary on' : 'secondary'}`} onClick={toggleRef}>
          {refOn ? `■ ${target.name}현 기준음 끄기` : `▶ ${target.name}현 기준음 계속 듣기`}
        </button>
      )}

      <button className={`primary wide ${on ? 'stop' : ''}`} onClick={on ? stop : start}>
        {on ? '마이크 끄기' : '마이크 켜기'}
      </button>
      {error && <p className="error">{error}</p>}

      <div className="row-setting">
        <span>기준 A</span>
        <button className="mini" onClick={() => update({ a4: Math.max(438, a4 - 1) })}>−</button>
        <b>{a4} Hz</b>
        <button className="mini" onClick={() => update({ a4: Math.min(445, a4 + 1) })}>＋</button>
      </div>
    </>
  );
}
