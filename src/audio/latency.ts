/** 이어폰(블루투스) 지연 보정. 소리는 그대로 두고, 화면 표시(박 깜빡임·지금 음)를 이만큼 늦춰서 들리는 때에 맞춤 (초) */
let out = 0;
export function setOutputLatency(sec: number) { out = Math.max(0, Math.min(0.4, sec || 0)); }
export function outputLatency() { return out; }
