// 앱 연결 링크 만들기: node make-link.mjs <서버주소> <동기화열쇠>
// 이 링크를 탭·휴대폰에서 열면 설정의 "기기 동기화" 칸이 채워져 있어요 (# 뒤는 서버로 보내지지 않음)
const [url, key] = process.argv.slice(2);
if (!url || !key) { console.log('사용: node make-link.mjs https://violin-sync.○○○.workers.dev 열쇠'); process.exit(1); }
console.log(`https://htcho-max.github.io/violin-practice/#sync=${encodeURIComponent(url)}|${encodeURIComponent(key)}`);
