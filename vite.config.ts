import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import pkg from './package.json';

// 버전: package.json 버전 + 빌드 시각(+ GitHub 커밋 7자리)
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const sha = process.env.GITHUB_SHA ? ` · ${process.env.GITHUB_SHA.slice(0, 7)}` : '';
const APP_VERSION = `${pkg.version} (${stamp}${sha})`;

export default defineConfig(({ mode }) => ({
  // GitHub Pages 에서는 /violin-practice/ 아래에서 열립니다 (배포 워크플로가 BASE_PATH 지정)
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    // 휴대폰에서 마이크를 쓰려면 HTTPS가 필요해서, phone 모드에서는 임시 인증서로 띄웁니다
    ...(mode === 'phone' ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 악보 표시 라이브러리(약 1.5MB)도 오프라인에서 쓰도록 캐시
      workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      includeAssets: ['icon.svg'],
      manifest: {
        name: '바이올린 연습 도우미',
        short_name: '바이올린',
        description: '튜너, 메트로놈, 드론, 연습 기록',
        theme_color: '#1f2937',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ko',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/local/**', 'node_modules/**'] },
}));
