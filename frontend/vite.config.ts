import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function stagingAssetsPlugin(): Plugin {
  const isStaging = process.env.VITE_APP_ENV === 'staging'
  const commitSha = process.env.VITE_COMMIT_SHA || 'dev'

  const stagingManifest = JSON.stringify(
    {
      name: 'Equity Tracker (Staging)',
      short_name: 'Equity β',
      description: 'Track equity vesting, loans, and capital gains',
      start_url: '/',
      display: 'standalone',
      background_color: '#111009',
      theme_color: '#C41230',
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
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Cache-bust all icon links with the commit SHA — applies to every build.
        // Caddy's path matcher ignores query strings, so @nocache still matches.
        let result = html
          .replace('href="/favicon.svg"', `href="/favicon.svg?v=${commitSha}"`)
          .replace('href="/favicon-32x32.png"', `href="/favicon-32x32.png?v=${commitSha}"`)
          .replace('href="/favicon-16x16.png"', `href="/favicon-16x16.png?v=${commitSha}"`)
          .replace('href="/favicon.ico"', `href="/favicon.ico?v=${commitSha}"`)
          .replace('href="/apple-touch-icon.png"', `href="/apple-touch-icon.png?v=${commitSha}"`)

        if (isStaging) {
          result = result
            .replace('<title>Equity Tracker</title>', '<title>Equity Tracker (Staging)</title>')
            .replace('content="Equity"', 'content="Equity β"')
        }

        return result
      },
    },
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
