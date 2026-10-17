import { useMemo, useState } from 'react';
import { useSessions } from '../state/useSessions';
import { usePieces } from '../state/usePieces';
import { db } from '../data/db';
import { addDays, formatDuration, localDate, streak } from '../data/dates';
import { Pieces } from './Pieces';
import { Recordings, RecPlayerById } from './Recordings';
import { useBackLayer } from '../state/back';
import { useScoreRuns, runText } from '../state/useScoreRuns';
import { clock } from '../data/dates';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function level(sec: number): number {
  if (sec <= 0) return 0;
  if (sec < 10 * 60) return 1;
  if (sec < 20 * 60) return 2;
  if (sec < 40 * 60) return 3;
  return 4;
}

type View = 'calendar' | 'pieces' | 'recordings';

export function Log() {
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('violin-log-view') as View) || 'calendar'; } catch { return 'calendar'; } });
  const go = (v: View) => { setView(v); try { localStorage.setItem('violin-log-view', v); } catch { /* 무시 */ } };
  useBackLayer(view !== 'calendar', () => go('calendar'));
  return (
    <section className="page log">
      <div className="segmented" role="tablist">
        <button className={view === 'calendar' ? 'on' : ''} onClick={() => go('calendar')}>연습 기록</button>
        <button className={view === 'pieces' ? 'on' : ''} onClick={() => go('pieces')}>곡</button>
        <button className={view === 'recordings' ? 'on' : ''} onClick={() => go('recordings')}>녹음</button>
      </div>
      {view === 'calendar' && <Calendar />}
      {view === 'pieces' && <Pieces />}
      {view === 'recordings' && <Recordings />}
    </section>
  );
}

function Calendar() {
  const sessions = useSessions();
  const runs = useScoreRuns();
  const [openRun, setOpenRun] = useState<number | null>(null);
  const pieces = usePieces();
  const pieceName = (id: string) => pieces.find((p) => p.id === id)?.title;
  const today = localDate();
  const [month, setMonth] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState(today);

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => m.set(s.date, (m.get(s.date) ?? 0) + s.totalSec));
    // 세션 밖에서 한 악보 연습도 연습 시간에 넣기
    runs.forEach((r) => { if (!r.inSession) m.set(r.date, (m.get(r.date) ?? 0) + r.durationSec); });
    return m;
  }, [sessions, runs]);

  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];

  // 이번 주(월요일 시작) 합계
  const dow = (new Date().getDay() + 6) % 7;
  const weekStart = addDays(today, -dow);
  let weekSec = 0;
  for (let i = 0; i <= dow; i++) weekSec += byDate.get(addDays(weekStart, i)) ?? 0;
  const monthSec = [...byDate.entries()].filter(([d]) => d.startsWith(month)).reduce((a, [, s]) => a + s, 0);
  const monthDays = [...byDate.keys()].filter((d) => d.startsWith(month)).length;
  const st = streak(new Set(byDate.keys()), today);

  const shift = (n: number) => {
    const d = new Date(y, mo - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const daySessions = sessions.filter((s) => s.date === selected);
  const dayRuns = runs.filter((r) => r.date === selected);

  return (
    <div className="page-sub">
      <div className="stats">
        <div><b>{st}일</b><span>연속</span></div>
        <div><b>{formatDuration(weekSec)}</b><span>이번 주</span></div>
        <div><b>{monthDays}일</b><span>이번 달 연습일</span></div>
      </div>

      <div className="card">
        <div className="cal-head">
          <button className="mini" onClick={() => shift(-1)} aria-label="이전 달">◀</button>
          <b>{y}년 {mo}월</b>
          <button className="mini" onClick={() => shift(1)} aria-label="다음 달">▶</button>
        </div>
        <div className="cal">
          {WEEKDAYS.map((w) => <span key={w} className="cal-wd">{w}</span>)}
          {cells.map((d, i) => d === null ? <span key={`e${i}`} /> : (
            <button key={d} className={`cal-day lv${level(byDate.get(d) ?? 0)} ${d === selected ? 'sel' : ''} ${d === today ? 'today' : ''}`} onClick={() => setSelected(d)}>
              {Number(d.slice(8))}
            </button>
          ))}
        </div>
        <div className="muted small">이번 달 합계 {formatDuration(monthSec)} · 색이 진할수록 오래 연습한 날</div>
      </div>

      <div className="card">
        <b>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일</b>
        {daySessions.length === 0 && dayRuns.length === 0 && <p className="muted">기록이 없어요.</p>}
        {daySessions.map((s) => (
          <div key={s.id} className="session-row">
            <div className="session-row-head">
              <span>{new Date(s.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · <b>{formatDuration(s.totalSec)}</b></span>
              <button className="mini danger" onClick={() => { if (confirm('이 기록을 지울까요?')) db.sessions.delete(s.id!); }} aria-label="기록 삭제">✕</button>
            </div>
            <ul>{s.items.map((it) => <li key={it.key}>{it.label}{it.pieceId && pieceName(it.pieceId) ? ` · ${pieceName(it.pieceId)}` : ''} <span className="muted">{formatDuration(it.sec)}</span></li>)}</ul>
            {s.memo && <p className="memo">{s.memo}</p>}
          </div>
        ))}
        {dayRuns.length > 0 && (
          <div className="session-row" data-testid="day-runs">
            <div className="session-row-head"><span><b>악보 연습 {dayRuns.length}번</b> <span className="muted">{formatDuration(dayRuns.reduce((a, r) => a + r.durationSec, 0))}</span></span></div>
            <ul className="rec-list">
              {[...dayRuns].reverse().map((r) => (
                <li key={r.id}>
                  <div className="rec-head">
                    <button className="link rec-title" onClick={() => setOpenRun(openRun === r.id ? null : r.id!)}>
                      <b>{r.title}</b>
                      <span className="muted small">{new Date(r.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · {clock(r.durationSec)} · {runText(r)}{r.recordingId ? ' · 녹음' : ''}</span>
                    </button>
                    <button className="mini danger" onClick={() => { if (confirm('이 악보 연습 기록을 지울까요? (녹음은 녹음 목록에 남아요)')) db.scoreRuns.delete(r.id!); }} aria-label="악보 연습 기록 삭제">✕</button>
                  </div>
                  {openRun === r.id && (
                    <div className="rec-body">
                      {r.weakMeasures?.length ? <p className="small">가장 벗어난 마디: {r.weakMeasures.join(', ')}</p> : null}
                      {r.recordingId ? <RecPlayerById id={r.recordingId} /> : <p className="muted small">녹음 없이 채점만 했어요.</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
