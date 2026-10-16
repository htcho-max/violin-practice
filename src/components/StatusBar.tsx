import { useSession, itemMs } from '../state/session';
import { useAudioStatus, setAudioStatus } from '../state/audioStatus';
import { metronome } from '../audio/metronome';
import { drone } from '../audio/drone';
import { clock } from '../data/dates';
import type { TabId } from './TabBar';

/** 다른 탭에서도 보이는 진행 중 세션·소리 표시 */
export function StatusBar({ tab, go }: { tab: TabId; go: (t: TabId) => void }) {
  const { session, now, pause, resume } = useSession();
  const audio = useAudioStatus();
  const showSession = session && tab !== 'today';
  const showMetro = audio.metronome && tab !== 'metronome';
  const showDrone = audio.drone && tab !== 'drone';
  if (!showSession && !showMetro && !showDrone) return null;
  return (
    <div className="statusbar">
      {showSession && session && (
        <div className="status-chip">
          <button className="link" onClick={() => go('today')}>
            {session.items[session.index].label} {clock(itemMs(session, session.index, now) / 1000)}
          </button>
          <button className="mini" onClick={session.runningSince === null ? resume : pause}>
            {session.runningSince === null ? '▶' : '❚❚'}
          </button>
        </div>
      )}
      {showMetro && (
        <div className="status-chip">
          <button className="link" onClick={() => go('metronome')}>메트로놈 {metronome.core.bpm}</button>
          <button className="mini" onClick={() => { metronome.stop(); setAudioStatus({ metronome: false }); }}>■</button>
        </div>
      )}
      {showDrone && (
        <div className="status-chip">
          <button className="link" onClick={() => go('drone')}>드론 {audio.droneLabel}</button>
          <button className="mini" onClick={() => { drone.stop(); setAudioStatus({ drone: false }); }}>■</button>
        </div>
      )}
    </div>
  );
}
