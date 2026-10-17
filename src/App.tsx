import { useEffect, useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { SettingsSheet } from './components/SettingsSheet';
import { Today } from './pages/Today';
import { Tuner } from './pages/Tuner';
import { Metronome } from './pages/Metronome';
import { Drone } from './pages/Drone';
import { Log } from './pages/Log';
import { Score } from './pages/Score';
import { useSettings } from './state/settings';
import { useBackLayer, setExitWarning, restoreGuard } from './state/back';

const TITLES: Record<TabId, string> = { today: '오늘의 연습', tuner: '튜너', metronome: '메트로놈', drone: '음정 · 드론', score: '악보', log: '연습 기록' };

export function App({ updatedFrom = null }: { updatedFrom?: string | null }) {
  const [toast, setToast] = useState<string | null>(updatedFrom ? `새 버전으로 업데이트됐어요 · ${__APP_VERSION__}` : null);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);
  const [tab, setTab] = useState<TabId>(() => {
    try { return (localStorage.getItem('violin-tab') as TabId) || 'today'; } catch { return 'today'; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { ready } = useSettings();
  const go = (t: TabId) => { setTab(t); try { localStorage.setItem('violin-tab', t); } catch { /* 무시 */ } };
  // 뒤로 가기: 설정 창 → 닫기, 다른 탭 → 오늘, 오늘에서는 한 번 안내
  useBackLayer(tab !== 'today', () => go('today'));
  useBackLayer(settingsOpen, () => setSettingsOpen(false));
  useEffect(() => {
    setExitWarning(() => setToast('뒤로 버튼을 한 번 더 누르면 앱이 닫혀요'));
    const again = () => restoreGuard();
    window.addEventListener('pointerdown', again);
    return () => { setExitWarning(null); window.removeEventListener('pointerdown', again); };
  }, []);

  return (
    <div className="app">
      <header className="topbar"><h1>{TITLES[tab]}</h1></header>
      <StatusBar tab={tab} go={go} />
      <main>
        {!ready ? null : (
          <>
            {tab === 'today' && <Today go={go} openSettings={() => setSettingsOpen(true)} />}
            {tab === 'tuner' && <Tuner />}
            {tab === 'metronome' && <Metronome />}
            {tab === 'drone' && <Drone />}
            {tab === 'score' && <Score />}
            {tab === 'log' && <Log />}
          </>
        )}
      </main>
      <TabBar tab={tab} onChange={go} />
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast" role="status" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  );
}
