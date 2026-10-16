import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Avoids pulling in @types/node for a single env lookup.
declare const process: { env: Record<string, string | undefined> };

// Relative base so the build works under https://huwy7.github.io/Shot-Planer/ regardless of path casing.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The horizon reader (geotiff.js and its decoders) is only useful online; load it on demand.
        globIgnores: ['**/assets/{horizonLoader,geotiff,lerc,zstd,pako.esm,jpeg,lzw,deflate,packbits,webimage,raw,basedecoder}-*.js'],
      },
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Shot-Planer Street',
        short_name: 'Shot-Planer',
        description: 'Wann gibt es gutes Licht an meinen Street-Spots?',
        lang: 'de-CH',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        background_color: '#111316',
        theme_color: '#111316',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
