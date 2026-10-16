export type TabId = 'today' | 'tuner' | 'metronome' | 'drone' | 'score' | 'log';
export const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'today', label: '오늘', icon: '◎' },
  { id: 'tuner', label: '튜너', icon: '♮' },
  { id: 'metronome', label: '메트로놈', icon: '♩' },
  { id: 'drone', label: '음정', icon: '∿' },
  { id: 'score', label: '악보', icon: '♬' },
  { id: 'log', label: '기록', icon: '▦' },
];

export function TabBar({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => onChange(t.id)} aria-current={t.id === tab}>
          <span className="tab-icon" aria-hidden>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
