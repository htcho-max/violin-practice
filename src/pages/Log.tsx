import { useMemo, useState } from 'react';
import { useSessions } from '../state/useSessions';
import { db } from '../data/db';
import { addDays, formatDuration, localDate, streak } from '../data/dates';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function level(sec: number): number {
  if (sec <= 0) return 0;
  if (sec < 10 * 60) return 1;
  if (sec < 20 * 60) return 2;
  if (sec < 40 * 60) return 3;
  return 4;
}

export function Log() {
  const sessions = useSessions();
  const today = localDate();
  const [month, setMonth] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState(today);

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => m.set(s.date, (m.get(s.date) ?? 0) + s.totalSec));
    return m;
  }, [sessions]);

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

  return (
    <section className="page log">
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
        {daySessions.length === 0 && <p className="muted">기록이 없어요.</p>}
        {daySessions.map((s) => (
          <div key={s.id} className="session-row">
            <div className="session-row-head">
              <span>{new Date(s.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · <b>{formatDuration(s.totalSec)}</b></span>
              <button className="mini danger" onClick={() => { if (confirm('이 기록을 지울까요?')) db.sessions.delete(s.id!); }} aria-label="기록 삭제">✕</button>
            </div>
            <ul>{s.items.map((it) => <li key={it.key}>{it.label} <span className="muted">{formatDuration(it.sec)}</span></li>)}</ul>
            {s.memo && <p className="memo">{s.memo}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
