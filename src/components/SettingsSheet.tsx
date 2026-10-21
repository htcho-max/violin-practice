import { useSettings } from '../state/settings';
import { DEFAULT_ROUTINE } from '../data/settings';
import { useEffect, useRef, useState } from 'react';
import { saveBackup, restoreBackup, storageInfo } from '../data/backup';
import { checkForUpdate } from '../state/appUpdate';
import { NumField } from './NumField';
import { RecCleanup } from './RecCleanup';
import { FullscreenButton } from './FullscreenButton';
import { fsSupported, isStandalone } from '../state/fullscreen';
import { TOLERANCES, tolFor, type ToleranceId } from '../score/tolerance';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [updateMsg, setUpdateMsg] = useState('');

  const [busy, setBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState('');
  const [info, setInfo] = useState<{ usedMB: number; persisted: boolean | null } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { storageInfo().then(setInfo); }, []);
  async function backup(withRec: boolean) {
    setBusy(true); setDataMsg('');
    try { await saveBackup(withRec); setDataMsg('백업 파일을 만들었어요.'); } catch { setDataMsg('백업 파일을 만들지 못했어요.'); } finally { setBusy(false); }
  }
  async function restore(f: File) {
    if (!confirm('지금 이 기기의 기록을 백업 파일 내용으로 바꿀까요? (되돌릴 수 없어요)')) return;
    setBusy(true); setDataMsg('');
    try {
      const { counts } = await restoreBackup(await f.text());
      setDataMsg(`되돌렸어요: 연습 ${counts.sessions ?? 0}번, 악보 ${counts.scores ?? 0}개, 악보 연습 ${counts.scoreRuns ?? 0}번, 녹음 ${counts.recordings ?? '그대로'}${counts.recordings !== undefined ? '개' : ''}. 잠시 후 다시 불러와요.`);
      setTimeout(() => location.reload(), 1500);
    } catch (e) { setDataMsg((e as Error).message || '백업 파일을 읽지 못했어요.'); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정">
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
        <div className="row-setting col">
          <span>전체 화면 <small className="muted">(주소창·상태 표시줄 숨기기)</small></span>
          {fsSupported() ? <FullscreenButton className="secondary" /> : <small className="muted">이 브라우저는 전체 화면을 지원하지 않아요.{isStandalone() ? '' : ' 아이폰·아이패드는 사파리 공유 버튼 → "홈 화면에 추가"로 설치하면 주소창 없이 쓸 수 있어요.'}</small>}
          <small className="muted">화면 위 ⛶ 버튼으로도 켜고 꺼요. 끝낼 때는 ⤡ 버튼이나 뒤로 가기.</small>
        </div>
        <div className="row-setting">
          <label><input type="checkbox" checked={settings.wakeLock} onChange={(e) => update({ wakeLock: e.target.checked })} /> 연습 중 화면 꺼짐 방지</label>
        </div>
        <div className="row-setting">
          <label><input type="checkbox" checked={settings.itemAlert} onChange={(e) => update({ itemAlert: e.target.checked })} data-testid="item-alert-setting" /> 항목 시간 끝 알림 (짧은 소리·진동)</label>
        </div>

        <div className="row-setting col">
          <span>음정 판정 기준 <small className="muted">(악보 채점 색·지금 내는 음)</small></span>
          <span className="metro-pick">
            {(['strict', 'normal', 'relaxed'] as ToleranceId[]).map((id) => (
              <button key={id} type="button" className={`chip ${tolFor(settings.pitchTolerance).id === id ? 'on' : ''}`} onClick={() => update({ pitchTolerance: id })} data-testid={`set-tol-${id}`}>{TOLERANCES[id].label}</button>
            ))}
          </span>
          <small className="muted">{tolFor(settings.pitchTolerance).hint}. 초록 안이면 맞음, 노랑까지는 거의 맞음, 그 밖은 빨강.</small>
        </div>
        <div className="row-setting col">
          <span>이어폰 지연 보정 <small className="muted">(블루투스 이어폰은 보통 150~250ms)</small></span>
          <span><NumField value={settings.latencyMs} min={0} max={400} step={10} label="이어폰 지연 보정 ms" width={56} testId="latency" onChange={(v) => update({ latencyMs: v })} /> ms</span>
          <small className="muted">메트로놈·악보 듣기에서 박 깜빡임과 지금 음 표시를 이만큼 늦춰, 이어폰으로 들리는 때와 맞춰요. 유선 이어폰·스피커는 0.</small>
        </div>

        <h3>루틴 항목</h3>
        {settings.routine.map((r, i) => (
          <div key={r.key} className="row-setting">
            <input className="text" value={r.label} onChange={(e) => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="항목 이름" />
            <NumField value={r.minutes} min={0} max={120} label={`${r.label} 분`} width={48} onChange={(v) => update({ routine: settings.routine.map((x, j) => (j === i ? { ...x, minutes: v } : x)) })} />
            <span>분</span>
          </div>
        ))}
        <button className="secondary" onClick={() => update({ routine: DEFAULT_ROUTINE })}>기본 루틴으로 되돌리기</button>

        <h3>데이터</h3>
        <p className="muted small">연습 기록·악보·녹음은 이 기기의 브라우저 안에만 저장돼요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업해 두세요.{info ? ` 지금 ${info.usedMB < 1 ? '1MB 미만' : `${Math.round(info.usedMB)}MB`} 사용 중.` : ''}{info?.persisted === false ? ' 브라우저가 공간이 부족할 때 지울 수 있는 상태예요. 홈 화면에 앱으로 설치하면 더 안전해요.' : ''}</p>
        <button className="secondary" onClick={() => backup(false)} disabled={busy} data-testid="backup">백업 파일 만들기 (녹음 제외)</button>
        <button className="secondary" onClick={() => backup(true)} disabled={busy}>백업 파일 만들기 (녹음 포함, 파일이 커요)</button>
        <RecCleanup onDone={() => storageInfo().then(setInfo)} />
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} data-testid="restore-file" />
        <button className="secondary" onClick={() => file.current?.click()} disabled={busy}>백업에서 되돌리기</button>
        {dataMsg && <p className="muted small" data-testid="data-msg">{dataMsg}</p>}

        <h3>앱 정보</h3>
        <p className="muted small" data-testid="app-version">버전 {__APP_VERSION__}</p>
        <button className="secondary" onClick={async () => {
          setUpdateMsg('확인 중…');
          try {
            const r = await checkForUpdate();
            setUpdateMsg(r === 'checked' ? '확인했어요. 새 버전이 있으면 연습 중이 아닐 때 자동으로 새로고침돼요.' : '이 환경에서는 업데이트 확인을 지원하지 않아요.');
          } catch { setUpdateMsg('인터넷 연결을 확인해 주세요.'); }
        }}>업데이트 확인</button>
        {updateMsg && <p className="muted small">{updateMsg}</p>}
      </div>
    </div>
  );
}
