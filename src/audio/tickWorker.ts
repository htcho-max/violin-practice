// 탭이 뒤로 가도 덜 느려지는 Worker 타이머
let id: ReturnType<typeof setInterval> | null = null;
self.onmessage = (e: MessageEvent<'start' | 'stop'>) => {
  if (e.data === 'start' && id === null) id = setInterval(() => self.postMessage('tick'), 25);
  if (e.data === 'stop' && id !== null) { clearInterval(id); id = null; }
};
