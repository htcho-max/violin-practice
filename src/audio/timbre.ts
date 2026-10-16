/** 바이올린과 비슷하게 배음이 있는 음색 (톱니파를 부드럽게) */
export function stringWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 16;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (1 / k) * Math.exp(-k / 9);
  return ctx.createPeriodicWave(real, imag);
}
