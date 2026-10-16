import { useSettings } from '../state/settings';
import { db } from '../data/db';
import { DEFAULT_ROUTINE } from '../data/settings';
import { useState } from 'react';
import { checkForUpdate } from '../state/appUpdate';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [updateMsg, setUpdateMsg] = useState('');

  async function exportData() {
    const data = { exportedAt: new Date().toISOString(), settings, sessions: await db.sessions.toArray() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `violin-practice-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="설정">
        <div className="card-head"><b>설정</b><button className="mini" onClick={onClose}>닫기</button></div>

        <div className="row-setting">
          <span>기준 A</span>
          <button className="mini" onClick={() => update({ a4: Math.max(438, settings.a4 - 1) })}>−</button>
          <b>{settings.a4} Hz</b>
          <button className="mini" onClick={() => update({ a4: Math.min(445, settings.a4 + 1) })}>＋</button>
        </div>
        <div className="row-setting col">
          <span>마이크 민감도 <small className="muted">(잡음이 많으면 낮추기)</small></span>
          <input type="range" min={-65} max={-30} step={1} value={-settings.minDb - 95} onChange={(e) => update({ minDb: -95 - Number(e.target.value) })} aria-label="마이크 민감도" />
          <small className="muted">{settings.minDb} dB 보다 큰 소리만 분석</small>
        </div>
        <div className="row-setting">
          <label><input type="checkbox" checked={settings.wakeLock} onChange={(e) => update({ wakeLock: e.target.checked })} /> 연습 중 화면 꺼짐 방지</label>
        </div>

        <h3>루틴 항목</h3>
        {settings.routine.map((r, i) => (
          <div key={r.key} className="row-setting">
            <input className="text" value={r.label} onChange={(e) => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="항목 이름" />
            <input className="num" type="number" min={0} max={120} value={r.minutes} onChange={(e) => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: Math.max(0, Number(e.target.value)) } : x)) })} aria-label="분" />
            <span>분</span>
          </div>
        ))}
        <button className="secondary" onClick={() => update({ routine: DEFAULT_ROUTINE })}>기본 루틴으로 되돌리기</button>

        <h3>데이터</h3>
        <p className="muted small">기록은 이 기기의 브라우저 안에만 저장돼요. 가끔 내보내 두세요.</p>
        <button className="secondary" onClick={exportData}>기록 내보내기 (JSON)</button>

        <h3>앱 정보</h3>
        <p className="muted small" data-testid="app-version">버전 {__APP_VERSION__}</p>
        <button className="secondary" onClick={async () => {
          setUpdateMsg('확인 중…');
          try {
            const r = await checkForUpdate();
            setUpdateMsg(r === 'checked' ? '확인했어요. 새 버전이 있으면 잠시 후 자동으로 새로고침돼요.' : '이 환경에서는 업데이트 확인을 지원하지 않아요.');
          } catch { setUpdateMsg('인터넷 연결을 확인해 주세요.'); }
        }}>업데이트 확인</button>
        {updateMsg && <p className="muted small">{updateMsg}</p>}
      </div>
    </div>
  );
}
