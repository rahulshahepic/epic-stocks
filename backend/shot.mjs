import { chromium } from '@playwright/test'
const b = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 390, height: 700 }, colorScheme: scheme })
  await p.goto('file:///tmp/consent-preview.html')
  await p.screenshot({ path: `/tmp/consent-${scheme}.png` })
}
await b.close()
