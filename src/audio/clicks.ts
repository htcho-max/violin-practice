/** 메트로놈이 예약한 클릭 시각(AudioContext 시간). 음높이 분석에서 클릭 구간을 빼는 데 씁니다. */
const times: number[] = [];

export function noteClick(t: number) {
  times.push(t);
  if (times.length > 4096) times.splice(0, times.length - 4096); // 악보 재생은 클릭을 미리 한꺼번에 예약
}

export function clearClicks() { times.length = 0; }

/** [now - windowSec - pad, now + pad] 안에 클릭이 있으면 true */
export function clickNear(now: number, windowSec: number, pad = 0.03): boolean {
  for (let i = times.length - 1; i >= 0; i--) {
    const t = times[i];
    if (t >= now - windowSec - pad && t <= now + pad) return true;
  }
  return false;
}
