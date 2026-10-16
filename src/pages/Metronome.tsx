import { useEffect, useRef, useState } from 'react';
import { metronome } from '../audio/metronome';
import { METERS, SUBDIVISIONS, TapTempo, clampBpm, MIN_BPM, MAX_BPM } from '../audio/schedule';
import { useSettings } from '../state/settings';
import { useAudioStatus, setAudioStatus } from '../state/audioStatus';
import { useWakeLock } from '../state/wakeLock';

function tempoName(bpm: number): string {
  if (bpm < 60) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 168) return 'Allegro';
  return 'Presto';
}

export function Metronome() {
  const { settings, update } = useSettings();
  const { metronome: running } = useAudioStatus();
  const [beat, setBeat] = useState<{ beat: number; kind: string; n: number } | null>(null);
  const tap = useRef(new TapTempo());
  const meter = METERS.find((m) => m.id === settings.meterId) ?? METERS[3];
  useWakeLock(running, settings.wakeLock);

  // 설정 → 엔진
  useEffect(() => {
    metronome.setBpm(settings.bpm);
    metronome.setMeter(meter);
    metronome.setSubdivision(settings.subdivision);
    metronome.setAccent(settings.accent);
    metronome.sound = settings.clickSound;
    metronome.volume = settings.clickVolume;
  }, [settings.bpm, meter, settings.subdivision, settings.accent, settings.clickSound, settings.clickVolume]);

  useEffect(() => metronome.onTick((t) => { if (t.sub === 0) setBeat((b) => ({ beat: t.beat, kind: t.kind, n: (b?.n ?? 0) + 1 })); }), []);

  async function toggle() {
    if (running) { metronome.stop(); setAudioStatus({ metronome: false }); setBeat(null); }
    else { await metronome.start(); setAudioStatus({ metronome: true }); }
  }

  // 스페이스바로 시작/정지 (PC)
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); toggleRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setBpm = (b: number) => update({ bpm: clampBpm(b) });

  return (
    <section className="page metronome">
      <div className="bpm-block">
        <div className="bpm" data-testid="bpm">{settings.bpm}</div>
        <div className="bpm-name">BPM · {tempoName(settings.bpm)}</div>
      </div>

      <div className="beats" aria-hidden>
        {Array.from({ length: meter.beats }, (_, i) => (
          <span key={i} className={`dot ${beat && beat.beat === i ? `on ${beat.kind}` : ''} ${i === 0 && settings.accent && meter.beats > 1 ? 'first' : ''}`} />
        ))}
      </div>

      <div className="bpm-controls">
        <button onClick={() => setBpm(settings.bpm - 5)}>−5</button>
        <button onClick={() => setBpm(settings.bpm - 1)}>−1</button>
        <button onClick={() => setBpm(settings.bpm + 1)}>+1</button>
        <button onClick={() => setBpm(settings.bpm + 5)}>+5</button>
      </div>
      <input type="range" min={MIN_BPM} max={MAX_BPM} value={settings.bpm} onChange={(e) => setBpm(Number(e.target.value))} className="slider" aria-label="BPM" />

      <button className={`primary wide big ${running ? 'stop' : ''}`} onClick={toggle} data-testid="metro-toggle">
        {running ? '■ 정지' : '▶ 시작'}
      </button>
      <button className="secondary wide" onClick={() => { const b = tap.current.tap(performance.now()); if (b) setBpm(b); }}>
        탭 템포 (박에 맞춰 여러 번 누르기)
      </button>

      <h3>박자</h3>
      <div className="chips">
        {METERS.map((m) => (
          <button key={m.id} className={m.id === meter.id ? 'chip on' : 'chip'} onClick={() => update({ meterId: m.id })}>{m.label}</button>
        ))}
      </div>
      <h3>한 박 나누기</h3>
      <div className="chips">
        {SUBDIVISIONS.map((s) => (
          <button key={s.id} className={s.count === settings.subdivision ? 'chip on' : 'chip'} onClick={() => update({ subdivision: s.count })}>{s.label}</button>
        ))}
      </div>
      <div className="row-setting">
        <label><input type="checkbox" checked={settings.accent} onChange={(e) => update({ accent: e.target.checked })} /> 첫 박 강조</label>
        <select value={settings.clickSound} onChange={(e) => update({ clickSound: e.target.value as 'beep' | 'wood' })} aria-label="클릭 소리">
          <option value="wood">우드블록</option>
          <option value="beep">전자음</option>
        </select>
      </div>
      <div className="row-setting">
        <span>음량</span>
        <input type="range" min={0.1} max={1} step={0.05} value={settings.clickVolume} onChange={(e) => update({ clickVolume: Number(e.target.value) })} aria-label="메트로놈 음량" />
      </div>
    </section>
  );
}
