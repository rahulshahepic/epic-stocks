import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import { ThemeProvider } from '../scaffold/contexts/ThemeContext.tsx'
import { MaintenanceProvider } from '../scaffold/contexts/MaintenanceContext.tsx'
import { ViewingProvider } from '../scaffold/contexts/ViewingContext.tsx'
import { resetConfigCache } from '../scaffold/hooks/useConfig.ts'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'
import Layout from '../scaffold/components/Layout.tsx'

/**
 * The iOS status bar overlays the page in an installed PWA
 * (apple-mobile-web-app-status-bar-style: black-translucent), so whatever
 * renders first must carry env(safe-area-inset-top). This broke twice by
 * adding a banner *above* the element that held the inset, which put the
 * banner under the status bar.
 */

beforeEach(() => {
  resetConfigCache()
  resetMeCache()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/config')) {
      return new Response(JSON.stringify({ vapid_public_key: '', email_notifications_available: false }), { status: 200 })
    }
    if (url.includes('/api/me')) {
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', name: 'A', is_admin: false, is_content_admin: false }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function renderLayout() {
  return render(
    <AppProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <MaintenanceProvider>
            <ViewingProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<p>content</p>} />
                </Route>
              </Routes>
            </ViewingProvider>
          </MaintenanceProvider>
        </MemoryRouter>
      </ThemeProvider>
    </AppProvider>
  )
}

function safeAreaEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[class*="safe-area-inset-top"]')
  if (!el) throw new Error('nothing carries the iOS safe-area inset')
  return el
}

describe('Layout top chrome', () => {
  it('puts the safe-area inset on the sticky chrome, not on an inner element', () => {
    const { container } = renderLayout()
    const el = safeAreaEl(container)

    expect(el.className).toContain('sticky')
    expect(el.className).toContain('top-0')
  })

  it('renders nothing visible above the safe-area element', () => {
    const { container } = renderLayout()
    const el = safeAreaEl(container)
    const root = container.firstElementChild!

    // Only the visually-hidden skip link may precede it; anything else would
    // be painted underneath the iOS status bar.
    const before = [...root.children].slice(0, [...root.children].indexOf(el))
    expect(before.map(n => n.className)).toEqual(['skip-nav'])
  })

  it('keeps the header and nav inside the safe area', () => {
    const { container } = renderLayout()
    const el = safeAreaEl(container)

    expect(el.querySelector('header')).not.toBeNull()
    expect(el.querySelector('nav')).not.toBeNull()
  })

  it('keeps the staging banner inside the safe area, not above it', () => {
    vi.stubEnv('VITE_APP_ENV', 'staging')
    const { container } = renderLayout()
    const el = safeAreaEl(container)

    const banner = screen.getByText(/staging environment/i)
    expect(el.contains(banner)).toBe(true)
  })

  it('keeps the viewing banner inside the safe area, not above it', () => {
    sessionStorage.setItem('viewing_context', JSON.stringify({ invitationId: 7, name: 'Dana' }))
    try {
      const { container } = renderLayout()
      const el = safeAreaEl(container)

      const banner = screen.getByText(/viewing dana/i)
      expect(el.contains(banner)).toBe(true)
    } finally {
      sessionStorage.removeItem('viewing_context')
    }
  })
})

describe('Layout footer', () => {
  it('carries the not-affiliated line alongside the privacy link', async () => {
    renderLayout()
    expect(
      await screen.findByText(/not affiliated with or endorsed by Epic Systems Corporation/i)
    ).toBeInTheDocument()
  })
})

describe('Layout wordmark', () => {
  it('badges the app name as unofficial in the header', async () => {
    renderLayout()
    expect(await screen.findByText('Epic Stocks')).toBeInTheDocument()
    expect(screen.getByText('Unofficial')).toBeInTheDocument()
  })
})
