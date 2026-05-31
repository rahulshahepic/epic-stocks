import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function stagingAssetsPlugin(): Plugin {
  const isStaging = process.env.VITE_APP_ENV === 'staging'

  const stagingManifest = JSON.stringify(
    {
      name: 'Equity Tracker (Staging)',
      short_name: 'Equity β',
      description: 'Track equity vesting, loans, and capital gains',
      start_url: '/',
      display: 'standalone',
      background_color: '#111009',
      theme_color: '#D97706',
      orientation: 'portrait-primary',
      icons: [
        { src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    null,
    2,
  )

  return {
    name: 'staging-assets',
    transformIndexHtml: isStaging
      ? {
          order: 'post',
          handler(html) {
            return html
              .replace('<title>Equity Tracker</title>', '<title>Equity Tracker (Staging)</title>')
              .replace(/content="#C41230"/g, 'content="#D97706"')
              .replace(/content="#E8334A"/g, 'content="#F59E0B"')
              .replace('content="Equity"', 'content="Equity β"')
          },
        }
      : undefined,
    closeBundle() {
      if (!isStaging) return
      const outDir = path.resolve('dist')
      if (!fs.existsSync(outDir)) return
      const stagingSvg = fs.readFileSync(path.resolve('public/favicon-staging.svg'), 'utf-8')
      fs.writeFileSync(path.join(outDir, 'favicon.svg'), stagingSvg)
      fs.writeFileSync(path.join(outDir, 'manifest.json'), stagingManifest)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stagingAssetsPlugin()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
