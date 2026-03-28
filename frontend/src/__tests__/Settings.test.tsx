import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { resetConfigCache } from '../scaffold/hooks/useConfig.ts'
import { ThemeProvider } from '../scaffold/contexts/ThemeContext.tsx'
import Settings from '../scaffold/pages/Settings.tsx'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  resetConfigCache()
})

function mockFetch(responses: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    for (const [path, data] of Object.entries(responses)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(data), { status: 200 })
      }
    }
    return new Response('{}', { status: 200 })
  })
}

function mockPushSupport() {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: vi.fn(), ready: Promise.resolve({}), getRegistration: vi.fn() },
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, 'PushManager', {
    value: class {},
    writable: true,
    configurable: true,
  })
}

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter><Settings /></MemoryRouter>
    </ThemeProvider>
  )
}

describe('Settings', () => {
  it('renders display, account, and tax sections', () => {
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Display')).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
  })

  it('shows not supported when no serviceWorker', async () => {
    mockFetch({
      '/api/config': { vapid_public_key: 'test-key', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/not supported in this browser/)).toBeInTheDocument()
    })
  })

  it('shows not configured when no VAPID key', async () => {
    mockPushSupport()
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/not configured on this server/)).toBeInTheDocument()
    })
  })

  it('shows enable button when VAPID key present and not subscribed', async () => {
    mockPushSupport()
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Push notifications')).toBeInTheDocument()
      expect(screen.getAllByText('Enable').length).toBeGreaterThan(0)
    })
  })

  it('shows disable button when subscribed', async () => {
    mockPushSupport()
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': { subscribed: true, subscription_count: 1 },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument()
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })
  })

  it('does not show email section when SMTP not configured', async () => {
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Account')).toBeInTheDocument()
    })
    expect(screen.queryByText('Email notifications')).not.toBeInTheDocument()
  })

  it('shows email section when SMTP is configured', async () => {
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: true },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
      '/api/notifications/email': { enabled: false },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Email notifications')).toBeInTheDocument()
      expect(screen.getAllByText('Enable').length).toBeGreaterThan(0)
    })
  })

  it('shows email enabled state', async () => {
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: true },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
      '/api/notifications/email': { enabled: true },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument()
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })
  })

  it('sign out clears token', async () => {
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: false },
      '/api/push/status': { subscribed: false, subscription_count: 0 },
    })
    renderPage()
    await userEvent.click(screen.getByText('Sign Out'))
    expect(localStorage.getItem('auth_token')).toBeNull()
  })
})
