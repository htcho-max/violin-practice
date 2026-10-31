import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, loadScoreList, type LessonNote, type ScoreMeta } from '../data/db';
import { localDate } from '../data/dates';
import { DraftInput } from './DraftInput';
import { parseSpoken, useSpeech, type ParsedNote, type ScoreRef } from '../lesson/voice';

/** 🎤 말로 입력: 한 번 말하면 글자로 (곡·마디는 찾아서 넘김) */
function MicButton({ scores, onText }: { scores?: ScoreRef[]; onText: (p: ParsedNote) => void }) {
  const sp = useSpeech((t) => onText(parseSpoken(t, scores)));
  if (!sp.supported) return null;
  return (
    <div className="lesson-mic">
      <button className={`mini mic ${sp.listening ? 'on' : ''}`} onClick={() => (sp.listening ? sp.stop() : sp.start())} aria-label={sp.listening ? '말하기 멈추기' : '말로 입력'} data-testid="lesson-mic">
        {sp.listening ? '■ 듣는 중' : '🎤 말로 입력'}
      </button>
      {sp.listening && <span className="muted small" data-testid="lesson-interim">{sp.interim || '말해 보세요 (예: 23마디 활 더 길게)'}</span>}
      {sp.error && <span className="error small">{sp.error}</span>}
    </div>
  );
}
const joinText = (a: string, b: string) => (a.trim() ? `${a.trim()} ${b}` : b);

/** 레슨 노트 읽기 (scoreId 를 주면 그 악보만, 최근 레슨 날짜 순) */
export function useLessonNotes(scoreId?: number): LessonNote[] {
  const [rows, setRows] = useState<LessonNote[]>([]);
  useEffect(() => {
    const q = () => (scoreId === undefined ? db.lessonNotes.toArray() : db.lessonNotes.where('scoreId').equals(scoreId).toArray())
      .then((a) => a.sort((x, y) => (y.date.localeCompare(x.date)) || y.createdAt - x.createdAt));
    const sub = liveQuery(q).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, [scoreId]);
  return rows;
}

const toggle = (n: LessonNote) => db.lessonNotes.update(n.id!, n.done ? { done: false, doneAt: undefined } : { done: true, doneAt: Date.now() });
const shortDate = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}`; };

function NoteRow({ n, onMeasure, showTitle, editable }: { n: LessonNote; onMeasure?: (m: number) => void; showTitle?: boolean; editable?: boolean }) {
  const [edit, setEdit] = useState(false);
  return (
    <li className={`lesson-note ${n.done ? 'done' : ''}`} data-testid="lesson-note">
      <label className="lesson-check">
        <input type="checkbox" checked={n.done} onChange={() => toggle(n)} aria-label="했어요" data-testid="lesson-check" />
        {edit ? (
          <DraftInput value={n.text} onCommit={(v) => { if (v.trim()) db.lessonNotes.update(n.id!, { text: v.trim() }); }} label="노트 고치기" className="lesson-input" multiline />
        ) : (
          <span className="lesson-text">{n.text}</span>
        )}
      </label>
      <span className="lesson-meta muted small">
        {showTitle && n.scoreTitle ? `${n.scoreTitle} · ` : ''}
        {n.measure !== undefined && (onMeasure
          ? <button className="link small" onClick={() => onMeasure(n.measure!)}>{n.measure}마디</button>
          : <>{n.measure}마디</>)}
        {n.measure !== undefined ? ' · ' : ''}{shortDate(n.date)} 레슨
        {editable && <>
          <button className="mini" onClick={() => setEdit(!edit)} aria-label="고치기">{edit ? '완료' : '✎'}</button>
          <button className="mini danger" onClick={() => { if (confirm('이 노트를 지울까요?')) db.lessonNotes.delete(n.id!); }} aria-label="노트 지우기">✕</button>
        </>}
      </span>
    </li>
  );
}

/** 악보 화면의 레슨 노트: 새 노트 쓰기 + 체크리스트 */
export function LessonNotesCard({ scoreId, scoreTitle, pieceId, measure, onMeasure }: {
  scoreId: number; scoreTitle: string; pieceId?: string; measure?: number; onMeasure?: (m: number) => void;
}) {
  const notes = useLessonNotes(scoreId);
  const [text, setText] = useState('');
  const [m, setM] = useState('');
  const [date, setDate] = useState(localDate());
  const [showDone, setShowDone] = useState(false);
  const undone = notes.filter((n) => !n.done), done = notes.filter((n) => n.done);
  async function add() {
    const t = text.trim();
    if (!t) return;
    const mm = m.trim() === '' ? undefined : Number(m);
    await db.lessonNotes.add({ createdAt: Date.now(), date, scoreId, scoreTitle, pieceId, measure: Number.isFinite(mm) ? mm : undefined, text: t, done: false });
    setText(''); setM('');
  }
  return (
    <div className="card" data-testid="lesson-card">
      <div className="card-head"><b>레슨 노트</b><span className="muted small">할 것 {undone.length}개</span></div>
      <div className="lesson-add">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="선생님이 짚어 준 것 (예: 윗반활에서 지판 쪽으로 가지 않기)" aria-label="레슨 노트" data-testid="lesson-text" />
        <MicButton onText={(p) => { setText((t) => joinText(t, p.text)); if (p.measure !== undefined) setM(String(p.measure)); }} />
        <div className="row-setting">
          <label className="small">마디 <input className="num" inputMode="numeric" value={m} onChange={(e) => setM(e.target.value.replace(/[^\d]/g, ''))} placeholder={measure !== undefined ? String(measure) : '없음'} style={{ width: 56 }} aria-label="마디" data-testid="lesson-measure" /></label>
          <label className="small">레슨 날 <input type="date" value={date} onChange={(e) => setDate(e.target.value || localDate())} aria-label="레슨 날짜" /></label>
          <button className="primary" onClick={add} disabled={!text.trim()} data-testid="lesson-add">추가</button>
        </div>
      </div>
      {undone.length > 0 && <ul className="lesson-list">{undone.map((n) => <NoteRow key={n.id} n={n} onMeasure={onMeasure} editable />)}</ul>}
      {done.length > 0 && (
        <>
          <button className="link small" onClick={() => setShowDone(!showDone)}>{showDone ? '한 것 접기' : `한 것 ${done.length}개 보기`}</button>
          {showDone && <ul className="lesson-list">{done.map((n) => <NoteRow key={n.id} n={n} onMeasure={onMeasure} editable />)}</ul>}
        </>
      )}
      <p className="hint">한 주 동안 지킨 것은 체크해요. 마디를 적어 두면 악보에 📝 로 보여요.</p>
    </div>
  );
}

/** 악보를 열었을 때 맨 위에 보이는 짧은 체크리스트 (할 것만) */
export function LessonChecklist({ scoreId, onMeasure }: { scoreId: number; onMeasure?: (m: number) => void }) {
  const notes = useLessonNotes(scoreId).filter((n) => !n.done);
  const [open, setOpen] = useState(true);
  if (!notes.length) return null;
  return (
    <div className="card lesson-top" data-testid="lesson-top">
      <div className="card-head"><b>📝 레슨에서 짚은 것 {notes.length}</b><button className="mini" onClick={() => setOpen(!open)}>{open ? '접기' : '보기'}</button></div>
      {open && <ul className="lesson-list">{notes.slice(0, 5).map((n) => <NoteRow key={n.id} n={n} onMeasure={onMeasure} />)}</ul>}
    </div>
  );
}

/** 기록 화면: 모든 레슨 노트를 레슨 날짜별로 */
/** 기록 화면에서 새 노트 (곡을 고르거나 말로 곡 이름을 말하면 찾아 줌) */
function LogAdd() {
  const [scores, setScores] = useState<ScoreMeta[]>([]);
  useEffect(() => { loadScoreList().then((l) => setScores(l.filter((x) => !x.exercise).sort((a, b) => Number(!!a.sevcik) - Number(!!b.sevcik) || a.title.localeCompare(b.title)))).catch(() => {}); }, []);
  const [text, setText] = useState('');
  const [sid, setSid] = useState('');
  const [m, setM] = useState('');
  const [date, setDate] = useState(localDate());
  const [msg, setMsg] = useState<string | null>(null);
  const refs = useMemo(() => scores.map((x) => ({ id: x.id, title: x.title })), [scores]);
  async function add() {
    const t = text.trim();
    if (!t) return;
    const sc = scores.find((x) => String(x.id) === sid);
    const mm = m.trim() === '' ? undefined : Number(m);
    await db.lessonNotes.add({ createdAt: Date.now(), date, scoreId: sc?.id, scoreTitle: sc?.title, pieceId: sc?.pieceId, measure: sc && Number.isFinite(mm) ? mm : undefined, text: t, done: false });
    setText(''); setM(''); setMsg(`추가했어요${sc ? ` (${sc.title}${mm !== undefined ? ` ${mm}마디` : ''})` : ''}.`);
  }
  return (
    <div className="lesson-add" data-testid="lesson-log-add">
      <textarea value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} rows={2} placeholder="레슨에서 짚은 것 — 🎤 로 말해도 돼요 (예: 자이츠 1악장 23마디 활 더 길게)" aria-label="레슨 노트" data-testid="log-lesson-text" />
      <MicButton scores={refs} onText={(p) => { setMsg(null); setText((t) => joinText(t, p.text)); if (p.scoreId !== undefined) setSid(String(p.scoreId)); if (p.measure !== undefined) setM(String(p.measure)); }} />
      <div className="row-setting">
        <label className="small">곡 <select value={sid} onChange={(e) => setSid(e.target.value)} aria-label="곡" data-testid="log-lesson-score">
          <option value="">곡 없이 (전체)</option>
          {scores.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select></label>
        <label className="small">마디 <input className="num" inputMode="numeric" value={m} onChange={(e) => setM(e.target.value.replace(/[^\d]/g, ''))} disabled={!sid} placeholder="없음" style={{ width: 56 }} aria-label="마디" data-testid="log-lesson-measure" /></label>
        <label className="small">레슨 날 <input type="date" value={date} onChange={(e) => setDate(e.target.value || localDate())} aria-label="레슨 날짜" /></label>
        <button className="primary" onClick={add} disabled={!text.trim()} data-testid="log-lesson-add">추가</button>
      </div>
      {msg && <p className="ok-text small" data-testid="log-lesson-msg">{msg}</p>}
    </div>
  );
}

export function LessonNotesLog() {
  const notes = useLessonNotes();
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => {
    const g = new Map<string, LessonNote[]>();
    for (const n of notes) { if (!showDone && n.done) continue; const a = g.get(n.date) ?? []; a.push(n); g.set(n.date, a); }
    return [...g.entries()];
  }, [notes, showDone]);
  if (!notes.length) return (
    <div className="card" data-testid="lesson-log"><b>레슨 노트</b><LogAdd /><p className="muted small">여기나 악보 화면 아래 "레슨 노트"에 선생님이 짚어 준 것을 적어 두면 날짜별로 모여요.</p></div>
  );
  return (
    <div className="card" data-testid="lesson-log">
      <div className="card-head"><b>레슨 노트</b><label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 한 것도 보기</label></div>
      <LogAdd />
      {groups.length === 0 && <p className="muted small">남은 것이 없어요. 모두 했어요!</p>}
      {groups.map(([d, list]) => (
        <div key={d}>
          <div className="muted small lesson-date">{d} 레슨</div>
          <ul className="lesson-list">{list.map((n) => <NoteRow key={n.id} n={n} showTitle editable />)}</ul>
        </div>
      ))}
    </div>
  );
}
