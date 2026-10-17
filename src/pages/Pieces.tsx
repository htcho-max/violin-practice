import { NumField } from '../components/NumField';
import { DraftInput } from '../components/DraftInput';
import { useState } from 'react';
import { db, type Piece, type PieceStatus } from '../data/db';
import { BOOK1_3_PIECES, STATUS_LABEL, STATUS_ORDER, daysAgo } from '../data/pieces';
import { usePieces, updatePiece } from '../state/usePieces';
import { localDate } from '../data/dates';

function PieceRow({ p, today }: { p: Piece; today: string }) {
  const [open, setOpen] = useState(false);
  const ago = daysAgo(p.lastPracticed, today);
  return (
    <li className={`piece ${open ? 'open' : ''}`}>
      <button className="piece-head link" onClick={() => setOpen(!open)}>
        <span className="piece-title">{p.title}</span>
        <span className={`status st-${p.status}`}>{STATUS_LABEL[p.status]}</span>
        <span className="muted small">
          {p.currentBpm ? `♩${p.currentBpm}${p.targetBpm ? `/${p.targetBpm}` : ''} · ` : ''}
          {ago === null ? '기록 없음' : ago === 0 ? '오늘' : `${ago}일 전`}
        </span>
      </button>
      {open && (
        <div className="piece-edit">
          <div className="chips">
            {STATUS_ORDER.map((s) => (
              <button key={s} className={p.status === s ? 'chip on' : 'chip'} onClick={() => updatePiece(p.id, { status: s })}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
          <div className="row-setting">
            <span>현재 ♩</span>
            <NumField value={p.currentBpm ?? 60} min={30} max={250} step={2} width={52} label="현재 BPM" onChange={(v) => updatePiece(p.id, { currentBpm: v })} />
          </div>
          <div className="row-setting">
            <span>목표 ♩</span>
            <NumField value={p.targetBpm ?? 100} min={30} max={250} step={2} width={52} label="목표 BPM" onChange={(v) => updatePiece(p.id, { targetBpm: v })} />
          </div>
          <div className="row-setting">
            <DraftInput className="text" value={p.title} onCommit={(v) => { if (v.trim()) updatePiece(p.id, { title: v.trim() }); }} label="곡 이름" />
            <select value={p.key} onChange={(e) => updatePiece(p.id, { key: e.target.value })} aria-label="조성">
              <option value="">조성</option><option value="G">G장조</option><option value="D">D장조</option><option value="Am">A단조</option><option value="Dm">D단조</option>
            </select>
          </div>
          <DraftInput multiline placeholder="메모 (어려운 마디, 운지 등)" value={p.memo ?? ''} onCommit={(v) => updatePiece(p.id, { memo: v })} label="메모" />
          <div className="session-controls">
            <button onClick={() => updatePiece(p.id, { lastPracticed: today })}>오늘 연습함</button>
            <button className="danger" onClick={() => { if (confirm(`"${p.title}"을(를) 목록에서 지울까요?`)) db.pieces.delete(p.id); }}>지우기</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function Pieces() {
  const pieces = usePieces();
  const today = localDate();
  const [title, setTitle] = useState('');
  const [book, setBook] = useState(4);
  const [filter, setFilter] = useState<PieceStatus | 'all'>('all');
  const books = [...new Set(pieces.map((p) => p.book))].sort((a, b) => b - a);
  const hasOld = pieces.some((p) => p.book < 4);
  const shown = pieces.filter((p) => filter === 'all' || p.status === filter);

  async function add() {
    if (!title.trim()) return;
    const order = Math.max(0, ...pieces.filter((p) => p.book === book).map((p) => p.order ?? 0)) + 1;
    await db.pieces.add({ id: `u-${Date.now()}`, book, title: title.trim(), key: '', status: book < 4 ? 'review' : 'learning', order });
    setTitle('');
  }

  return (
    <div className="page-sub">
      <div className="chips">
        <button className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')}>전체 {pieces.length}</button>
        {STATUS_ORDER.map((s) => {
          const n = pieces.filter((p) => p.status === s).length;
          return n ? <button key={s} className={filter === s ? 'chip on' : 'chip'} onClick={() => setFilter(s)}>{STATUS_LABEL[s]} {n}</button> : null;
        })}
      </div>
      {books.map((b) => {
        const list = shown.filter((p) => p.book === b);
        if (!list.length) return null;
        return (
          <div key={b} className="card">
            <b>{b}권</b>
            <ul className="piece-list">{list.map((p) => <PieceRow key={p.id} p={p} today={today} />)}</ul>
          </div>
        );
      })}
      <div className="card">
        <b>곡 추가</b>
        <div className="row-setting">
          <select value={book} onChange={(e) => setBook(Number(e.target.value))} aria-label="권">
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}권</option>)}
          </select>
          <input className="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="곡 이름" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="mini" onClick={add}>추가</button>
        </div>
        {!hasOld && (
          <button className="secondary" onClick={() => db.pieces.bulkPut(BOOK1_3_PIECES)} data-testid="seed-old">
            스즈키 1~3권 곡 불러오기 (복습용)
          </button>
        )}
        <p className="hint">1~3권 목록은 판본마다 조금 다를 수 있어요. 가진 교재와 다르면 곡을 눌러 고치거나 지우세요.</p>
      </div>
    </div>
  );
}
