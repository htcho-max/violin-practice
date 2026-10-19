import type { ClickSound } from '../audio/metronome';

export interface RoutineItem { key: string; label: string; minutes: number }

export interface Settings {
  a4: number;
  clickSound: ClickSound;
  clickVolume: number;
  wakeLock: boolean;
  minDb: number;
  bpm: number;
  meterId: string;
  subdivision: number;
  accent: boolean;
  droneVolume: number;
  routine: RoutineItem[];
  /** 이어폰 지연 보정 (ms) */
  latencyMs: number;
  /** 연습 항목 시간이 끝나면 알림 (소리·진동·안내) */
  itemAlert: boolean;
}

export const DEFAULT_ROUTINE: RoutineItem[] = [
  { key: 'tune', label: '튜닝', minutes: 1 },
  { key: 'scale', label: '음계·드론', minutes: 5 },
  { key: 'shift', label: '포지션 이동', minutes: 5 },
  { key: 'piece', label: '곡 구간 연습', minutes: 15 },
  { key: 'review', label: '복습 곡', minutes: 4 },
];

export const DEFAULT_SETTINGS: Settings = {
  a4: 440,
  clickSound: 'wood',
  clickVolume: 0.8,
  wakeLock: true,
  minDb: -50,
  bpm: 80,
  meterId: '4/4',
  subdivision: 1,
  accent: true,
  droneVolume: 0.3,
  routine: DEFAULT_ROUTINE,
  latencyMs: 0,
  itemAlert: true,
};

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}
