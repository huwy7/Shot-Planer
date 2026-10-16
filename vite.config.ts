import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the build works under https://huwy7.github.io/Shot-Planer/ regardless of path casing.
export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
