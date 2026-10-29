import { useState } from 'react';
import { disableSync, enableSync, loadConfig, syncNow } from '../sync/engine';
import { useSyncStatus } from '../sync/auto';
import { newSyncKey, SyncError } from '../sync/net';

const ago = (t?: number) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? '방금' : s < 3600 ? `${Math.round(s / 60)}분 전` : new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** 설정: 기기 간 동기화 (Cloudflare) */
/** 연결 링크 (앱주소#sync=서버|열쇠) 로 열었으면 칸을 채워 둠 */
export function takeSyncLink() {
  try {
    const m = /^#sync=([^|]+)\|(.+)$/.exec(location.hash);
    if (!m) return;
    localStorage.setItem(PREFILL, JSON.stringify({ url: decodeURIComponent(m[1]), key: decodeURIComponent(m[2]) }));
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* 무시 */ }
}
const PREFILL = 'violin-sync-prefill';
function prefill(): { url?: string; key?: string } {
  try { return JSON.parse(localStorage.getItem(PREFILL) || '{}'); } catch { return {}; }
}
/** 연결 링크로 열었는데 아직 안 켰으면 */
export const hasSyncPrefill = () => { try { return !!localStorage.getItem(PREFILL) && !loadConfig(); } catch { return false; } };

export function SyncCard() {
  const st = useSyncStatus();
  const cfg = loadConfig();
  const [url, setUrl] = useState(cfg?.url ?? prefill().url ?? '');
  const [key, setKey] = useState(cfg?.key ?? prefill().key ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  async function turnOn() {
    if (!confirm('동기화를 켤까요?\n\n· 처음 켜는 기기(주로 쓰는 탭)의 기록이 서버에 올라가요.\n· 이미 서버에 기록이 있으면, 같은 항목은 서버 쪽이 이기고 이 기기에만 있던 기록은 합쳐져요.\n· 켜고 나면 앱을 한 번 새로 열어요.')) return;
    setBusy(true); setMsg('연결하는 중… (처음엔 악보를 올리느라 1~2분 걸릴 수 있어요)');
    try {
      await enableSync(url, key);
      try { localStorage.removeItem(PREFILL); } catch { /* 무시 */ }
      setMsg('동기화를 켰어요. 앱을 새로 여는 중…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setMsg(e instanceof SyncError ? e.message : `켜지 못했어요: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  if (!cfg) {
    return (
      <div className="sync-card" data-testid="sync-card">
        <p className="muted small">탭과 휴대폰의 연습 기록·악보·내 표시·세브치크를 서로 맞춰 줘요 (녹음은 빼고). 내 Cloudflare 서버 주소와 동기화 열쇠가 필요해요 — 만드는 방법은 저장소 cloud/README.md.</p>
        <label className="small">서버 주소<input type="url" inputMode="url" placeholder="https://violin-sync.○○○.workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="sync-url" /></label>
        <label className="small">동기화 열쇠<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} data-testid="sync-key" /></label>
        <button className="primary" onClick={turnOn} disabled={busy || !url || !key} data-testid="sync-on">동기화 켜기</button>
        <button className="mini" onClick={() => { const k = newSyncKey(); setMade(k); setKey(k); }} disabled={busy}>새 열쇠 만들기</button>
        {made && <p className="small">새 열쇠: <code className="sync-keytext" data-testid="sync-newkey">{made}</code> <button className="mini" onClick={() => navigator.clipboard?.writeText(made).catch(() => {})}>복사</button> — 서버에 넣고(wrangler secret put SYNC_KEY) 다른 기기에도 같은 열쇠를 넣으세요.</p>}
        {prefill().key && <p className="muted small">연결 링크로 서버 주소와 열쇠를 채워 두었어요. "동기화 켜기"를 누르세요.</p>}
        {msg && <p className="muted small" data-testid="sync-msg">{msg}</p>}
      </div>
    );
  }
  const text = st.state === 'syncing' ? '동기화하는 중…'
    : st.state === 'error' ? `문제: ${st.error}`
    : st.lastOk ? `마지막 동기화 ${ago(st.lastOk)}${st.pulled || st.pushed ? ` (받음 ${st.pulled ?? 0} · 보냄 ${st.pushed ?? 0})` : ''}` : '아직 동기화 전이에요.';
  return (
    <div className="sync-card" data-testid="sync-card">
      <p className={`small ${st.state === 'error' ? 'error' : 'muted'}`} data-testid="sync-status">{text}</p>
      <p className="muted small">서버: {cfg.url.replace(/^https?:\/\//, '')}</p>
      <button className="secondary" onClick={() => { setMsg(null); syncNow(); }} disabled={st.state === 'syncing'} data-testid="sync-now">지금 동기화</button>
      <button className="mini danger" onClick={() => { if (confirm('이 기기의 동기화를 끌까요? 기록은 이 기기에 그대로 남아요. 다시 켜면 서로 맞춰요 (같은 항목은 나중에 고친 쪽이 이겨요).')) { disableSync(); setMsg('동기화를 껐어요.'); } }} data-testid="sync-off">동기화 끄기</button>
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
