export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/** 오늘(또는 어제)까지 이어진 연속 연습 일수 */
export function streak(practicedDates: Set<string>, today: string): number {
  let day = practicedDates.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (practicedDates.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return r ? `${m}분 ${r}초` : `${m}분`;
  return `${r}초`;
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
