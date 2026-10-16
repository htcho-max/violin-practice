import { useEffect, useRef, useState } from 'react';
import { pitchTracker, RAW_BUFFER } from '../audio/pitchTracker';
import { NoteSegmenter, type NoteEvent, type Reference } from '../audio/segment';
import { analyzeVibrato, type VibratoResult, type CentsPoint } from '../audio/vibrato';

export interface TracePoint { t: number; cents: number | null; midi: number | null }

const TRACE_SEC = 12;

/** 마이크 음높이를 음 단위·그래프·비브라토로 분석 */
export function useAnalysis(ref: Reference) {
  const refRef = useRef(ref);
  refRef.current = ref;
  const segmenter = useRef(new NoteSegmenter(ref));
  const trace = useRef<TracePoint[]>([]);
  const raw = useRef<{ midi: number | null; pts: CentsPoint[] }>({ midi: null, pts: [] });
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [vibrato, setVibrato] = useState<{ v: VibratoResult; midi: number } | null>(null);
  const lastVib = useRef(0);

  useEffect(() => { segmenter.current.setReference(ref); }, [ref]);

  useEffect(() => pitchTracker.subscribe((r) => {
    const t = r.time;
    const R = refRef.current;
    // 그래프
    const disp = r.freq ? R(r.freq) : null;
    trace.current.push({ t, cents: disp?.cents ?? null, midi: disp?.midi ?? null });
    while (trace.current.length && trace.current[0].t < t - TRACE_SEC) trace.current.shift();
    // 음 단위
    const done = segmenter.current.push(t, r.freq);
    if (done) setNotes((ns) => [...ns.slice(-199), done]);
    // 비브라토 (짧은 창 raw 값)
    const rr = r.raw ? R(r.raw) : null;
    if (!rr || (raw.current.midi !== null && rr.midi !== raw.current.midi)) raw.current = { midi: rr?.midi ?? null, pts: [] };
    if (rr) {
      raw.current.midi = rr.midi;
      raw.current.pts.push({ t, cents: rr.cents });
      raw.current.pts = raw.current.pts.filter((p) => p.t > t - 1.2);
      if (t - lastVib.current > 0.25) {
        lastVib.current = t;
        const win = RAW_BUFFER / pitchTracker.sampleRate;
        const v = analyzeVibrato(raw.current.pts, win);
        if (v) setVibrato({ v, midi: rr.midi });
      }
    }
  }), []);

  const reset = () => { setNotes([]); setVibrato(null); trace.current = []; };
  return { notes, vibrato, trace, raw, reset };
}
