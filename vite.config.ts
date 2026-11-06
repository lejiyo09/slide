/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages(하위 경로) 배포를 위해 상대 경로 base 사용
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'SlideLab — 프레젠테이션 편집기',
        short_name: 'SlideLab',
        description: '설치 없이 사용하는 웹 기반 프레젠테이션 편집기',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        background_color: '#f3f3f3',
        theme_color: '#c43e1c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
              'application/x-slidelab+json': ['.slidelab'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // 자체 호스팅 웹 글꼴(scripts/webfonts.mjs, 약 66MB)은 미리 받지 않고 쓸 때만 캐시
        globIgnores: ['webfonts/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // 무료 웹 글꼴: 한 번 받으면 오프라인에서도 사용 (Workbox 권장 Google Fonts 설정)
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/webfonts\/.+\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'slidelab-webfonts', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/webfonts\/[^/]+\.(css|json)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'slidelab-webfont-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
