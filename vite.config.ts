/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * hunspell-asm 4.0.2의 ESM 빌드는 CommonJS 모듈(nanoid@2, Emscripten 런타임)을 `import * as`로 불러 함수처럼 호출한다.
 * 번들러에서는 이름공간 객체라 호출할 수 없으므로 기본 가져오기로 바꾼다 (hunspell-asm, emscripten-wasm-loader의 해당 파일만).
 */
const hunspellNanoidFix = {
  name: 'slidelab-hunspell-nanoid',
  transform(code: string, id: string) {
    if (!/(hunspell-asm|emscripten-wasm-loader)[\\/]dist[\\/]esm[\\/].*\.js$/.test(id)) return null;
    // Emscripten 런타임(CommonJS: module.exports = 함수)도 이름공간으로 불러 호출함 → 기본 가져오기
    if (code.includes("import * as runtime from './lib/node/hunspell';")) return code.replace("import * as runtime from './lib/node/hunspell';", "import runtime from './lib/node/hunspell';");
    if (!code.includes("import * as nanoid from 'nanoid'")) return null;
    // 가상 파일 이름에만 쓰이므로 같은 동작의 작은 함수로 대신함 (CommonJS 상호 운용 문제 회피)
    return code.replace(
      "import * as nanoid from 'nanoid';",
      "const nanoid = (n = 21) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW'[b & 63]).join('');",
    );
  },
};

// GitHub Pages(하위 경로) 배포를 위해 상대 경로 base 사용
export default defineConfig({
  base: './',
  plugins: [
    hunspellNanoidFix,
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
            // 맞춤법 사전(Hunspell .aff/.dic, 한국어 약 14MB): 처음 검사할 때 받아 두고 이후 오프라인에서도 사용
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.(aff|dic)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'slidelab-dictionaries', expiration: { maxEntries: 8 } },
          },
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
