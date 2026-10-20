import { useState } from 'react';
import { applyCleanup, makeCleanupPlan, KEEP_LATEST } from '../data/cleanup';

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);

/** 녹음 자동 정리 버튼: 악보 채점 녹음을 악보마다 처음·가장 잘한·최근 몇 개만 남기고 지움 (채점 기록은 남음) */
export function RecCleanup({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function run() {
    setBusy(true); setMsg('');
    try {
      const plan = await makeCleanupPlan();
      if (!plan.remove.length) { setMsg(`정리할 녹음이 없어요. 악보마다 처음·가장 잘한·최근 ${KEEP_LATEST}개는 남겨요.`); return; }
      if (!confirm(`악보 ${plan.scores}곡에서 녹음 ${plan.remove.length}개(약 ${mb(plan.bytes)})를 지울까요?\n\n악보마다 처음 녹음, 가장 잘한 녹음, 최근 ${KEEP_LATEST}개는 남겨요.\n채점 기록·분석은 그대로 남고, 따로 녹음한 것(자유 녹음)은 건드리지 않아요.`)) return;
      await applyCleanup(plan.remove);
      setMsg(`녹음 ${plan.remove.length}개를 지웠어요 (약 ${mb(plan.bytes)}). 채점 기록은 그대로예요.`);
      onDone?.();
    } catch { setMsg('녹음을 정리하지 못했어요.'); } finally { setBusy(false); }
  }
  return (
    <div className="rec-cleanup">
      <button className="secondary" onClick={run} disabled={busy} data-testid="rec-cleanup">🧹 녹음 자동 정리</button>
      <small className="muted">악보 연습 녹음을 악보마다 처음·가장 잘한·최근 {KEEP_LATEST}개만 남겨요. 채점 기록은 지우지 않아요.</small>
      {msg && <p className="muted small" data-testid="rec-cleanup-msg">{msg}</p>}
    </div>
  );
}
