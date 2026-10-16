import { useEffect, useState } from 'react';
import { drone, DRONE_PRESETS } from '../audio/drone';
import { NOTE_NAMES, NOTE_NAMES_KO, intervalName, freqToNote, justCents, midiName, midiToFreq } from '../audio/notes';
import { BOOK4_PIECES } from '../data/pieces';
import { CentsGauge, centsText } from '../components/CentsGauge';
import { useSettings } from '../state/settings';
import { usePitch } from '../state/usePitch';
import { useAudioStatus, setAudioStatus } from '../state/audioStatus';
import { useWakeLock } from '../state/wakeLock';

type Ref = 'equal' | 'just';

export function Drone() {
  const { settings, update } = useSettings();
  const { drone: playing } = useAudioStatus();
  const [root, setRoot] = useState(55); // G3
  const [fifth, setFifth] = useState(true);
  const [ref, setRef] = useState<Ref>('just');
  const pitch = usePitch(settings.minDb);
  useWakeLock(playing || pitch.on, settings.wakeLock);

  const a4 = settings.a4;
  const rootFreq = midiToFreq(root, a4);
  const label = `${midiName(root)}${fifth ? ' + 5도' : ''}`;

  async function play(r = root, f = fifth) {
    const base = midiToFreq(r, a4);
    const voices = [{ freq: base, gain: 1 }];
    if (f) voices.push({ freq: base * 1.5, gain: 0.6 }); // 순정 5도
    drone.volume = settings.droneVolume;
    await drone.start(voices);
    setAudioStatus({ drone: true, droneLabel: `${midiName(r)}${f ? '+5' : ''}` });
  }
  function stopDrone() { drone.stop(); setAudioStatus({ drone: false }); }

  // 재생 중 설정이 바뀌면 바로 반영
  useEffect(() => { if (drone.playing) play(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [root, fifth, a4]);
  useEffect(() => { drone.setVolume(settings.droneVolume); }, [settings.droneVolume]);

  const freq = pitch.reading?.freq ?? null;
  const note = freq ? freqToNote(freq, a4) : null;
  const jc = freq ? justCents(freq, rootFreq) : null;
  const cents = ref === 'just' ? jc?.cents ?? null : note?.cents ?? null;

  const octave = Math.floor(root / 12) - 1;
  const pc = root % 12;

  return (
    <section className="page drone">
      <h3>조성</h3>
      <div className="chips">
        {DRONE_PRESETS.map((p) => (
          <button key={p.id} className={p.rootMidi === root ? 'chip on' : 'chip'} onClick={() => setRoot(p.rootMidi)}>{p.label}</button>
        ))}
      </div>
      <details className="pieces">
        <summary>4권 곡으로 고르기</summary>
        <ul>
          {BOOK4_PIECES.map((p) => {
            const preset = DRONE_PRESETS.find((d) => d.id === p.key)!;
            return (
              <li key={p.id}><button className="link" onClick={() => setRoot(preset.rootMidi)}>{p.title} <small>({preset.label})</small></button></li>
            );
          })}
        </ul>
      </details>

      <h3>드론 음</h3>
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
      <button className={`primary wide big ${playing ? 'stop' : ''}`} onClick={() => (playing ? stopDrone() : play())} data-testid="drone-toggle">
        {playing ? `■ 드론 끄기 (${label})` : `▶ 드론 켜기 (${label})`}
      </button>

      <div className="card">
        <div className="card-head">
          <b>내 음정</b>
          <div className="segmented small">
            <button className={ref === 'just' ? 'on' : ''} onClick={() => setRef('just')}>드론 기준 순정률</button>
            <button className={ref === 'equal' ? 'on' : ''} onClick={() => setRef('equal')}>평균율</button>
          </div>
        </div>
        <div className="drone-reading">
          <span className="note-mid">{note ? `${note.name}${note.octave}` : '—'}</span>
          <span className="muted">{note ? `${NOTE_NAMES_KO[note.name]}${ref === 'just' && jc ? ` · 드론에서 ${intervalName(jc.semis, jc.octave)}` : ''}` : pitch.on ? '소리를 내 주세요' : ''}</span>
          <span className="cents-num">{centsText(cents)}<small> 센트</small></span>
        </div>
        <CentsGauge cents={cents} />
        <button className={`secondary wide ${pitch.on ? 'on' : ''}`} onClick={pitch.on ? pitch.stop : pitch.start}>
          {pitch.on ? '마이크 끄기' : '마이크 켜고 음정 보기'}
        </button>
        {pitch.error && <p className="error">{pitch.error}</p>}
        <p className="hint">
          순정률에서는 장3도가 평균율보다 약 14센트 낮고, 완전5도는 2센트 높아요. 드론과 울림이 맞는(맥놀이가 사라지는) 지점을 귀로 찾고, 숫자로 확인하세요.
        </p>
      </div>
    </section>
  );
}
