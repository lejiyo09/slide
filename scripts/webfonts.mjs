#!/usr/bin/env node
/**
 * 배포 시 웹 글꼴 자체 호스팅: 기본 제공 웹 글꼴(catalog.ts WEB_FONTS)의 Google Fonts CSS와 woff2 조각(unicode-range 부분 집합)을
 * 내려받아 dist/webfonts/ 아래에 둔다. 앱은 같은 출처의 webfonts/manifest.json이 있으면 이 파일들을 쓰고,
 * 없거나 빠진 글꼴만 Google Fonts에서 받는다 → 사용자의 브라우저는 Google에 요청하지 않는다.
 *
 * 사용: node scripts/webfonts.mjs [출력 폴더=dist/webfonts] [--cache=.webfonts-cache]
 * - gstatic 주소에는 버전이 들어 있어 내용이 바뀌지 않으므로 캐시 폴더에 받아 두고 재사용한다 (GitHub Actions cache).
 * - 네트워크 오류가 나면 그 글꼴만 건너뛰고(앱이 Google로 대체) 끝까지 진행한다. 하나도 못 받으면 종료 코드 1.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist/webfonts');
const cacheDir = resolve(args.find((a) => a.startsWith('--cache='))?.slice(8) ?? '.webfonts-cache');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
// woff2 + unicode-range를 주는 최신 브라우저 UA (Google Fonts는 UA에 따라 형식을 고른다)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const { WEB_FONTS, webFontCssUrl, pickerLabel } = await import(new URL('../src/services/fonts/catalog.ts', import.meta.url).href);

async function get(url, binary) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return binary ? new Uint8Array(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

/** 동시에 n개씩 */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const manifest = { generated: new Date().toISOString(), families: {} };
let files = 0, bytes = 0, cached = 0;
const urlMap = new Map();
const failed = [];

for (const font of WEB_FONTS) {
  if (only && !only.includes(font.family)) continue;
  try {
    // 본 스타일시트(전체 글자, unicode-range 조각) + 미리 보기 스타일시트(글꼴 선택 상자에 보이는 이름 글자만)
    const css = await get(webFontCssUrl(font.family));
    const previewCss = await get(webFontCssUrl(font.family, pickerLabel(font)));
    const urls = [...new Set([...(css + previewCss).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/([^)]+))\)/g)].map((m) => m[1]))];
    if (!urls.length) throw new Error('CSS에 글꼴 파일이 없습니다');
    await pool(urls, 12, async (url) => {
      // 미리 보기 파일 주소는 l/font?kit=…처럼 확장자·폴더 구조가 없을 수 있어 해시 이름으로 저장
      const rel = /^https:\/\/fonts\.gstatic\.com\/s\/[^?]+\.woff2$/.test(url) ? url.slice('https://fonts.gstatic.com/'.length) : `p/${createHash('sha256').update(url).digest('hex').slice(0, 24)}.woff2`;
      urlMap.set(url, rel);
      const cachePath = join(cacheDir, rel);
      let data;
      if (existsSync(cachePath)) {
        data = readFileSync(cachePath);
        cached++;
      } else {
        data = await get(url, true);
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, data);
      }
      const dest = join(outDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(cachePath, dest);
      files++;
      bytes += data.length;
    });
    // CSS의 gstatic 주소 → 같은 폴더 기준 상대 주소
    const local = (text) => text.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, u) => `url(${urlMap.get(u)})`);
    const name = `${slug(font.family)}.css`;
    const previewName = `${slug(font.family)}.preview.css`;
    writeFileSync(join(outDir, name), local(css));
    writeFileSync(join(outDir, previewName), local(previewCss));
    manifest.families[font.family] = { css: name, preview: previewName, hash: createHash('sha256').update(local(css) + local(previewCss)).digest('hex').slice(0, 12), files: urls.length };
    process.stdout.write(`✓ ${font.family} (${urls.length})\n`);
  } catch (e) {
    failed.push(font.family);
    process.stdout.write(`✗ ${font.family}: ${e.message}\n`);
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
console.log(`웹 글꼴 ${Object.keys(manifest.families).length}개, 파일 ${files}개 (${(bytes / 1048576).toFixed(1)}MB, 캐시 재사용 ${cached}개)${failed.length ? `, 실패 ${failed.length}개: ${failed.join(', ')} (앱이 Google Fonts로 대체)` : ''}`);
if (!Object.keys(manifest.families).length) process.exit(1);
