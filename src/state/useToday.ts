import { useEffect, useState } from 'react';
import { localDate } from '../data/dates';

/** 다음 자정까지 남은 ms (자정 직후 조금 더 기다림) */
export function msUntilNextMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** 오늘 날짜(YYYY-MM-DD). 앱을 켜 둔 채 자정이 지나거나, 다른 날 다시 화면에 돌아오면 바뀜 */
export function useToday(): string {
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => setToday((t) => { const n = localDate(); return n === t ? t : n; });
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { check(); arm(); }, msUntilNextMidnight()); };
    const onShow = () => { if (document.visibilityState === 'visible') { check(); arm(); } };
    arm();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, []);
  return today;
}
