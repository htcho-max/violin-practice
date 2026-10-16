import { useEffect, useState } from 'react';
import { useSession, itemMs, totalMs } from '../state/session';
import { useSettings } from '../state/settings';
import { useWakeLock } from '../state/wakeLock';
import { useSessions } from '../state/useSessions';
import { clock, formatDuration, localDate, streak } from '../data/dates';
import type { TabId } from '../components/TabBar';

const TOOL_FOR: Record<string, { tab: TabId; label: string }> = {
  tune: { tab: 'tuner', label: '튜너 열기' },
  scale: { tab: 'drone', label: '드론 열기' },
  shift: { tab: 'drone', label: '드론 열기' },
  piece: { tab: 'metronome', label: '메트로놈 열기' },
  review: { tab: 'metronome', label: '메트로놈 열기' },
};

export function Today({ go, openSettings }: { go: (t: TabId) => void; openSettings: () => void }) {
  const { settings, update } = useSettings();
  const { session, now, start, pause, resume, goto, finish, discard } = useSession();
  const sessions = useSessions();
  const [memo, setMemo] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  useWakeLock(!!session && session.runningSince !== null, settings.wakeLock);
  useEffect(() => { if (!session) { setMemo(''); setConfirmEnd(false); } }, [session]);

  const today = localDate();
  const todaySec = sessions.filter((s) => s.date === today).reduce((a, s) => a + s.totalSec, 0);
  const days = new Set(sessions.map((s) => s.date));
  const st = streak(days, today);
  const routineMin = settings.routine.reduce((a, r) => a + r.minutes, 0);

  const header = (
    <div className="today-head">
      <div>
        <div className="muted">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</div>
        <div className="stat-line"><b>{st}일</b> 연속 · 오늘 <b>{formatDuration(todaySec)}</b></div>
      </div>
      <button className="icon-btn" onClick={openSettings} aria-label="설정">⚙</button>
    </div>
  );

  if (!session) {
    return (
      <section className="page today">
        {header}
        <div className="card">
          <div className="card-head"><b>오늘의 루틴</b><span className="muted">{routineMin}분</span></div>
          <ol className="routine">
            {settings.routine.map((r, i) => (
              <li key={r.key}>
                <span>{r.label}</span>
                <span className="stepper">
                  <button className="mini" onClick={() => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: Math.max(0, x.minutes - 1) } : x)) })}>−</button>
                  <b>{r.minutes}분</b>
                  <button className="mini" onClick={() => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: x.minutes + 1 } : x)) })}>＋</button>
                </span>
              </li>
            ))}
          </ol>
          <button className="primary wide big" onClick={() => start(settings.routine.filter((r) => r.minutes > 0))} data-testid="session-start">▶ 연습 시작</button>
        </div>
      </section>
    );
  }

  const cur = session.items[session.index];
  const curSec = itemMs(session, session.index, now) / 1000;
  const targetSec = cur.minutes * 60;
  const over = curSec >= targetSec;
  const isLast = session.index === session.items.length - 1;
  const tool = TOOL_FOR[cur.key];

  return (
    <section className="page today">
      {header}
      <div className={`card session ${over ? 'over' : ''}`}>
        <div className="muted">{session.index + 1} / {session.items.length} · 전체 {clock(totalMs(session, now) / 1000)}</div>
        <div className="session-item" data-testid="session-item">{cur.label}</div>
        <div className="session-clock">{clock(curSec)} <small>/ {clock(targetSec)}</small></div>
        <div className="progress"><div style={{ width: `${Math.min(100, (curSec / Math.max(1, targetSec)) * 100)}%` }} /></div>
        {over && <div className="muted">목표 시간을 채웠어요. 다음으로 넘어가도 좋아요.</div>}
        <div className="session-controls">
          <button disabled={session.index === 0} onClick={() => goto(session.index - 1)}>◀ 이전</button>
          <button className="primary" onClick={session.runningSince === null ? resume : pause}>{session.runningSince === null ? '▶ 계속' : '❚❚ 일시정지'}</button>
          <button disabled={isLast} onClick={() => goto(session.index + 1)} data-testid="session-next">다음 ▶</button>
        </div>
        {tool && <button className="secondary wide" onClick={() => go(tool.tab)}>{tool.label}</button>}
      </div>

      <div className="card">
        <ol className="routine done-list">
          {session.items.map((it, i) => (
            <li key={it.key} className={i === session.index ? 'current' : ''} onClick={() => goto(i)}>
              <span>{it.label}</span>
              <span className="muted">{clock(itemMs(session, i, now) / 1000)} / {it.minutes}분</span>
            </li>
          ))}
        </ol>
        {!confirmEnd ? (
          <button className="primary wide" onClick={() => { pause(); setConfirmEnd(true); }} data-testid="session-finish">연습 마치기</button>
        ) : (
          <div className="finish">
            <textarea placeholder="메모 (예: 비발디 1악장 23~30마디 템포 72까지)" value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
            <div className="session-controls">
              <button onClick={() => { setConfirmEnd(false); resume(); }}>계속하기</button>
              <button className="danger" onClick={() => { if (confirm('이번 연습을 저장하지 않고 버릴까요?')) discard(); }}>버리기</button>
              <button className="primary" onClick={() => finish(memo)} data-testid="session-save">저장</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
