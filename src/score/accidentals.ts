/** ♯·♭ 붙는 음 이름을 조표 순서대로 (♭: B E A D G C F, ♯: F C G D A E B, 겹은 뒤로) */
const FLAT = 'BEADGCF', SHARP = 'FCGDAEB';
export function sortAcc(names: string[]): string[] {
  const rank = (a: string) => {
    const step = a[0], sign = a.slice(1);
    if (sign === '♭') return FLAT.indexOf(step);
    if (sign === '♯') return 10 + SHARP.indexOf(step);
    return 20 + (sign === '𝄫' ? FLAT.indexOf(step) : 10 + SHARP.indexOf(step));
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}
