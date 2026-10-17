import { useCallback, useEffect, useState } from 'react';
import { pitchTracker, type PitchReading } from '../audio/pitchTracker';

/** 화면에 있는 동안만 마이크를 씁니다. */
export function usePitch(minDb: number, opts: { reading?: boolean } = {}) {
  const wantReading = opts.reading !== false;
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [on, setOn] = useState(pitchTracker.running);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { pitchTracker.minDb = minDb; }, [minDb]);
  // 매 프레임 값이 필요 없는 화면(악보)은 구독하지 않아 다시 그리기를 줄임
  useEffect(() => (wantReading ? pitchTracker.subscribe(setReading) : undefined), [wantReading]);
  useEffect(() => () => { pitchTracker.stop(); }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      await pitchTracker.start();
      setOn(true);
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(name === 'NotAllowedError'
        ? '마이크 권한이 거부됐어요. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.'
        : '마이크를 열 수 없어요. 다른 앱이 마이크를 쓰고 있는지 확인해 주세요.');
    }
  }, []);
  const stop = useCallback(() => { pitchTracker.stop(); setOn(false); setReading(null); }, []);

  return { reading, on, error, start, stop };
}
