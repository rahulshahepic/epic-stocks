import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { resetConfigCache } from '../scaffold/hooks/useConfig.ts'
import { ThemeProvider } from '../scaffold/contexts/ThemeContext.tsx'
import Settings from '../scaffold/pages/Settings.tsx'

beforeEach(() => {
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

function mockPushSupport(permission: NotificationPermission = 'default') {
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
  Object.defineProperty(window, 'Notification', {
    value: Object.assign(class {}, { permission }),
    writable: true,
    configurable: true,
  })
}

/** Remove the Notification API — iOS Safari in a tab, where push cannot work. */
function mockPushUnsupported({ installed = false } = {}) {
  // @ts-expect-error deleting a global for the unsupported case
  delete window.Notification
  Object.defineProperty(navigator, 'standalone', {
    value: installed, writable: true, configurable: true,
  })
}

const STATUS = (over: Partial<{ registered_here: boolean; total_devices: number; intent: boolean }> = {}) =>
  ({ registered_here: false, total_devices: 0, intent: false, ...over })

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

  it('tells an uninstalled iOS device to add the app to the home screen', async () => {
    mockPushUnsupported({ installed: false })
    mockFetch({
      '/api/config': { vapid_public_key: 'test-key', email_notifications_available: false },
      '/api/push/status': STATUS(),
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/add this app to your home screen/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()
  })

  it('says not available on an installed device that still lacks the API', async () => {
    mockPushUnsupported({ installed: true })
    mockFetch({
      '/api/config': { vapid_public_key: 'test-key', email_notifications_available: false },
      '/api/push/status': STATUS(),
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/not available on this device/i)).toBeInTheDocument()
    })
  })

  it('shows not configured when no VAPID key', async () => {
    mockPushSupport()
    mockFetch({
      '/api/config': { vapid_public_key: '', email_notifications_available: false },
      '/api/push/status': STATUS(),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/not configured on this server/)).toBeInTheDocument()
    })
  })

  it('offers Enable on a device that has not been asked', async () => {
    mockPushSupport('default')
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': STATUS(),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Push notifications')).toBeInTheDocument()
      expect(screen.getAllByText('Enable').length).toBeGreaterThan(0)
    })
  })

  it('shows On this device only when this device is registered', async () => {
    mockPushSupport('granted')
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': STATUS({ registered_here: true, total_devices: 1, intent: true }),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument()
      expect(screen.getByText('On this device')).toBeInTheDocument()
    })
  })

  it("does not claim push is on because another device has it", async () => {
    // The original bug: a laptop subscription made an iPhone that had never
    // been asked render as Enabled, so nothing ever prompted.
    mockPushSupport('default')
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': STATUS({ registered_here: false, total_devices: 1, intent: true }),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Enable').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('On this device')).not.toBeInTheDocument()
    expect(screen.queryByText('Disable')).not.toBeInTheDocument()
    expect(screen.getByText(/on 1 other device/i)).toBeInTheDocument()
  })

  it('explains a blocked device instead of offering a dead button', async () => {
    mockPushSupport('denied')
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': STATUS(),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/turn notifications back on in your device settings/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()
  })

  it('mentions other devices alongside this one', async () => {
    mockPushSupport('granted')
    mockFetch({
      '/api/config': { vapid_public_key: 'test-vapid-key', email_notifications_available: false },
      '/api/push/status': STATUS({ registered_here: true, total_devices: 3, intent: true }),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/also on 2 other devices/i)).toBeInTheDocument()
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

  it('sign out calls logout endpoint', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/logout')) {
        return new Response('{}', { status: 200 })
      }
      if (url.includes('/api/config')) {
        return new Response(JSON.stringify({ vapid_public_key: '', email_notifications_available: false }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    renderPage()
    await userEvent.click(screen.getByText('Sign Out'))
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    )
  })
})
