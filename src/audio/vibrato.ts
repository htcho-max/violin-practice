/** 비브라토 분석: 한 음을 길게 낼 때 음높이가 흔들리는 폭·속도·중심 */
export interface VibratoResult {
  rateHz: number; // 1초에 몇 번 흔드는지
  widthCents: number; // 중심에서 위아래로 몇 센트 (반폭)
  centerCents: number; // 흔들림의 중심이 목표 음에서 몇 센트
  topCents: number; // 가장 높이 올라간 곳 (목표 음 대비)
  bottomCents: number;
  cycles: number;
}

export interface CentsPoint { t: number; cents: number }

/** 분석 창이 길면 빠른 흔들림이 줄어 보여서 보정합니다 (창 평균 = sinc 감쇠) */
export function windowGain(rateHz: number, windowSec: number): number {
  const x = Math.PI * rateHz * windowSec;
  return x === 0 ? 1 : Math.sin(x) / x;
}

/**
 * pts: 같은 음 안의 (시간, 목표 음 대비 센트). 최근 0.6초 이상 필요.
 * 흔들림이 없거나 너무 느리거나 빠르면 null.
 */
export function analyzeVibrato(pts: CentsPoint[], windowSec = 0): VibratoResult | null {
  if (pts.length < 20) return null;
  const t0 = pts[0].t;
  const dur = pts[pts.length - 1].t - t0;
  if (dur < 0.6) return null;

  // 직선 추세 빼기 (음이 서서히 올라가거나 내려가는 것 제외)
  const n = pts.length;
  let st = 0, sc = 0, stt = 0, stc = 0;
  for (const p of pts) { const t = p.t - t0; st += t; sc += p.cents; stt += t * t; stc += t * p.cents; }
  const slope = (n * stc - st * sc) / (n * stt - st * st || 1);
  const icpt = (sc - slope * st) / n;
  const d = pts.map((p) => ({ t: p.t, v: p.cents - (icpt + slope * (p.t - t0)) }));

  // 0을 지나는 시각 (선형 보간)
  const crossings: number[] = [];
  for (let i = 1; i < d.length; i++) {
    const a = d[i - 1], b = d[i];
    if ((a.v < 0 && b.v >= 0) || (a.v > 0 && b.v <= 0)) {
      crossings.push(a.t + (b.t - a.t) * (a.v / (a.v - b.v)));
    }
  }
  if (crossings.length < 5) return null; // 최소 2주기
  const span = crossings[crossings.length - 1] - crossings[0];
  const rateHz = (crossings.length - 1) / 2 / span;
  if (rateHz < 3 || rateHz > 9) return null;

  // 각 반주기의 최대 |값| 평균 = 반폭
  const peaks: number[] = [];
  for (let k = 1; k < crossings.length; k++) {
    let m = 0;
    for (const p of d) if (p.t > crossings[k - 1] && p.t < crossings[k]) m = Math.max(m, Math.abs(p.v));
    peaks.push(m);
  }
  const g = windowSec > 0 ? Math.max(0.5, windowGain(rateHz, windowSec)) : 1;
  const widthCents = peaks.reduce((a, b) => a + b, 0) / peaks.length / g;
  if (widthCents < 3) return null; // 사실상 흔들림 없음

  const centerCents = pts.reduce((a, p) => a + p.cents, 0) / n;
  return {
    rateHz,
    widthCents,
    centerCents,
    topCents: centerCents + widthCents,
    bottomCents: centerCents - widthCents,
    cycles: Math.floor((crossings.length - 1) / 2),
  };
}

/** 간단한 평가 문구 */
export function vibratoAdvice(v: VibratoResult): string[] {
  const out: string[] = [];
  if (v.topCents > 10) out.push(`흔들림이 음보다 ${Math.round(v.topCents)}센트 위까지 올라가요. 음에서 아래쪽으로 흔드는 게 기본이에요.`);
  if (v.centerCents > 5) out.push('흔들림의 중심이 높아요. 손가락을 음 자리에 두고 뒤(아래)로 굴려 보세요.');
  if (v.rateHz < 4.5) out.push('느린 편이에요. 메트로놈 8분·셋잇단에 맞춰 조금씩 빠르게 연습해 보세요.');
  if (v.rateHz > 7.5) out.push('빠른 편이에요. 팔과 손에 힘이 들어갔는지 확인해 보세요.');
  if (v.widthCents > 35) out.push('폭이 넓어요. 4권 곡에서는 ±15~25센트 정도가 자연스러워요.');
  if (!out.length) out.push('좋아요. 폭과 속도가 안정적이에요.');
  return out;
}
