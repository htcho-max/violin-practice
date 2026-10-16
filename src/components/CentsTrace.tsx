import { useEffect, useRef } from 'react';
import { midiName } from '../audio/notes';

export interface TraceSource { current: { t: number; cents: number | null; midi?: number | null }[] }

interface Props {
  source: TraceSource;
  seconds: number;
  range?: number; // ±센트
  height?: number;
  labels?: boolean;
  /** 고정 데이터(녹음)면 시간축을 데이터 끝에 맞추지 않고 0~seconds 로 */
  fixed?: boolean;
  testId?: string;
}

function css(name: string, fallback: string) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** 목표 음 대비 센트를 시간에 따라 그리는 캔버스. 매 프레임 다시 그림 */
export function CentsTrace({ source, seconds, range = 50, height = 160, labels = true, fixed = false, testId }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const y = (cents: number) => h / 2 - (Math.max(-range, Math.min(range, cents)) / range) * (h / 2 - 6);
      // 구간
      g.fillStyle = css('--warn-zone', 'rgba(202,138,4,.12)');
      g.fillRect(0, y(15), w, y(-15) - y(15));
      g.fillStyle = css('--good-zone', 'rgba(21,128,61,.18)');
      g.fillRect(0, y(5), w, y(-5) - y(5));
      g.strokeStyle = css('--line', '#ddd');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
      g.fillStyle = css('--muted', '#888');
      g.font = '11px system-ui';
      g.fillText(`+${range}`, 4, 12); g.fillText(`-${range}`, 4, h - 4);
      const pts = source.current;
      if (!pts.length) return;
      const tEnd = fixed ? seconds : pts[pts.length - 1].t;
      const tStart = tEnd - seconds;
      const x = (t: number) => ((t - tStart) / seconds) * w;
      const good = css('--good', '#15803d'), warn = css('--warn', '#ca8a04'), bad = css('--bad', '#dc2626');
      g.lineWidth = 2;
      let prev: { x: number; y: number; midi?: number | null } | null = null;
      let lastLabel: number | null | undefined = null;
      let lastLabelX = -Infinity;
      for (const p of pts) {
        if (p.t < tStart) continue;
        if (p.cents === null) { prev = null; continue; }
        const X = x(p.t), Y = y(p.cents);
        const a = Math.abs(p.cents);
        g.strokeStyle = a <= 5 ? good : a <= 15 ? warn : bad;
        if (prev && prev.midi === p.midi) { g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(X, Y); g.stroke(); }
        if (labels && p.midi != null && p.midi !== lastLabel) {
          const lx = Math.max(36, Math.min(w - 30, X + 2));
          if (lx - lastLabelX >= 32) { // 겹치면 건너뜀
            g.fillStyle = css('--text', '#222');
            g.font = '600 12px system-ui';
            g.fillText(midiName(p.midi), lx, 14);
            lastLabelX = lx;
          }
          lastLabel = p.midi;
        }
        prev = { x: X, y: Y, midi: p.midi };
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [source, seconds, range, labels, fixed]);
  return <canvas ref={canvas} className="trace" style={{ height }} data-testid={testId} />;
}
