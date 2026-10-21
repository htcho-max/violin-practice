import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type ExerciseProgress, type ScoreFile } from '../data/db';
import { STAGES, STEPS, PATTERNS, POSITION_SETS, STRING_NAMES, MINOR_FORMS, scaleProgressId, sheetOctaves, makeExercise, type ExerciseSpec, type PatternId, type PositionSet, type Step } from '../exercise/curriculum';
import { BOWINGS, RHYTHMS, type Bowing, type FingerShow } from '../exercise/build';
import { KEYS, MAJOR_KEYS, MINOR_KEYS, keyById, type MinorForm } from '../exercise/theory';
import { BOW_BASES, BOW_KEYS, BOW_VARIANTS, bowProgressId, variantById, type BowBaseId } from '../exercise/bow';

export interface ExerciseOptions { perBeat: number; bowing: Bowing; fingers: FingerShow }
const DEFAULT_OPTS: ExerciseOptions = { perBeat: 2, bowing: 'detache', fingers: 'all' };
export function loadOpts(): ExerciseOptions {
  try { return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('violin-exercise-opts') || '{}') }; } catch { return DEFAULT_OPTS; }
}
function saveOpts(o: ExerciseOptions) { try { localStorage.setItem('violin-exercise-opts', JSON.stringify(o)); } catch { /* 무시 */ } }

export function useProgress(): Record<string, ExerciseProgress> {
  const [p, setP] = useState<Record<string, ExerciseProgress>>({});
  useEffect(() => {
    const sub = liveQuery(() => db.kv.get('exercise-progress')).subscribe({ next: (r) => setP((r?.value as Record<string, ExerciseProgress>) ?? {}), error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return p;
}
export async function recordProgress(stepId: string, pct: number, mean: number | null, bpm: number) {
  const row = await db.kv.get('exercise-progress');
  const all = { ...((row?.value as Record<string, ExerciseProgress>) ?? {}) };
  const prev = all[stepId];
  const passed = pct >= 90 && mean !== null && mean <= 15;
  all[stepId] = {
    best: Math.max(prev?.best ?? 0, pct),
    mean: mean === null ? prev?.mean ?? null : prev?.mean == null ? mean : Math.min(prev.mean, mean),
    passed: (prev?.passed ?? false) || passed,
    bpm: passed ? Math.max(prev?.bpm ?? 0, bpm) : prev?.bpm,
    at: Date.now(),
    tries: (prev?.tries ?? 0) + 1,
  };
  await db.kv.put({ key: 'exercise-progress', value: all });
  return passed;
}

/** 연습곡을 만들어 저장하고 id 를 돌려줌 (같은 단계는 한 장을 덮어씀) */
export async function createExercise(stepId: string, spec: ExerciseSpec, o: ExerciseOptions, seed: number, tempo: number, tip?: string, title?: string, progressId?: string): Promise<number> {
  const m = makeExercise(spec, { ...o, seed, tempo, title });
  if (m.error || !m.xml) throw new Error(m.error ?? '연습곡을 만들지 못했어요.');
  const existing = await db.scores.where('exercise.stepId').equals(stepId).first();
  const rec: Omit<ScoreFile, 'id'> = { title: m.title, xml: m.xml, createdAt: Date.now(), exercise: { stepId, spec, seed, shiftKeys: m.shiftKeys, tip, tempo, progressId } };
  if (existing?.id) { await db.scores.update(existing.id, { ...rec, lastFrom: undefined, lastTo: undefined }); return existing.id; }
  return db.scores.add(rec as ScoreFile);
}

/** 활 연습 한 장 만들기 (활 연습은 모두 한 장을 덮어씀) */
export function createBow(base: BowBaseId, key: string, variant: string, o: ExerciseOptions, tempo = 50): Promise<number> {
  const v = variantById(variant);
  const b = BOW_BASES.find((x) => x.id === base)!;
  return createExercise('bow', { key, pattern: 'bow', positions: '1-3', base, variant: v.id }, o, 1, tempo, `${v.tip} ${b.tip}`, undefined, bowProgressId(base, key, v.id));
}

/** 장·단음계 악보 (한 장을 덮어씀). 조·형태·옥타브마다 진도는 따로 */
export interface SheetPrefs { mode: 'major' | 'minor'; form: MinorForm; octaves: number }
const SHEET_DEFAULT: SheetPrefs = { mode: 'major', form: 'harmonic', octaves: 2 };
export function sheetPrefs(): SheetPrefs {
  try { return { ...SHEET_DEFAULT, ...JSON.parse(localStorage.getItem('violin-scale-sheet') || '{}') }; } catch { return SHEET_DEFAULT; }
}
export const saveSheetPrefs = (p: SheetPrefs) => { try { localStorage.setItem('violin-scale-sheet', JSON.stringify(p)); } catch { /* 무시 */ } };
export const SHEET_TIP = '교재처럼 음계를 오르내린 뒤 으뜸화음(1·3·5음)을 오르내려요. 악보 위 "♯♭ 표시"를 켜면 바뀌는 음에 형광펜이 칠해져요.';
/** 진도 id (3옥타브가 안 되는 조는 낮춘 옥타브로) */
export const sheetProgressId = (key: string, form: MinorForm, octaves: number) =>
  scaleProgressId(key, keyById(key).mode === 'minor' ? form : undefined, sheetOctaves(key, octaves));
export function createSheet(key: string, form: MinorForm, octaves: number, o: ExerciseOptions, tempo = 60): Promise<number> {
  const minor = keyById(key).mode === 'minor';
  const oct = sheetOctaves(key, octaves);
  return createExercise('scales', { key, pattern: 'scaleSheet', positions: '1-3', octaves: oct, ...(minor ? { form } : {}) }, o, 1, tempo, SHEET_TIP, undefined, sheetProgressId(key, form, octaves));
}

/** 다른 탭(오늘의 연습)에서 악보 탭을 열며 연습곡을 바로 열 때 */
let pending: (() => Promise<number>) | null = null;
export const requestOpen = (fn: () => Promise<number>) => { pending = fn; };
export const takePending = () => { const p = pending; pending = null; return p; };

export function bowPrefs(): { base: BowBaseId; key: string } {
  try { return { base: (localStorage.getItem('violin-bow-base') as BowBaseId) || 'open', key: localStorage.getItem('violin-bow-key') || 'G' }; } catch { return { base: 'open', key: 'G' }; }
}
/** 다음에 할 단계 (아직 통과 못 한 첫 단계) 와 활 변형 */
export function nextSuggestions(progress: Record<string, ExerciseProgress>) {
  const step = STEPS.find((s) => !progress[s.id]?.passed) ?? STEPS[STEPS.length - 1];
  const { base, key } = bowPrefs();
  const variant = BOW_VARIANTS.find((v) => !progress[bowProgressId(base, key, v.id)]?.passed) ?? BOW_VARIANTS[0];
  return { step, bow: { base, key, variant, baseLabel: BOW_BASES.find((b) => b.id === base)!.label } };
}
export async function openStep(step: Step, o = loadOpts()): Promise<number> {
  const prev = await db.scores.where('exercise.stepId').equals(step.id).first();
  const seed = (prev?.exercise?.seed ?? 0) + (prev ? 0 : 1);
  return createExercise(step.id, step.spec, o, seed, step.tempo, step.tip);
}

export function Exercises({ onOpen, onBack }: { onOpen: (id: number) => void; onBack: () => void }) {
  const [opts, setOpts] = useState<ExerciseOptions>(loadOpts);
  const progress = useProgress();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<{ key: string; pattern: PatternId; positions: PositionSet; string: number }>({ key: 'G', pattern: 'scale', positions: '1', string: 2 });
  const [bowBase, setBowBase] = useState<BowBaseId>(() => { try { return (localStorage.getItem('violin-bow-base') as BowBaseId) || 'open'; } catch { return 'open'; } });
  const [bowKey, setBowKey] = useState(() => { try { return localStorage.getItem('violin-bow-key') || 'G'; } catch { return 'G'; } });
  useEffect(() => { try { localStorage.setItem('violin-bow-base', bowBase); localStorage.setItem('violin-bow-key', bowKey); } catch { /* 무시 */ } }, [bowBase, bowKey]);
  async function openBow(variant: string) {
    setError(null); setBusy(true);
    try { onOpen(await createBow(bowBase, bowKey, variant, opts)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const bowHasKey = BOW_BASES.find((b) => b.id === bowBase)!.keys;
  const bowDone = BOW_VARIANTS.filter((v) => progress[bowProgressId(bowBase, bowKey, v.id)]?.passed).length;
  const set = (p: Partial<ExerciseOptions>) => { const n = { ...opts, ...p }; setOpts(n); saveOpts(n); };
  const [sheet, setSheet] = useState<SheetPrefs>(sheetPrefs);
  const setSh = (p: Partial<SheetPrefs>) => { const n = { ...sheet, ...p }; setSheet(n); saveSheetPrefs(n); };
  async function openSheet(key: string) {
    setError(null); setBusy(true);
    try { onOpen(await createSheet(key, sheet.form, sheet.octaves, opts)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const sheetKeys = sheet.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
  const lowered = sheet.octaves === 3 ? sheetKeys.filter((k) => sheetOctaves(k.id, 3) < 3) : [];

  async function open(step: Step, newSeed = false) {
    setError(null); setBusy(true);
    try {
      if (!newSeed) { onOpen(await openStep(step, opts)); return; }
      const prev = await db.scores.where('exercise.stepId').equals(step.id).first();
      onOpen(await createExercise(step.id, step.spec, opts, (prev?.exercise?.seed ?? 0) + 1, step.tempo, step.tip));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function openCustom() {
    setError(null); setBusy(true);
    try {
      const spec: ExerciseSpec = { key: custom.key, pattern: custom.pattern, positions: custom.pattern === 'shiftDrill' || custom.pattern === 'stringScale' ? '1-3' : custom.positions, octaves: 2,
        string: custom.pattern === 'shiftDrill' || custom.pattern === 'stringScale' ? custom.string : undefined, ...(custom.pattern === 'shiftDrill' ? { perBeat: 1 } : {}) };
      onOpen(await createExercise('custom', spec, opts, Math.floor(Math.random() * 1000) + 1, 60));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const stringPattern = custom.pattern === 'shiftDrill' || custom.pattern === 'stringScale';
  const done = STEPS.filter((s) => progress[s.id]?.passed).length;

  return (
    <section className="page score exercises">
      <div className="card-head">
        <button className="mini" onClick={onBack}>◀ 목록</button>
        <b className="score-title">음계 · 포지션 · 에튀드</b>
      </div>

      <div className="card">
        <p className="hint">앱이 직접 만드는 연습곡이에요. 운지(손가락 번호와 포지션)를 자동으로 붙이고, 악보 화면에서 듣기·채점을 그대로 쓸 수 있어요. 처음부터 끝까지 맞은 음 90% 이상, 평균 ±15센트 안이면 통과로 기록해요. <b>{done}/{STEPS.length} 통과</b></p>
        <b className="small">리듬</b>
        <div className="segmented small">
          {RHYTHMS.map((r) => <button key={r.perBeat} className={opts.perBeat === r.perBeat ? 'on' : ''} onClick={() => set({ perBeat: r.perBeat })}>{r.label}</button>)}
        </div>
        <b className="small">활</b>
        <select value={opts.bowing} onChange={(e) => set({ bowing: e.target.value as Bowing })} aria-label="활 쓰기">
          {BOWINGS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <b className="small">운지 번호</b>
        <div className="segmented small">
          {([['all', '모든 음'], ['shifts', '포지션 바뀔 때만'], ['none', '안 보기']] as const).map(([id, l]) => (
            <button key={id} className={opts.fingers === id ? 'on' : ''} onClick={() => set({ fingers: id })}>{l}</button>
          ))}
        </div>
        <p className="hint">에튀드는 8분음표 이상으로 만들어요. 포지션 이동 연습은 4분음표로 고정이에요.</p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card" data-testid="sheet-card">
        <b>장·단음계 악보 (24조)</b>
        <p className="hint">조를 누르면 음계 악보가 열려요. 가장 낮은 G현에서 낼 수 있는 으뜸음부터 시작해요. 악보 화면에서 이전·다음 조로 바로 넘어갈 수 있어요. 리듬·활은 위 설정을 따라요.</p>
        <div className="segmented small">
          <button className={sheet.mode === 'major' ? 'on' : ''} onClick={() => setSh({ mode: 'major' })} data-testid="sheet-major">장조</button>
          <button className={sheet.mode === 'minor' ? 'on' : ''} onClick={() => setSh({ mode: 'minor' })} data-testid="sheet-minor">단조</button>
        </div>
        {sheet.mode === 'minor' && (
          <div className="segmented small">
            {MINOR_FORMS.map((f) => <button key={f.id} className={sheet.form === f.id ? 'on' : ''} onClick={() => setSh({ form: f.id })} data-testid={`sheet-form-${f.id}`}>{f.label}단음계</button>)}
          </div>
        )}
        <div className="row-setting">
          <span>높이</span>
          {[1, 2, 3].map((n) => <button key={n} className={`chip ${sheet.octaves === n ? 'on' : ''}`} onClick={() => setSh({ octaves: n })} data-testid={`sheet-oct-${n}`}>{n}옥타브</button>)}
        </div>
        <div className="chips sheet-keys">
          {sheetKeys.map((k) => {
            const pr = progress[sheetProgressId(k.id, sheet.form, sheet.octaves)];
            return <button key={k.id} className={`chip ${pr?.passed ? 'passed' : ''}`} onClick={() => openSheet(k.id)} disabled={busy} data-testid={`sheet-${k.id}`}>{pr?.passed ? '✓ ' : ''}{k.name}</button>;
          })}
        </div>
        {lowered.length > 0 && <p className="hint">{lowered.map((k) => k.name).join('·')}는 3옥타브가 E7을 넘어서 2옥타브로 만들어요.</p>}
        {sheet.mode === 'minor' && <p className="hint">자연단음계는 조표 그대로, 화성단음계는 7음을, 가락단음계는 올라갈 때 6·7음을 올려요(내려올 때는 자연).</p>}
      </div>

      {STAGES.map((st) => (
        <div className="card" key={st.id}>
          <b>{st.title}</b>
          <p className="hint">{st.desc}</p>
          <ul className="rec-list">
            {STEPS.filter((s) => s.stage === st.id).map((s) => {
              const pr = progress[s.id];
              return (
                <li key={s.id}>
                  <div className="rec-head">
                    <button className="link rec-title" onClick={() => open(s)} disabled={busy} data-testid={`ex-${s.id}`}>
                      <b>{pr?.passed ? '✓ ' : ''}{s.title}</b>
                      <span className="muted small">{pr ? `최고 ${pr.best}%${pr.mean !== null ? ` · ±${Math.round(pr.mean)}센트` : ''}${pr.bpm ? ` · ♩=${pr.bpm} 통과` : ''}` : `♩=${s.tempo}부터`}</span>
                    </button>
                    {s.spec.pattern === 'etude' && <button className="mini" onClick={() => open(s, true)} disabled={busy} title="새 에튀드 만들기">새 곡</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="card" data-testid="bow-card">
        <b>5단계 · 활 연습 (세브치크식)</b>
        <p className="hint">짧은 악구 하나를 24가지 활 쓰기로 바꿔 가며 연습해요. 세브치크 Op.2 방식이에요. 앱은 활을 볼 수 없어서 채점은 음정만 해요. 활은 거울을 보거나 녹음해서 확인하세요. 처음엔 ♩=50 정도로 느리게. <b>이 악구 {bowDone}/{BOW_VARIANTS.length} 통과</b></p>
        <div className="row-setting">
          <select value={bowBase} onChange={(e) => setBowBase(e.target.value as BowBaseId)} aria-label="기본 악구" data-testid="bow-base">
            {BOW_BASES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {bowHasKey && (
            <select value={bowKey} onChange={(e) => setBowKey(e.target.value)} aria-label="조">
              {BOW_KEYS.map((k) => <option key={k} value={k}>{keyById(k).name}</option>)}
            </select>
          )}
        </div>
        <ul className="rec-list">
          {BOW_VARIANTS.map((v) => {
            const pr = progress[bowProgressId(bowBase, bowKey, v.id)];
            return (
              <li key={v.id}>
                <div className="rec-head">
                  <button className="link rec-title" onClick={() => openBow(v.id)} disabled={busy} data-testid={`bow-${v.id}`}>
                    <b>{pr?.passed ? '✓ ' : ''}{v.id}. {v.label}</b>
                    {pr && <span className="muted small">최고 {pr.best}%{pr.bpm ? ` · ♩=${pr.bpm} 통과` : ''}</span>}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <b>직접 만들기</b>
        <div className="row-setting">
          <select value={custom.key} onChange={(e) => setCustom({ ...custom, key: e.target.value })} aria-label="조">
            {KEYS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <select value={custom.pattern} onChange={(e) => setCustom({ ...custom, pattern: e.target.value as PatternId })} aria-label="패턴">
            {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="row-setting">
          {stringPattern ? (
            <select value={custom.string} onChange={(e) => setCustom({ ...custom, string: Number(e.target.value) })} aria-label="현">
              {STRING_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          ) : (
            <select value={custom.positions} onChange={(e) => setCustom({ ...custom, positions: e.target.value as PositionSet })} aria-label="포지션">
              {POSITION_SETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </div>
        <button className="secondary wide" onClick={openCustom} disabled={busy} data-testid="ex-custom">만들기</button>
        <p className="hint">직접 만든 연습곡은 한 장만 저장돼요 (새로 만들면 바뀌어요).</p>
      </div>
    </section>
  );
}
