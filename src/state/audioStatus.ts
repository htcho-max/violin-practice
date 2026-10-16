import { useSyncExternalStore } from 'react';

/** 페이지를 옮겨도 계속 도는 소리(메트로놈, 드론)의 상태 */
interface Status { metronome: boolean; drone: boolean; droneLabel: string }
let status: Status = { metronome: false, drone: false, droneLabel: '' };
const listeners = new Set<() => void>();

export function setAudioStatus(patch: Partial<Status>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useAudioStatus(): Status {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => status,
  );
}
