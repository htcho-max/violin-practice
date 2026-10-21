import { fsSupported, toggleFullscreen, useFullscreen } from '../state/fullscreen';

/** 전체 화면 켜고 끄기. 지원 안 하는 브라우저(아이폰 사파리)에서는 안 보임 */
export function FullscreenButton({ className = 'mini', short = false }: { className?: string; short?: boolean }) {
  const on = useFullscreen();
  if (!fsSupported()) return null;
  return (
    <button type="button" className={`${className} ${on ? 'on' : ''}`} onClick={() => void toggleFullscreen()} aria-label={on ? '화면 꽉 채우기 끝내기' : '화면 꽉 채우기 (전체 화면)'} title={on ? '전체 화면 끝내기' : '전체 화면'} data-testid="fullscreen">
      {on ? '⤡' : '⛶'}{short ? '' : on ? ' 나가기' : ' 전체 화면'}
    </button>
  );
}
