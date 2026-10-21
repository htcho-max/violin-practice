import { useToday } from '../state/useToday';
import { useEffect, useState } from 'react';
import { useSession, itemMs, totalMs } from '../state/session';
import { useSettings } from '../state/settings';
import { useSessions } from '../state/useSessions';
import { clock, formatDuration, localDate, streak } from '../data/dates';
import type { TabId } from '../components/TabBar';
import { usePieces, updatePiece } from '../state/usePieces';
import { currentPieces, pickReview, daysAgo } from '../data/pieces';
import type { Piece } from '../data/db';
import { useProgress, nextSuggestions, requestOpen, openStep, createBow, loadOpts } from './Exercises';
import { STEPS } from '../exercise/curriculum';
import { useScoreRuns } from '../state/useScoreRuns';
import { liveQuery } from 'dexie';
import { db } from '../data/db';
import { topWeakSpots, pitchHabits, scaleHas, ladderKey, LADDER_PCTS } from '../score/practice';
import { useDrills } from '../state/useDrills';
import { requestScore } from '../state/openRequest';
import { useReviews } from '../state/useReviews';
import { dueGroups, measureRuns, REVIEW_DAYS } from '../data/review';

/** 채점에서 틀린 마디를 간격을 늘려 가며 다시 (오늘 복습할 것). 누르면 그 악보 그 마디로 */
function ReviewCard({ go, scoreIds }: { go: (t: TabId) => void; scoreIds: Set<number> | null }) {
  const all = useReviews();
  const today = useToday();
  // 지워진 악보의 마디는 빼요
  const items = scoreIds ? all.filter((i) => scoreIds.has(i.scoreId)) : [];
  if (!items.length) return null;
  const groups = dueGroups(items, today);
  const dueN = groups.reduce((a, g) => a + g.measures.length, 0);
  const later = items.filter((i) => i.due > today).sort((a, b) => a.due.localeCompare(b.due));
  const open = (scoreId: number, a: number, b: number) => { requestScore({ scoreId, measure: a, to: b }); go('score'); };
  return (
    <div className="card" data-testid="review-card">
      <div className="card-head"><b>틀린 마디 복습</b><span className="muted small">오늘 {dueN}마디 · 기다리는 {later.length}마디</span></div>
      {groups.length === 0 ? (
        <p className="muted small">오늘 복습할 마디는 없어요.{later.length ? ` 다음 복습은 ${Number(later[0].due.slice(5, 7))}월 ${Number(later[0].due.slice(8))}일.` : ''}</p>
      ) : groups.map((g) => (
        <div key={g.scoreId} className="review-group">
          <div className="small"><b>{g.title}</b></div>
          <div className="chips">
            {measureRuns(g.measures.map((m) => m.measure)).map(([a, b]) => (
              <button key={a} className="chip" onClick={() => open(g.scoreId, a, b)} data-testid="review-open">{a === b ? `${a}마디` : `${a}~${b}마디`}</button>
            ))}
          </div>
        </div>
      ))}
      <p className="hint">채점에서 틀린 마디가 여기 모여요. 복습하는 날 깨끗하게 켜면 {REVIEW_DAYS.join('→')}일로 간격이 늘어나고, 끝까지 가면 졸업해요.</p>
    </div>
  );
}

function PieceChips({ list, selected, onPick }: { list: Piece[]; selected?: string; onPick: (id: string | null) => void }) {
  if (!list.length) return null;
  return (
    <div className="chips">
      {list.map((p) => (
        <button key={p.id} className={selected === p.id ? 'chip on' : 'chip'} onClick={() => onPick(selected === p.id ? null : p.id)}>{p.title}</button>
      ))}
    </div>
  );
}

const TOOL_FOR: Record<string, { tab: TabId; label: string }> = {
  tune: { tab: 'tuner', label: '튜너 열기' },
  scale: { tab: 'drone', label: '드론 열기' },
  shift: { tab: 'drone', label: '드론 열기' },
  piece: { tab: 'metronome', label: '메트로놈 열기' },
  review: { tab: 'metronome', label: '메트로놈 열기' },
};

export function Today({ go, openSettings }: { go: (t: TabId) => void; openSettings: () => void }) {
  const { settings, update } = useSettings();
  const { session, now, start, pause, resume, goto, finish, discard, setPiece } = useSession();
  const pieces = usePieces();
  const sessions = useSessions();
  const [memo, setMemo] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => { if (!session) { setMemo(''); setConfirmEnd(false); } }, [session]);

  const today = useToday();
  const runs = useScoreRuns();
  const todaySec = sessions.filter((s) => s.date === today).reduce((a, s) => a + s.totalSec, 0)
    + runs.filter((r) => r.date === today && !r.inSession).reduce((a, r) => a + r.durationSec, 0);
  const days = new Set([...sessions.map((s) => s.date), ...runs.map((r) => r.date)]);
  const st = streak(days, today);
  const routineMin = settings.routine.reduce((a, r) => a + r.minutes, 0);
  const current = currentPieces(pieces);
  const review = pickReview(pieces, 2);

  const progress = useProgress();
  const sug = nextSuggestions(progress);
  const passedSteps = STEPS.filter((x) => progress[x.id]?.passed).length;
  const openEx = (fn: () => Promise<number>) => { requestOpen(fn); go('score'); };
  // 지난번 약했던 마디 (지금 있는 악보만) · 음정 습관
  const ladders = useDrills();
  const [scoreIds, setScoreIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.scores.toCollection().primaryKeys()).subscribe({ next: (k) => setScoreIds(new Set(k as number[])), error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  const weak = scoreIds ? topWeakSpots(runs.filter((r) => scoreIds.has(r.scoreId)), ladders, 3) : [];
  const habits = pitchHabits(runs).slice(0, 4);
  const weakCard = weak.length > 0 && (
    <div className="card" data-testid="today-weak">
      <div className="card-head"><b>지난번 약했던 마디</b></div>
      <ul className="weak-list">
        {weak.map((w) => {
          const l = ladders[ladderKey(w.scoreId, w.measure)];
          return (
            <li key={`${w.scoreId}:${w.measure}`}>
              <span><b>{w.title}</b> <span className="muted small">{w.measure}마디 · {w.okRate !== null ? `맞은 음 ${Math.round(w.okRate * 100)}%` : '자주 벗어남'}{w.meanAbs !== null ? ` · ±${Math.round(w.meanAbs)}센트` : ''}{l && !l.done ? ` · 사다리 ${LADDER_PCTS[l.idx]}%` : ''}</span></span>
              <button className="mini primary" onClick={() => { requestScore({ scoreId: w.scoreId, measure: w.measure, drill: true }); go('score'); }} data-testid="today-drill">집중 연습</button>
            </li>
          );
        })}
      </ul>
      <p className="hint">느린 템포부터 통과할 때마다 10%씩 올려요.</p>
    </div>
  );
  const habitsCard = habits.length > 0 && (
    <div className="card" data-testid="habits-card">
      <div className="card-head"><b>음정 습관</b><span className="muted small">최근 악보 채점에서</span></div>
      <ul className="weak-list">
        {habits.map((h) => {
          const step = STEPS.find((x) => x.spec.pattern === 'scale' && x.spec.positions === '1' && scaleHas(x.spec.key, h.midi));
          return (
            <li key={h.midi}>
              <span><b>{h.string} {h.name}</b> <span className={`small ${Math.abs(h.mean) > 15 ? 'bad' : 'warn'}`}>{h.mean > 0 ? '+' : ''}{Math.round(h.mean)}센트</span><br /><span className="muted small">{h.tip} ({h.n}번)</span></span>
              {step ? <button className="mini" onClick={() => openEx(() => openStep(step))}>{step.title}</button> : <button className="mini" onClick={() => go('drone')}>드론</button>}
            </li>
          );
        })}
      </ul>
      <p className="hint">드론(같은 음 소리)을 켜고 그 음을 길게 켜며 맞추면 손가락 자리가 빨리 잡혀요.</p>
    </div>
  );
  const basicsCard = (
    <div className="card" data-testid="basics-card">
      <div className="card-head"><b>오늘의 기초 연습</b><span className="muted small">연습곡 {passedSteps}/{STEPS.length} 통과</span></div>
      <button className="link rec-title" onClick={() => openEx(() => openStep(sug.step))} data-testid="today-step">
        <b>음계·포지션 · {sug.step.title}</b>
        <span className="muted small">{sug.step.tip}</span>
      </button>
      <button className="link rec-title" onClick={() => openEx(() => createBow(sug.bow.base, sug.bow.key, sug.bow.variant.id, loadOpts()))} data-testid="today-bow">
        <b>활 연습 · {sug.bow.variant.id}. {sug.bow.variant.label}</b>
        <span className="muted small">{sug.bow.baseLabel} · 통과하면 다음 변형을 추천해요</span>
      </button>
    </div>
  );
  const piecesCard = (
    <div className="card">
      <div className="card-head"><b>오늘의 곡</b><button className="link small" onClick={() => go('log')}>곡 관리</button></div>
      {current.length > 0 && <div className="muted small">연습 중</div>}
      <ul className="today-pieces">
        {current.slice(0, 3).map((p) => (
          <li key={p.id}><span>{p.title}</span><span className="muted small">{p.currentBpm ? `♩${p.currentBpm}${p.targetBpm ? ` / ${p.targetBpm}` : ''}` : ''}</span></li>
        ))}
      </ul>
      <div className="muted small">오늘의 복습 곡</div>
      {review.length === 0 ? <p className="muted small">완성·복습 상태인 곡이 없어요. 기록 → 곡에서 1~3권 곡을 불러오거나 상태를 바꿔 보세요.</p> : (
        <ul className="today-pieces" data-testid="review-list">
          {review.map((p) => {
            const ago = daysAgo(p.lastPracticed, today);
            return (
              <li key={p.id}>
                <span>{p.book}권 · {p.title} <span className="muted small">{ago === null ? '처음' : `${ago}일 전`}</span></span>
                <button className="mini" onClick={() => updatePiece(p.id, { lastPracticed: today })}>복습함</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

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
                  <button className="mini" aria-label={`${r.label} 1분 줄이기`} onClick={() => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: Math.max(0, x.minutes - 1) } : x)) })}>−</button>
                  <b>{r.minutes}분</b>
                  <button className="mini" aria-label={`${r.label} 1분 늘리기`} onClick={() => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: Math.min(120, x.minutes + 1) } : x)) })}>＋</button>
                </span>
              </li>
            ))}
          </ol>
          <button className="primary wide big" onClick={() => start(settings.routine.filter((r) => r.minutes > 0))} disabled={!settings.routine.some((r) => r.minutes > 0)} data-testid="session-start">▶ 연습 시작</button>
        </div>
        {weakCard}
        <ReviewCard go={go} scoreIds={scoreIds} />
        {basicsCard}
        {habitsCard}
        {piecesCard}
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
        {cur.key === 'piece' && <PieceChips list={current} selected={session.pieces?.[cur.key]} onPick={(id) => setPiece(cur.key, id)} />}
        {cur.key === 'review' && <PieceChips list={review} selected={session.pieces?.[cur.key]} onPick={(id) => setPiece(cur.key, id)} />}
        {tool && <button className="secondary wide" onClick={() => go(tool.tab)}>{tool.label}</button>}
      </div>
      {(cur.key === 'scale' || cur.key === 'shift') && basicsCard}
      {(cur.key === 'piece' || cur.key === 'review') && <ReviewCard go={go} scoreIds={scoreIds} />}

      <div className="card">
        <ol className="routine done-list">
          {session.items.map((it, i) => (
            <li key={it.key} className={i === session.index ? 'current' : ''} onClick={() => goto(i)}>
              <span>{it.label}{session.pieces?.[it.key] ? <small className="muted"> · {pieces.find((p) => p.id === session.pieces![it.key])?.title}</small> : null}</span>
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
